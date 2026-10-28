import {
  GetOrchardCalendarSyncStatusResponse,
  SyncOrchardCalendarResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { getOrchardCalendarStatus, syncOrchardCalendar } from "../lib/orchard-calendar";
import { isMaster, requireMember } from "../lib/farm-access";

const router: IRouter = Router();

router.get("/calendar/orchard/sync", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!isMaster(member)) {
    res.status(403).json({ error: "Only a farm manager can view calendar sync status." });
    return;
  }
  res.json(GetOrchardCalendarSyncStatusResponse.parse(getOrchardCalendarStatus()));
});

router.post("/calendar/orchard/sync", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!isMaster(member)) {
    res.status(403).json({ error: "Only the farm owner can synchronize calendars." });
    return;
  }
  try {
    const result = await syncOrchardCalendar();
    res.json(SyncOrchardCalendarResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error }, "Combined calendar synchronization failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "Calendar synchronization failed." });
  }
});

export default router;