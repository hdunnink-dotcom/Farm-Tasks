import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import attachmentsRouter from "./attachments";
import calendarRouter from "./calendar";
import teamRouter from "./team";
import assistantRouter from "./assistant";
import dailyPlanRouter from "./daily-plan";
import farmSettingsRouter from "./farm-settings";
import weatherRouter from "./weather";
import googleConnectionRouter from "./google-connection";
import internalRouter from "./internal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tasksRouter);
router.use(attachmentsRouter);
router.use(calendarRouter);
router.use(teamRouter);
router.use(assistantRouter);
router.use(dailyPlanRouter);
router.use(farmSettingsRouter);
router.use(weatherRouter);
router.use(googleConnectionRouter);
router.use(internalRouter);

export default router;
