import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { DepartmentController } from "./department.controller";
import { DepartmentValidation } from "./department.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.post(
	"/",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(DepartmentValidation.createDepartmentSchema),
	DepartmentController.createDepartment,
);

router.get(
	"/",
	auth(Role.ADMIN, Role.SUPER_ADMIN, Role.CITIZEN, Role.TECHNICIAN),
	DepartmentController.getAllDepartments,
);

router.get(
	"/:id/technicians",
	auth(Role.ADMIN, Role.SUPER_ADMIN, Role.TECHNICIAN),
	DepartmentController.getDepartmentTechnicians,
);

router.post(
	"/:id/manager",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(DepartmentValidation.assignManagerSchema),
	DepartmentController.assignManager,
);

router.get(
	"/:id",
	auth(Role.ADMIN, Role.SUPER_ADMIN, Role.CITIZEN, Role.TECHNICIAN),
	DepartmentController.getDepartmentById,
);

router.patch(
	"/:id",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(DepartmentValidation.updateDepartmentSchema),
	DepartmentController.updateDepartment,
);

router.delete(
	"/:id",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	DepartmentController.deleteDepartment,
);

export const DepartmentRoutes = router;
