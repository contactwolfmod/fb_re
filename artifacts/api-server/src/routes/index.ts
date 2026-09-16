import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import chatRouter from "./chat";
import authRouter from "./auth";
import adminRouter from "./admin";
import { requireAdmin } from "../lib/adminAuth";

const router: IRouter = Router();

router.use(healthRouter);

// Bot / auth / chat APIs protected by admin cookie
router.use(requireAdmin, botRouter);
router.use(requireAdmin, chatRouter);
router.use(requireAdmin, authRouter);

// Admin dashboard (login is public inside adminRouter)
router.use(adminRouter);

export default router;
