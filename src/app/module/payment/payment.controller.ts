import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import type { IPaymentActor } from "./payment.interface";
import { PaymentService } from "./payment.service";
import { Role } from "../../../generated/prisma/enums";

const getActor = (req: Request): IPaymentActor => ({
	userId: req.user?.userId as string,
	role: (req.user?.role ?? Role.CITIZEN) as IPaymentActor["role"],
	email: req.user?.email,
});

const getGateways = catchAsync(async (_req: Request, res: Response) => {
	const result = PaymentService.getGateways();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment gateways retrieved successfully",
		data: result,
	});
});

const initiatePayment = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentService.initiatePayment(getActor(req), req.body);

	const isStripe = result.gateway === "stripe";

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: isStripe
			? "Payment initiated. Redirect the user to the Stripe checkout URL."
			: "Payment initiated. Complete the payment at the bKash URL.",
		data: result,
	});
});

const executePayment = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentService.executePayment(
		req.params.id as string,
		getActor(req),
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: result.alreadyProcessed
			? "Payment was already processed"
			: "Payment executed successfully",
		data: result.payment,
	});
});

const queryPaymentStatus = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentService.queryPaymentStatus(
		req.params.id as string,
		getActor(req),
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: result.alreadyProcessed
			? "Payment was already processed"
			: "Payment status updated",
		data: result.payment,
	});
});

const getPaymentById = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentService.getPaymentById(
		req.params.id as string,
		getActor(req),
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment retrieved successfully",
		data: result,
	});
});

const getMyPayments = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentService.getMyPayments(
		getActor(req),
		req.query as Record<string, unknown>,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payments retrieved successfully",
		data: result.data,
		meta: result.meta,
	});
});

const getAllPayments = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentService.getAllPayments(
		req.query as Record<string, unknown>,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payments retrieved successfully",
		data: result.data,
		meta: result.meta,
	});
});

const handleBkashWebhook = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentService.handleBkashWebhook({
		...(req.query as Record<string, unknown>),
		...(req.body as Record<string, unknown>),
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "bKash webhook received",
		data: result,
	});
});

const handleStripeWebhook = catchAsync(async (req: Request, res: Response) => {
	const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

	if (!rawBody) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Raw request body is required for Stripe signature verification",
		);
	}

	const result = await PaymentService.handleStripeWebhook(
		rawBody,
		req.headers["stripe-signature"] as string | undefined,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Stripe webhook received",
		data: result,
	});
});

const refundPayment = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentService.refundPayment(
		req.params.id as string,
		getActor(req),
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment refunded successfully",
		data: result,
	});
});

export const PaymentController = {
	getGateways,
	initiatePayment,
	executePayment,
	queryPaymentStatus,
	getPaymentById,
	getMyPayments,
	getAllPayments,
	handleBkashWebhook,
	handleStripeWebhook,
	refundPayment,
};
