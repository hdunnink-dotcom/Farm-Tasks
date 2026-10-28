import { Router, type IRouter } from "express";
import { GetFarmSettingsResponse, UpdateFarmSettingsBody, UpdateFarmSettingsResponse } from "@workspace/api-zod";
import { isHarnold, isMaster, requireMember } from "../lib/farm-access";
import { getFarmSettings, updateFarmSettings } from "../lib/farm-settings";

const router: IRouter = Router();
function canManageSettings(member: Awaited<ReturnType<typeof requireMember>>): boolean {
  return Boolean(member && isHarnold(member))
    || (typeof isMaster === "function" && isMaster(member));
}

router.get("/farm-settings", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!canManageSettings(member)) {
    res.status(403).json({ error: "Only a farm manager can view shared farm settings." });
    return;
  }
  try {
    res.set("Cache-Control", "no-store");
    res.json(GetFarmSettingsResponse.parse(await getFarmSettings()));
  } catch (error) {
    req.log?.error?.({ err: error }, "Could not read farm settings");
    res.status(502).json({ error: "Could not load shared farm settings." });
  }
});

router.patch("/farm-settings", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!canManageSettings(member)) {
    res.status(403).json({ error: "Only a farm manager can manage shared farm settings." });
    return;
  }
  const body = UpdateFarmSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    res.json(UpdateFarmSettingsResponse.parse(await updateFarmSettings(body.data)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid farm settings." });
  }
});

export default router;