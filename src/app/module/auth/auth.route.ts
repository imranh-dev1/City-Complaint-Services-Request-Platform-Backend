import { Router } from "express";
import { validateRequest } from "../../middleware/validateRequest";
import { UserValidations } from "./auth.validation";
import { AuthControllers } from "./auth.controller"; 
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.post(
	"/register",
	validateRequest(UserValidations.createUserValidationSchema),
	AuthControllers.registerCitizen,
);

router.post(
	"/register-email-verify",
	validateRequest(UserValidations.verifyEmailValidationSchema),
	AuthControllers.registerEmailVerification,
);

router.post(
	"/login",
	validateRequest(UserValidations.loginValidationSchema),
	AuthControllers.loginUser,
);

router.get(
	"/me",
	auth(Role.ADMIN, Role.CITIZEN, Role.SUPER_ADMIN, Role.TECHNICIAN),
	AuthControllers.getMe,
);

router.post("/google", AuthControllers.googleLogin);

router.post("/refresh-token", AuthControllers.refreshToken);

router.post(
	"/forgot-password",
	validateRequest(UserValidations.forgotPasswordZodSchema),
	AuthControllers.forgotPassword,
);

router.post(
	"/reset-password",
	validateRequest(UserValidations.resetPasswordZodSchema),
	AuthControllers.resetPassword,
);

router.post(
	"/logout",
	auth(Role.ADMIN, Role.CITIZEN, Role.SUPER_ADMIN, Role.TECHNICIAN),
	AuthControllers.logoutUser,
);

router.post(
	"/register-staff",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(UserValidations.createStaffValidationSchema),
	AuthControllers.registerStaff,
);

export const AuthRoutes = router;
