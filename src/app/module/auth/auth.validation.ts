import { z } from "zod";
import {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";

export const RoleEnum = z.nativeEnum(Role);
export const UserStatusEnum = z.nativeEnum(UserStatus);
export const AuthProviderEnum = z.nativeEnum(AuthProvider);

export const createUserValidationSchema = z
	.object({
		name: z
			.string({
				message: "Name is required",
			})
			.min(2, "Name must be at least 2 characters long"),

		email: z
			.string({
				message: "Email is required",
			})
			.email("Invalid email format"),

		password: z
			.string()
			.min(6, "Password must be at least 6 characters long")
			.optional(),

		googleId: z.string().optional(),

		authProvider: AuthProviderEnum.default(AuthProvider.CREDENTIAL),

		emailVerified: z.boolean().default(false),

		role: RoleEnum.default(Role.CITIZEN),

		status: UserStatusEnum.default(UserStatus.ACTIVE),

		needPasswordChange: z.boolean().default(false),

		imageUrl: z.string().url("Invalid image URL format").default(""),

		imagePublicId: z.string().default(""),

		phone: z
			.string()
			.regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format")
			.optional()
			.nullable(),

		isDeleted: z.boolean().default(false),

		deletedAt: z.date().optional().nullable(),

		citizen: z
			.object({
				nid: z
					.string()
					.trim()
					.min(10, "NID must be at least 10 characters")
					.max(20, "NID cannot exceed 20 characters")
					.optional()
					.nullable(),

				address: z
					.string()
					.trim()
					.max(255, "Address cannot exceed 255 characters")
					.optional()
					.nullable(),

				wardNo: z
					.string()
					.trim()
					.max(20, "Ward number cannot exceed 20 characters")
					.optional()
					.nullable(),

				area: z
					.string()
					.trim()
					.max(100, "Area cannot exceed 100 characters")
					.optional()
					.nullable(),
			})
			.optional(),
	})
	.refine(
		(data) => {
			if (data.authProvider === "CREDENTIAL" && !data.password) {
				return false;
			}
			return true;
		},
		{
			message: "Password is required when registering via typical credentials",
			path: ["password"],
		},
	);

export const updateUserValidationSchema = z.object({
	name: z.string().min(2).optional(),
	email: z.string().email().optional(),
	password: z.string().min(6).optional(),
	googleId: z.string().optional(),
	authProvider: AuthProviderEnum.optional(),
	emailVerified: z.boolean().optional(),
	role: RoleEnum.optional(),
	status: UserStatusEnum.optional(),
	needPasswordChange: z.boolean().optional(),
	imageUrl: z.string().url().optional(),
	imagePublicId: z.string().optional(),
	phone: z
		.string()
		.regex(/^\+?[1-9]\d{1,14}$/)
		.optional()
		.nullable(),
	isDeleted: z.boolean().optional(),
	deletedAt: z.date().optional().nullable(),
});

export const verifyEmailValidationSchema = z.object({
	email: z
		.string({
			message: "Email is required",
		})
		.email("Invalid email format"),

	otp: z
		.string({
			message: "Verification code is required",
		})
		.length(6, "Verification code must be exactly 6 digits long")
		.regex(/^\d+$/, "Verification code must contain only numbers"),
});

export const loginValidationSchema = z.object({
	email: z
		.string({
			message: "Email is required",
		})
		.email("Invalid email format"),

	password: z
		.string({
			message: "Password is required",
		})
		.min(6, "Password must be at least 6 characters long"),
});

const forgotPasswordZodSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email("Please provide a valid email address"),
});

const resetPasswordZodSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email("Please provide a valid email address"),
	newPassword: z
		.string()
		.regex(
			/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
			"Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character",
		),
	otp: z.string().length(6),
});

const createStaffValidationSchema = z.object({
	name: z
		.string()
		.trim()
		.min(2, "Name must be at least 2 characters long")
		.max(100, "Name cannot exceed 100 characters"),

	email: z.string().trim().toLowerCase().email("Invalid email format"),

	password: z
		.string()
		.regex(
			/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
			"Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character",
		),

	role: z.enum(["TECHNICIAN", "ADMIN"], {
		message: "Only TECHNICIAN or ADMIN accounts can be created",
	}),

	phone: z
		.string()
		.regex(
			/^(?:\+8801[3-9]\d{8}|01[3-9]\d{8})$/,
			"Invalid Bangladeshi phone number",
		)
		.nullable()
		.optional(),

	departmentId: z.string().uuid("Invalid department ID").optional(),

	specialization: z.string().trim().min(2).max(100).optional(),
	experience: z.number().int().min(0).max(60).optional(),
});

export const UserValidations = {
	createUserValidationSchema,
	updateUserValidationSchema,
	verifyEmailValidationSchema,
	loginValidationSchema,
	forgotPasswordZodSchema,
	resetPasswordZodSchema,
	createStaffValidationSchema,
};
