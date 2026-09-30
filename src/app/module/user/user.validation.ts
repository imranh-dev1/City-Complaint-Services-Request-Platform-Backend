import { z } from "zod";

export const updateMyProfileSchema = z.object({
    name: z
        .string()
        .min(2, "Name must be at least 2 characters long")
        .max(100, "Name cannot exceed 100 characters")
        .optional(),

    phone: z
        .string()
        .regex(
            /^(?:\+8801[3-9]\d{8}|01[3-9]\d{8})$/,
            "Invalid Bangladeshi phone number"
        )
        .nullable()
        .optional(),

    citizen: z
        .object({
            nid: z
                .string()
                .min(10, "NID must be at least 10 characters")
                .max(20, "NID cannot exceed 20 characters")
                .optional(),

            address: z
                .string()
                .max(255, "Address cannot exceed 255 characters")
                .optional(),

            wardNo: z
                .string()
                .max(20, "Ward number cannot exceed 20 characters")
                .optional(),

            area: z
                .string()
                .max(100, "Area cannot exceed 100 characters")
                .optional(),
        })
        .optional(),
});

const changePasswordZodSchema = z.object({
    oldPassword: z
        .string()
        .min(6, "Old password must be at least 6 characters"),

    newPassword: z
        .string()
        .min(6, "New password must be at least 6 characters")
        .max(100, "New password cannot exceed 100 characters"),

    confirmPassword: z
        .string()
        .min(6, "Confirm password must be at least 6 characters"),
})
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: "New password and confirm password do not match",
        path: ["confirmPassword"],
    })
    .refine((data) => data.oldPassword !== data.newPassword, {
        message: "New password must be different from old password",
        path: ["newPassword"],
    });


export const UserProfileUpdateValidations = {
    updateMyProfileSchema,
    changePasswordZodSchema
} 