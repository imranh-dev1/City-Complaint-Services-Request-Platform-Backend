import { z } from "zod";
import {
	ComplaintStatus,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";

const updateUserStatusSchema = z.object({
	status: z.nativeEnum(UserStatus, {
		message: "Invalid user status",
	}),
});

const updateUserRoleSchema = z.object({
	role: z.nativeEnum(Role, {
		message: "Invalid role",
	}),
});

const assignDepartmentSchema = z.object({
	departmentId: z.string().uuid("Invalid department ID"),
});

export const AdminValidation = {
	updateUserStatusSchema,
	updateUserRoleSchema,
	assignDepartmentSchema,
};

export const ComplaintStatusArray = Object.values(ComplaintStatus);
