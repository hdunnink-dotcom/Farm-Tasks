const FORECAST_URL = "https://forecast-v2.metoceanapi.com/point/time";
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const AUCKLAND_TIME_ZONE = "Pacific/Auckland";
const CACHE_TTL_MS = 15 * 60 * 1000;
const STALE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LOCATION = {
  name: "Ngātīmoti / Motueka, Tasman",
  latitude: -41.216,
  longitude: 172.916,
};
const WEATHER_VARIABLES = [
  "air.temperature.at-2m",
  "cloud.cover",
  "precipitation.rate",
  "wind.speed.at-10m",
  "wind.direction.at-10m",
] as const;

type MetOceanVariable = {
  data?: Array<number | null>;
  units?: string;
};

export type MetOceanForecastResponse = {
  dimensions?: {
    time?: { data?: string[] };
    times?: { data?: string[] };
  };
  variables?: Record<string, MetOceanVariable | undefined>;
};

export type OpenMeteoForecastResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    precipitation?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
    cloud_cover?: Array<number | null>;
  };
};

export type CrewWeatherHour = {
  time: string;
  localHour: number;
  temperatureC: number | null;
  rainMm: number;
  windKmh: number | null;
  windDirectionDegrees: number | null;
  windDirection: string | null;
  cloudCoverPercent: number | null;
  condition: string;
};

export type CrewWeatherDay = {
  date: string;
  partial: boolean;
  totalRainMm: number;
  maxWindKmh: number | null;
  averageCloudCoverPercent: number | null;
  condition: string;
  hours: CrewWeatherHour[];
};

export type CrewWeatherForecast = {
  location: typeof LOCATION;
  source: string;
  sourceUrl: string;
  updatedAt: string;
  stale: boolean;
  days: CrewWeatherDay[];
};

export class WeatherForecastError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "provider_error" | "invalid_response",
    readonly status: number,
  ) {
    super(message);
  }
}

type CacheEntry = {
  forecast: CrewWeatherForecast;
  storedAt: number;
  provider: "metocean" | "open-meteo";
};

let cache: CacheEntry | null = null;

const aucklandDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AUCKLAND_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const aucklandHourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: AUCKLAND_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

export function aucklandDateKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    aucklandDateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function aucklandHour(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hour = Number(aucklandHourFormatter.format(date));
  return Number.isFinite(hour) ? hour : null;
}

function finiteValue(variable: MetOceanVariable | undefined, index: number): number | null {
  const value = variable?.data?.[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function temperatureCelsius(value: number | null, units: string | undefined): number | null {
  if (value === null) return null;
  return round(units?.toLowerCase().includes("kelvin") || value > 100 ? value - 273.15 : value);
}

function windKmh(value: number | null, units: string | undefined): number | null {
  if (value === null) return null;
  const normalizedUnits = units?.toLowerCase() ?? "";
  if (normalizedUnits.includes("kilometer") || normalizedUnits.includes("km")) return round(value);
  if (normalizedUnits.includes("knot")) return round(value * 1.852);
  return round(value * 3.6);
}

function cloudCoverPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.min(100, round(value <= 1 ? value * 100 : value, 0)));
}

function rainMillimetres(value: number | null, units: string | undefined): number {
  if (value === null) return 0;
  const normalizedUnits = units?.toLowerCase() ?? "";
  const millimetres = normalizedUnits.includes("meter") && !normalizedUnits.includes("milli")
    ? value * 1000
    : value;
  return Math.max(0, round(millimetres, 2));
}

function conditionForCloud(cloud: number | null): string {
  if (cloud === null) return "Cloud unknown";
  if (cloud >= 85) return "Overcast";
  if (cloud >= 60) return "Mostly cloudy";
  if (cloud >= 30) return "Partly cloudy";
  return "Mostly clear";
}

function compassDirection(degrees: number | null): string | null {
  if (degrees === null) return null;
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round((((degrees % 360) + 360) % 360) / 45) % directions.length];
}

export function normalizeMetOceanForecast(
  payload: MetOceanForecastResponse,
  updatedAt = new Date().toISOString(),
): CrewWeatherForecast {
  const times = payload.dimensions?.time?.data ?? payload.dimensions?.times?.data ?? [];
  const variables = payload.variables ?? {};
  if (!times.length) {
    throw new WeatherForecastError("The weather provider returned no hourly forecast.", "invalid_response", 502);
  }

  const temperature = variables["air.temperature.at-2m"];
  const rain = variables["precipitation.rate"];
  const wind = variables["wind.speed.at-10m"];
  const windDirection = variables["wind.direction.at-10m"];
  const cloud = variables["cloud.cover"];
  const days = new Map<string, CrewWeatherHour[]>();

  times.forEach((time, index) => {
    const date = aucklandDateKey(time);
    const localHour = aucklandHour(time);
    if (!date || localHour === null) return;
    const directionDegrees = finiteValue(windDirection, index);
    const cloudPercent = cloudCoverPercent(finiteValue(cloud, index));
    const hour: CrewWeatherHour = {
      time,
      localHour,
      temperatureC: temperatureCelsius(finiteValue(temperature, index), temperature?.units),
      rainMm: rainMillimetres(finiteValue(rain, index), rain?.units),
      windKmh: windKmh(finiteValue(wind, index), wind?.units),
      windDirectionDegrees: directionDegrees === null ? null : round(directionDegrees, 0),
      windDirection: compassDirection(directionDegrees),
      cloudCoverPercent: cloudPercent,
      condition: conditionForCloud(cloudPercent),
    };
    const current = days.get(date) ?? [];
    current.push(hour);
    days.set(date, current);
  });

  const normalizedDays = [...days.entries()].slice(0, 10).map(([date, hours]) => {
    const windValues = hours.flatMap((hour) => hour.windKmh === null ? [] : [hour.windKmh]);
    const cloudValues = hours.flatMap((hour) => hour.cloudCoverPercent === null ? [] : [hour.cloudCoverPercent]);
    const averageCloud = cloudValues.length
      ? round(cloudValues.reduce((total, value) => total + value, 0) / cloudValues.length, 0)
      : null;
    return {
      date,
      partial: hours[0]?.localHour !== 0,
      totalRainMm: round(hours.reduce((total, hour) => total + hour.rainMm, 0)),
      maxWindKmh: windValues.length ? round(Math.max(...windValues)) : null,
      averageCloudCoverPercent: averageCloud,
      condition: conditionForCloud(averageCloud),
      hours,
    };
  });

  if (!normalizedDays.length) {
    throw new WeatherForecastError("The weather provider returned no usable forecast.", "invalid_response", 502);
  }

  return {
    location: LOCATION,
    source: "MetService / MetOcean Point Forecast",
    sourceUrl: "https://data.metservice.com/product/point-forecast-api",
    updatedAt,
    stale: false,
    days: normalizedDays,
  };
}

export function normalizeOpenMeteoForecast(
  payload: OpenMeteoForecastResponse,
  updatedAt = new Date().toISOString(),
): CrewWeatherForecast {
  const hourly = payload.hourly;
  const times = hourly?.time ?? [];
  const currentDate = aucklandDateKey(updatedAt);
  const currentHour = aucklandHour(updatedAt);
  if (!times.length) {
    throw new WeatherForecastError("The free weather provider returned no hourly forecast.", "invalid_response", 502);
  }

  const days = new Map<string, CrewWeatherHour[]>();
  times.forEach((time, index) => {
    const date = time.slice(0, 10);
    const localHour = Number(time.slice(11, 13));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(localHour)) return;
    if (date === currentDate && currentHour !== null && localHour < currentHour) return;
    const direction = hourly?.wind_direction_10m?.[index];
    const cloudValue = hourly?.cloud_cover?.[index];
    const cloudPercent = typeof cloudValue === "number" && Number.isFinite(cloudValue)
      ? Math.max(0, Math.min(100, Math.round(cloudValue)))
      : null;
    const windValue = hourly?.wind_speed_10m?.[index];
    const hour: CrewWeatherHour = {
      time,
      localHour,
      temperatureC: typeof hourly?.temperature_2m?.[index] === "number" ? round(hourly.temperature_2m[index] as number) : null,
      rainMm: typeof hourly?.precipitation?.[index] === "number" ? Math.max(0, round(hourly.precipitation[index] as number, 2)) : 0,
      windKmh: typeof windValue === "number" && Number.isFinite(windValue) ? round(windValue) : null,
      windDirectionDegrees: typeof direction === "number" && Number.isFinite(direction) ? round(direction, 0) : null,
      windDirection: typeof direction === "number" && Number.isFinite(direction) ? compassDirection(direction) : null,
      cloudCoverPercent: cloudPercent,
      condition: conditionForCloud(cloudPercent),
    };
    const current = days.get(date) ?? [];
    current.push(hour);
    days.set(date, current);
  });

  const normalizedDays = [...days.entries()].slice(0, 10).map(([date, hours]) => {
    const windValues = hours.flatMap((hour) => hour.windKmh === null ? [] : [hour.windKmh]);
    const cloudValues = hours.flatMap((hour) => hour.cloudCoverPercent === null ? [] : [hour.cloudCoverPercent]);
    const averageCloud = cloudValues.length
      ? round(cloudValues.reduce((total, value) => total + value, 0) / cloudValues.length, 0)
      : null;
    return {
      date,
      partial: date === currentDate && currentHour !== null && currentHour > 0,
      totalRainMm: round(hours.reduce((total, hour) => total + hour.rainMm, 0)),
      maxWindKmh: windValues.length ? round(Math.max(...windValues)) : null,
      averageCloudCoverPercent: averageCloud,
      condition: conditionForCloud(averageCloud),
      hours,
    };
  });

  if (!normalizedDays.length) {
    throw new WeatherForecastError("The free weather provider returned no usable forecast.", "invalid_response", 502);
  }
  return {
    location: LOCATION,
    source: "Open-Meteo (free comparison)",
    sourceUrl: "https://open-meteo.com/",
    updatedAt,
    stale: false,
    days: normalizedDays,
  };
}

type GetWeatherOptions = {
  force?: boolean;
  now?: Date;
  apiKey?: string;
  fetcher?: typeof fetch;
  provider?: "auto" | "metocean" | "open-meteo";
};

export async function getCrewPlanWeather(options: GetWeatherOptions = {}): Promise<CrewWeatherForecast> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const selectedProvider = options.provider
    ?? (process.env.WEATHER_PROVIDER?.trim().toLowerCase() as GetWeatherOptions["provider"] | undefined)
    ?? "auto";
  const provider = selectedProvider === "metocean" || selectedProvider === "open-meteo" ? selectedProvider : "auto";
  const hasMetOceanKey = Boolean(options.apiKey ?? process.env.METOCEAN_API_KEY?.trim() ?? process.env.METSERVICE_API_KEY?.trim());
  const cacheMatches = provider === "auto" || cache?.provider === provider;
  if (!options.force && cache && cacheMatches && nowMs - cache.storedAt < CACHE_TTL_MS) {
    return cache.forecast;
  }

  const apiKey = options.apiKey
    ?? process.env.METOCEAN_API_KEY?.trim()
    ?? process.env.METSERVICE_API_KEY?.trim();
  if (provider === "metocean" && !apiKey) {
    if (cache && cacheMatches && nowMs - cache.storedAt < STALE_CACHE_TTL_MS) {
      return { ...cache.forecast, stale: true };
    }
    throw new WeatherForecastError(
      "Weather forecast access has not been configured yet.",
      "not_configured",
      503,
    );
  }

  const useOpenMeteo = provider === "open-meteo" || (!hasMetOceanKey && provider === "auto");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const from = new Date(Math.floor(nowMs / 3_600_000) * 3_600_000).toISOString();
    const fetcher = options.fetcher ?? fetch;
    const response = useOpenMeteo
      ? await fetcher(`${OPEN_METEO_URL}?latitude=${LOCATION.latitude}&longitude=${LOCATION.longitude}&hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,cloud_cover&forecast_days=10&timezone=Pacific%2FAuckland`, {
        headers: { "User-Agent": "Hirshberg-Farm-Planner/1.0" },
        signal: controller.signal,
      })
      : await fetcher(FORECAST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Hirshberg-Farm-Planner/1.0",
          "x-api-key": apiKey as string,
        },
        body: JSON.stringify({
          points: [{ lat: LOCATION.latitude, lon: LOCATION.longitude }],
          variables: WEATHER_VARIABLES,
          time: { from, interval: "1h", repeat: 240 },
        }),
        signal: controller.signal,
      });
    if (!response.ok) {
      throw new WeatherForecastError(
        response.status === 429 ? "The weather provider is temporarily rate limited." : "The weather provider could not return a forecast.",
        "provider_error",
        response.status === 429 ? 429 : 502,
      );
    }
    const payload = await response.json();
    const forecast = useOpenMeteo
      ? normalizeOpenMeteoForecast(payload as OpenMeteoForecastResponse, now.toISOString())
      : normalizeMetOceanForecast(payload as MetOceanForecastResponse, now.toISOString());
    cache = { forecast, storedAt: nowMs, provider: useOpenMeteo ? "open-meteo" : "metocean" };
    return forecast;
  } catch (error) {
    let finalError = error;
    if (!useOpenMeteo && provider === "auto") {
      try {
        return await getCrewPlanWeather({
          ...options,
          provider: "open-meteo",
          force: true,
          now,
        });
      } catch (fallbackError) {
        finalError = fallbackError;
      }
    }
    if (cache && cacheMatches && nowMs - cache.storedAt < STALE_CACHE_TTL_MS) {
      return { ...cache.forecast, stale: true };
    }
    if (finalError instanceof WeatherForecastError) throw finalError;
    throw new WeatherForecastError("The weather provider could not be reached.", "provider_error", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function clearWeatherForecastCache(): void {
  cache = null;
}