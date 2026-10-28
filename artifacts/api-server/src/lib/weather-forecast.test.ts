import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aucklandDateKey,
  clearWeatherForecastCache,
  getCrewPlanWeather,
  normalizeMetOceanForecast,
  normalizeOpenMeteoForecast,
  type MetOceanForecastResponse,
} from "./weather-forecast";

afterEach(() => {
  clearWeatherForecastCache();
  vi.restoreAllMocks();
});

function fixture(dayCount = 11): MetOceanForecastResponse {
  const times = Array.from({ length: dayCount * 24 }, (_, index) =>
    new Date(Date.UTC(2026, 7, 29, 12 + index)).toISOString(),
  );
  return {
    dimensions: { time: { data: times } },
    variables: {
      "air.temperature.at-2m": { units: "kelvin", data: times.map((_, index) => 283.15 + index % 8) },
      "precipitation.rate": { units: "millimeterPerHour", data: times.map(() => 0.5) },
      "wind.speed.at-10m": { units: "meterPerSecond", data: times.map((_, index) => index % 24 === 12 ? 10 : 5) },
      "wind.direction.at-10m": { units: "degree", data: times.map(() => 225) },
      "cloud.cover": { units: "fraction", data: times.map(() => 0.9) },
    },
  };
}

describe("Crew Plan weather forecast", () => {
  it("normalizes hourly provider data into ten Auckland days", () => {
    const forecast = normalizeMetOceanForecast(fixture(), "2026-08-30T00:00:00.000Z");

    expect(forecast.days).toHaveLength(10);
    expect(forecast.days[0].date).toBe("2026-08-30");
    expect(forecast.days[0].hours).toHaveLength(24);
    expect(forecast.days[0]).toMatchObject({
      partial: false,
      totalRainMm: 12,
      maxWindKmh: 36,
      averageCloudCoverPercent: 90,
      condition: "Overcast",
    });
    expect(forecast.days[0].hours[0]).toMatchObject({
      temperatureC: 10,
      rainMm: 0.5,
      windKmh: 18,
      windDirection: "SW",
      cloudCoverPercent: 90,
    });
  });

  it("uses Auckland calendar boundaries across daylight-saving changes", () => {
    expect(aucklandDateKey("2026-09-26T11:30:00.000Z")).toBe("2026-09-26");
    expect(aucklandDateKey("2026-09-26T12:30:00.000Z")).toBe("2026-09-27");
  });

  it("normalizes an exact-coordinate Open-Meteo response into ten local days", () => {
    const times = Array.from({ length: 11 * 24 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, 30, index));
      return date.toISOString().slice(0, 13);
    });
    const forecast = normalizeOpenMeteoForecast({
      hourly: {
        time: times,
        temperature_2m: times.map(() => 12),
        precipitation: times.map(() => 0.75),
        wind_speed_10m: times.map(() => 30),
        wind_direction_10m: times.map(() => 180),
        cloud_cover: times.map(() => 65),
      },
    }, "2026-08-29T12:00:00.000Z");

    expect(forecast.source).toContain("Open-Meteo");
    expect(forecast.days).toHaveLength(10);
    expect(forecast.days[0]).toMatchObject({
      partial: false,
      totalRainMm: 18,
      maxWindKmh: 30,
      averageCloudCoverPercent: 65,
      condition: "Mostly cloudy",
    });
  });

  it("uses Open-Meteo automatically when MetOcean credentials are unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      hourly: {
        time: ["2026-08-30T13:00", "2026-08-30T14:00"],
        temperature_2m: [12, 12],
        precipitation: [0, 1],
        wind_speed_10m: [20, 25],
        wind_direction_10m: [90, 90],
        cloud_cover: [20, 40],
      },
    }), { status: 200 }));

    const forecast = await getCrewPlanWeather({
      apiKey: "",
      fetcher,
      provider: "auto",
      now: new Date("2026-08-30T01:30:00.000Z"),
    });
    expect(forecast.source).toContain("Open-Meteo");
    expect(fetcher.mock.calls[0]?.[0]).toContain("api.open-meteo.com");
  });

  it("falls back to Open-Meteo when configured MetOcean access fails", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        hourly: {
          time: ["2026-08-30T12:00", "2026-08-30T13:00", "2026-08-30T14:00"],
          temperature_2m: [12, 12, 12],
          precipitation: [100, 1, 2],
          wind_speed_10m: [20, 25, 30],
          wind_direction_10m: [90, 90, 90],
          cloud_cover: [20, 40, 60],
        },
      }), { status: 200 }));

    const forecast = await getCrewPlanWeather({
      apiKey: "test-key",
      fetcher,
      provider: "auto",
      force: true,
      now: new Date("2026-08-30T01:30:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://forecast-v2.metoceanapi.com/point/time");
    expect(fetcher.mock.calls[1]?.[0]).toContain("api.open-meteo.com");
    expect(forecast.source).toContain("Open-Meteo");
    expect(forecast.days[0]).toMatchObject({
      partial: true,
      totalRainMm: 3,
    });
    expect(forecast.days[0].hours.map((hour) => hour.localHour)).toEqual([13, 14]);
  });

  it("marks an in-progress MetOcean day as a remaining-hours forecast", () => {
    const partialFixture = fixture(10);
    partialFixture.dimensions = {
      time: {
        data: Array.from({ length: 10 * 24 }, (_, index) =>
          new Date(Date.UTC(2026, 7, 29, 17 + index)).toISOString(),
        ),
      },
    };
    const forecast = normalizeMetOceanForecast(partialFixture, "2026-08-30T05:00:00.000Z");

    expect(forecast.days[0].date).toBe("2026-08-30");
    expect(forecast.days[0].partial).toBe(true);
    expect(forecast.days[0].hours[0].localHour).toBe(5);
    expect(forecast.days[1].partial).toBe(false);
  });

  it("caches successful forecasts and supports an explicit refresh", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify(fixture()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const now = new Date("2026-08-30T01:30:00.000Z");

    await getCrewPlanWeather({ apiKey: "test-key", fetcher, now });
    await getCrewPlanWeather({ apiKey: "test-key", fetcher, now: new Date(now.getTime() + 60_000) });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await getCrewPlanWeather({ apiKey: "test-key", fetcher, force: true, now: new Date(now.getTime() + 120_000) });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-api-key": "test-key" });
  });

  it("returns recent cached data as stale when the provider fails", async () => {
    const successfulFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture()), { status: 200 }));
    const now = new Date("2026-08-30T01:30:00.000Z");
    await getCrewPlanWeather({ apiKey: "test-key", fetcher: successfulFetcher, now });

    const failedFetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const forecast = await getCrewPlanWeather({
      apiKey: "test-key",
      fetcher: failedFetcher,
      force: true,
      now: new Date(now.getTime() + 20 * 60_000),
    });
    expect(forecast.stale).toBe(true);
  });

  it("fails clearly when no provider key or cached forecast exists", async () => {
    await expect(getCrewPlanWeather({ apiKey: "", provider: "metocean" })).rejects.toMatchObject({
      code: "not_configured",
      status: 503,
    });
  });
});