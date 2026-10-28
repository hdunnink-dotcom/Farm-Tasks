import { Router, type IRouter } from "express";
import {
  GetDailyPlanSettingsResponse,
  GetTodaysDailyPlanResponse,
  RefreshDailyPlanResponse,
  UpdateDailyPlanSettingsBody,
  UpdateDailyPlanSettingsResponse,
} from "@workspace/api-zod";
import { isMaster, requireMember } from "../lib/farm-access";
import {
  getDailyPlanSettings,
  getTodaysDailyPlan,
  refreshDailyPlan,
  scopeDailyPlanToTaskIds,
  updateDailyPlanSettings,
} from "../lib/daily-plan";
import { listSheetTasks } from "../lib/farm-sheet";

const router: IRouter = Router();

router.get("/daily-plan/today", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  try {
    const plan = await getTodaysDailyPlan();
    const visiblePlan = isMaster(member)
      ? plan
      : scopeDailyPlanToTaskIds(
        plan,
        new Set((await listSheetTasks())
          .filter((task) => task.assigneeIds?.includes(member.clerkId) === true || task.assigneeId === member.clerkId)
          .map((task) => task.id)),
      );
    res.set("Cache-Control", "no-store");
    res.json(GetTodaysDailyPlanResponse.parse(visiblePlan));
  } catch (error) {
    req.log.error({ err: error }, "Could not get today's daily plan");
    res.status(502).json({ error: "Could not build today's daily plan." });
  }
});

router.post("/daily-plan/refresh", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!isMaster(member)) {
    res.status(403).json({ error: "Only the farm owner can refresh the daily plan." });
    return;
  }
  try {
    res.json(RefreshDailyPlanResponse.parse(await refreshDailyPlan({ force: true, actor: member.clerkId })));
  } catch (error) {
    req.log.error({ err: error }, "Could not refresh daily plan");
    res.status(502).json({ error: "Could not refresh today's daily plan." });
  }
});

router.get("/daily-plan/settings", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!isMaster(member)) {
    res.status(403).json({ error: "Only the farm owner can view daily run settings." });
    return;
  }
  res.json(GetDailyPlanSettingsResponse.parse(await getDailyPlanSettings()));
});

router.patch("/daily-plan/settings", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!isMaster(member)) {
    res.status(403).json({ error: "Only the farm owner can update daily run settings." });
    return;
  }
  const body = UpdateDailyPlanSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    res.json(UpdateDailyPlanSettingsResponse.parse(await updateDailyPlanSettings(body.data)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid daily run settings." });
  }
});

export default router;