import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { NotificationController } from "./notification.controller";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(auth(Role.CITIZEN, Role.TECHNICIAN, Role.ADMIN, Role.SUPER_ADMIN));

router.get("/", NotificationController.getMyNotifications);

router.patch("/read-all", NotificationController.markAllAsRead);

router.patch("/:id/read", NotificationController.markAsRead);

export const NotificationRoutes = router;
