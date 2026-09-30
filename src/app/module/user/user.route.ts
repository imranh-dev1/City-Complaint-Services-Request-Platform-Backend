import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { upload } from "../../lib/multer";
import { UserController } from "./user.controller";
import { validateRequest } from "../../middleware/validateRequest";
import { UserProfileUpdateValidations } from "./user.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.patch(
	"/profile-image-upload",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.CITIZEN, Role.TECHNICIAN),
	upload.single("profile-image"),
	UserController.profileImageUpload,
);

router.patch(
	"/profile-update",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.CITIZEN, Role.TECHNICIAN),
	validateRequest(UserProfileUpdateValidations.updateMyProfileSchema),
	UserController.updateMyProfile,
);

router.patch(
	"/change-password",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.CITIZEN, Role.TECHNICIAN),
	validateRequest(UserProfileUpdateValidations.changePasswordZodSchema),
	UserController.changePassword,
);

export const UserRoutes = router;
