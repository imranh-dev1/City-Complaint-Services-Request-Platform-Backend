import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CategoryValidation } from "./category.validation";
import { CategoryController } from "./category.controller";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.post(
	"/",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(CategoryValidation.createCategorySchema),
	CategoryController.createCategory,
);

router.get(
	"/",
	auth(Role.ADMIN, Role.SUPER_ADMIN, Role.CITIZEN, Role.TECHNICIAN),
	CategoryController.getAllCategories,
);

router.get(
	"/:id",
	auth(Role.ADMIN, Role.SUPER_ADMIN, Role.CITIZEN, Role.TECHNICIAN),
	CategoryController.getCategoryById,
);

router.patch(
	"/:id",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(CategoryValidation.updateCategorySchema),
	CategoryController.updateCategory,
);

router.delete(
	"/:id",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	CategoryController.deleteCategory,
);

export const CategoryRoutes = router;
