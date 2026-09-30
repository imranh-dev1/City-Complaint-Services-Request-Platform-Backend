import { z } from "zod";

const initiatePaymentSchema = z.object({
	complaintId: z.string().uuid("Invalid complaint ID"),

	amount: z
		.number({ message: "Amount must be a number" })
		.positive("Amount must be greater than zero")
		.max(1000000, "Amount is too large")
		.optional(),

	gateway: z
		.enum(["bkash", "stripe"], {
			message: "Gateway must be either bkash or stripe",
		})
		.optional(),

	callbackURL: z.string().url("Invalid callback URL").optional(),

	successURL: z.string().url("Invalid success URL").optional(),

	cancelURL: z.string().url("Invalid cancel URL").optional(),
});

const refundPaymentSchema = z.object({
	amount: z.number().positive("Amount must be greater than zero").optional(),
	reason: z
		.string()
		.trim()
		.min(3, "Reason must be at least 3 characters")
		.max(300, "Reason cannot exceed 300 characters"),
});

export const PaymentValidation = {
	initiatePaymentSchema,
	refundPaymentSchema,
};
