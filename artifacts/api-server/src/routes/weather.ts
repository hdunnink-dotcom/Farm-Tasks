import { Router, type IRouter } from "express";
import { isMaster, requireMember } from "../lib/farm-access";
import { getCrewPlanWeather, WeatherForecastError } from "../lib/weather-forecast";

const router: IRouter = Router();

router.get("/weather/crew-plan", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!isMaster(member)) {
    res.status(403).json({ error: "Only the farm manager can view the Crew Plan forecast." });
    return;
  }
  try {
    const requestedProvider = typeof req.query.provider === "string" ? req.query.provider : undefined;
    const provider = requestedProvider === "metocean" || requestedProvider === "open-meteo" || requestedProvider === "auto"
      ? requestedProvider
      : undefined;
    const forecast = await getCrewPlanWeather({ force: req.query.refresh === "1", provider });
    res.json(forecast);
  } catch (error) {
    const status = error instanceof WeatherForecastError ? error.status : 502;
    req.log.warn({ err: error }, "Crew Plan weather forecast unavailable");
    res.status(status).json({
      error: error instanceof Error ? error.message : "Weather forecast unavailable.",
      code: error instanceof WeatherForecastError ? error.code : "provider_error",
    });
  }
});

export default router;