import { z } from "zod";

const createDepartmentSchema = z.object({
    name: z
        .string()
        .trim()
        .min(3, "Department name must be at least 3 characters")
        .max(100, "Department name cannot exceed 100 characters"),

    code: z
        .string()
        .trim()
        .min(2, "Department code must be at least 2 characters")
        .max(20, "Department code cannot exceed 20 characters")
        .regex(/^[A-Z0-9_-]+$/, "Code must contain only uppercase letters, numbers, underscore or hyphen"),

    description: z
        .string()
        .trim()
        .max(500, "Description cannot exceed 500 characters")
        .optional(),
});

const updateDepartmentSchema = z.object({
    name: z.string().trim().min(3).max(100).optional(),
    code: z
        .string()
        .trim()
        .min(2)
        .max(20)
        .regex(/^[A-Z0-9_-]+$/, "Code must contain only uppercase letters, numbers, underscore or hyphen")
        .optional(),
    description: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional(),
});

const assignManagerSchema = z.object({
    userId: z.string().uuid("Invalid user ID"),
});

export const DepartmentValidation = {
    createDepartmentSchema,
    updateDepartmentSchema,
    assignManagerSchema,
};