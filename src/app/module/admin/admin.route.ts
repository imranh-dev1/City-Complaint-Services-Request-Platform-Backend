import { Router } from "express";

import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AdminController } from "./admin.controller";
import { AdminValidation } from "./admin.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.use(auth(Role.ADMIN, Role.SUPER_ADMIN));

router.get("/users", AdminController.getAllUsers);

router.patch(
	"/users/:id/status",
	validateRequest(AdminValidation.updateUserStatusSchema),
	AdminController.updateUserStatus,
);

router.patch(
	"/users/:id/role",
	auth(Role.SUPER_ADMIN),
	validateRequest(AdminValidation.updateUserRoleSchema),
	AdminController.updateUserRole,
);

router.patch(
	"/users/:id/department",
	validateRequest(AdminValidation.assignDepartmentSchema),
	AdminController.assignDepartment,
);

router.get("/dashboard-stats", AdminController.getDashboardStats);

router.get("/audit-logs", AdminController.getAuditLogs);

export const AdminRoutes = router;
