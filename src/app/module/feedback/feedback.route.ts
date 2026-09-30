import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { FeedbackController } from "./feedback.controller";
import { createFeedbackSchema } from "./feedback.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.post(
	"/",
	auth(Role.CITIZEN, Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(createFeedbackSchema),
	FeedbackController.createFeedback,
);

router.get(
	"/",
	auth(Role.CITIZEN, Role.TECHNICIAN, Role.ADMIN, Role.SUPER_ADMIN),
	FeedbackController.getFeedbackByComplaint,
);

export const FeedbackRoutes = router;
