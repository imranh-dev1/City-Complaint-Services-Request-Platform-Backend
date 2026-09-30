import httpStatus from "http-status";
import config from "../../config";
import { bkash, bkashIsConfigured } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import {
	stripe,
	stripeIsConfigured,
	type IStripeEvent,
} from "../../lib/stripe";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/auditLog";
import { createNotification } from "../../utils/notify";
import { buildPaginationMeta, parsePagination } from "../../utils/pagination";
import type {
	IPaymentActor,
	IInitiatePaymentPayload,
	TPaymentGateway,
} from "./payment.interface";
import {
	ComplaintStatus,
	NotificationType,
	PaymentStatus,
	Role,
} from "../../../generated/prisma/enums";
import { Prisma } from "../../../generated/prisma/client";

const PAYABLE_STATUSES: ComplaintStatus[] = [
	ComplaintStatus.SUBMITTED,
	ComplaintStatus.UNDER_REVIEW,
	ComplaintStatus.ASSIGNED,
	ComplaintStatus.IN_PROGRESS,
];

const STRIPE_EVENT_TTL_SECONDS = 60 * 60 * 24 * 7;

const TERMINAL_STATUSES: PaymentStatus[] = [
	PaymentStatus.PAID,
	PaymentStatus.REFUNDED,
	PaymentStatus.CANCELLED,
];

const isDowngrade = (current: PaymentStatus, next: PaymentStatus) => {
	if (current === next) {
		return false;
	}

	if (current === PaymentStatus.PAID && next === PaymentStatus.REFUNDED) {
		return false;
	}

	return TERMINAL_STATUSES.includes(current);
};

const generateInvoiceNumber = () =>
	`CIVIC-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;

const toAmountString = (
	value: Prisma.Decimal | number | string | null | undefined,
	fallback?: number,
) => {
	if (value !== null && value !== undefined) {
		return new Prisma.Decimal(value.toString()).toFixed(2);
	}
	if (fallback !== undefined) {
		return new Prisma.Decimal(fallback).toFixed(2);
	}
	return null;
};

const resolveGateway = (payment: {
	paymentGateway: string | null;
}): TPaymentGateway =>
	payment.paymentGateway?.toLowerCase() === "stripe" ? "stripe" : "bkash";

const assertGatewayReady = (gateway: TPaymentGateway) => {
	if (gateway === "stripe") {
		if (!stripeIsConfigured()) {
			throw new AppError(
				httpStatus.SERVICE_UNAVAILABLE,
				"Stripe gateway is not configured. Set STRIPE_SECRET_KEY environment variable.",
			);
		}
		return;
	}

	if (!bkashIsConfigured()) {
		throw new AppError(
			httpStatus.SERVICE_UNAVAILABLE,
			"bKash gateway is not configured. Set BKASH_* environment variables.",
		);
	}
};

const findPaymentOrThrow = async (paymentId: string) => {
	const payment = await prisma.payment.findUnique({
		where: { id: paymentId },
		include: {
			complaint: {
				select: {
					id: true,
					title: true,
					citizenId: true,
					status: true,
				},
			},
			user: {
				omit: {
					password: true,
				} as const,
			},
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}

	return payment;
};

const assertPaymentAccess = (
	payment: Awaited<ReturnType<typeof findPaymentOrThrow>>,
	actor: IPaymentActor,
) => {
	if (actor.role === Role.CITIZEN && payment.userId !== actor.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only access your own payments",
		);
	}
};

const getGateways = () => [
	{
		gateway: "bkash",
		label: "bKash",
		configured: bkashIsConfigured(),
	},
	{
		gateway: "stripe",
		label: "Stripe Checkout",
		configured: stripeIsConfigured(),
	},
];

const initiatePayment = async (
	actor: IPaymentActor,
	payload: IInitiatePaymentPayload,
) => {
	const gateway: TPaymentGateway = payload.gateway ?? "bkash";

	assertGatewayReady(gateway);

	const complaint = await prisma.complaint.findFirst({
		where: {
			id: payload.complaintId,
			deletedAt: null,
		},
	});

	if (!complaint) {
		throw new AppError(httpStatus.NOT_FOUND, "Complaint not found");
	}

	if (actor.role === Role.CITIZEN && complaint.citizenId !== actor.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only pay for your own complaints",
		);
	}

	if (!PAYABLE_STATUSES.includes(complaint.status)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Payments are only allowed while complaint is in ${PAYABLE_STATUSES.join(", ")} state`,
		);
	}

	const existingPaid = await prisma.payment.findFirst({
		where: {
			complaintId: complaint.id,
			status: PaymentStatus.PAID,
		},
	});

	if (existingPaid) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Complaint already has a successful payment",
		);
	}

	const amountString = toAmountString(complaint.serviceFee, payload.amount);

	if (!amountString) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No service fee is associated with this complaint. Please provide an amount.",
		);
	}

	const merchantInvoiceNumber = generateInvoiceNumber();
	const currency =
		gateway === "stripe"
			? (config.stripe_currency || "BDT").toUpperCase()
			: "BDT";

	const payment = await prisma.payment.create({
		data: {
			amount: new Prisma.Decimal(amountString),
			complaintId: complaint.id,
			userId: actor.userId,
			merchantInvoiceNumber,
			payerReference: actor.email ?? undefined,
			paymentGateway: gateway,
			currency,
			status: PaymentStatus.PENDING,
		},
	});

	if (gateway === "stripe") {
		const session = await stripe.createCheckoutSession({
			paymentId: payment.id,
			complaintId: complaint.id,
			amount: amountString,
			merchantInvoiceNumber,
			payerReference: actor.email,
			description: `Service fee - ${complaint.title}`.slice(0, 250),
			successURL: payload.successURL,
			cancelURL: payload.cancelURL,
		});

		await prisma.payment.update({
			where: { id: payment.id },
			data: {
				stripeSessionId: session.sessionId,
				stripeCheckoutUrl: session.checkoutUrl,
				gatewayResponse: {
					sessionId: session.sessionId,
					checkoutUrl: session.checkoutUrl,
					createTime: new Date().toISOString(),
				},
			},
		});

		if (!complaint.serviceFee) {
			await prisma.complaint.update({
				where: { id: complaint.id },
				data: {
					serviceFee: new Prisma.Decimal(amountString),
				},
			});
		}

		await writeAuditLog({
			userId: actor.userId,
			action: "PAYMENT_INITIATED",
			entityType: "PAYMENT",
			entityId: payment.id,
			metadata: {
				gateway,
				amount: amountString,
				complaintId: complaint.id,
				stripeSessionId: session.sessionId,
			},
		});

		return {
			paymentId: payment.id,
			gateway,
			merchantInvoiceNumber,
			amount: amountString,
			currency,
			sessionId: session.sessionId,
			checkoutUrl: session.checkoutUrl,
		};
	}

	const callbackURL = payload.callbackURL ?? config.bkash_callback_url;

	const gatewayResult = await bkash.createPayment({
		amount: amountString,
		merchantInvoiceNumber,
		payerReference: actor.email ?? "citizen",
		callbackURL,
	});

	await prisma.payment.update({
		where: { id: payment.id },
		data: {
			bkashPaymentId: gatewayResult.paymentID,
			gatewayResponse: {
				createTime: new Date().toISOString(),
			},
		},
	});

	if (!complaint.serviceFee) {
		await prisma.complaint.update({
			where: { id: complaint.id },
			data: {
				serviceFee: new Prisma.Decimal(amountString),
			},
		});
	}

	await writeAuditLog({
		userId: actor.userId,
		action: "PAYMENT_INITIATED",
		entityType: "PAYMENT",
		entityId: payment.id,
		metadata: {
			gateway,
			amount: amountString,
			complaintId: complaint.id,
		},
	});

	return {
		paymentId: payment.id,
		gateway,
		merchantInvoiceNumber,
		amount: amountString,
		currency,
		bkashURL: gatewayResult.bkashURL,
	};
};

interface IPaymentOutcome {
	status: PaymentStatus;
	source: "execute" | "query" | "webhook" | "refund";
	gatewayResponse: Prisma.InputJsonValue;
	trxId?: string | null;
	paymentIntentId?: string | null;
	sessionId?: string | null;
	customerId?: string | null;
	eventId?: string | null;
}

const notifyPaymentOutcome = async (
	payment: {
		id: string;
		userId: string;
		amount: Prisma.Decimal;
		complaintId: string;
	},
	complaintTitle: string,
	outcome: IPaymentOutcome,
) => {
	const currency = "BDT";

	if (outcome.status === PaymentStatus.PAID) {
		await createNotification({
			userId: payment.userId,
			title: "Payment received",
			message: `Payment of ${payment.amount.toString()} ${currency} for complaint "${complaintTitle}" was successful.`,
			type: NotificationType.PAYMENT_RECEIVED,
			complaintId: payment.complaintId,
		});
		return;
	}

	if (outcome.status === PaymentStatus.REFUNDED) {
		await createNotification({
			userId: payment.userId,
			title: "Payment refunded",
			message: `Your payment for complaint "${complaintTitle}" was refunded.`,
			type: NotificationType.PAYMENT_RECEIVED,
			complaintId: payment.complaintId,
		});
		return;
	}

	if (outcome.status === PaymentStatus.CANCELLED) {
		await createNotification({
			userId: payment.userId,
			title: "Payment cancelled",
			message: `Payment for complaint "${complaintTitle}" was cancelled before completion.`,
			type: NotificationType.PAYMENT_FAILED,
			complaintId: payment.complaintId,
		});
		return;
	}

	if (outcome.status === PaymentStatus.FAILED) {
		await createNotification({
			userId: payment.userId,
			title: "Payment failed",
			message: `Payment for complaint "${complaintTitle}" could not be completed.`,
			type: NotificationType.PAYMENT_FAILED,
			complaintId: payment.complaintId,
		});
	}
};

const applyPaymentOutcome = async (
	paymentId: string,
	outcome: IPaymentOutcome,
) => {
	const payment = await findPaymentOrThrow(paymentId);

	if (isDowngrade(payment.status, outcome.status)) {
		return { payment, skipped: true };
	}

	const alreadyInState = payment.status === outcome.status;

	const result = await prisma.payment.update({
		where: { id: paymentId },
		data: {
			status: outcome.status,
			...(outcome.status === PaymentStatus.PAID && {
				paidAt: new Date().toISOString(),
			}),
			...(outcome.trxId && { bkashTrxId: outcome.trxId }),
			...(outcome.paymentIntentId && {
				stripePaymentIntentId: outcome.paymentIntentId,
			}),
			...(outcome.sessionId && { stripeSessionId: outcome.sessionId }),
			...(outcome.customerId && { stripeCustomerId: outcome.customerId }),
			...(outcome.eventId && { stripeEventId: outcome.eventId }),
			gatewayResponse: outcome.gatewayResponse,
		},
		include: {
			complaint: {
				select: {
					id: true,
					title: true,
				},
			},
		},
	});

	if (!alreadyInState && outcome.status !== PaymentStatus.PENDING) {
		await notifyPaymentOutcome(payment, result.complaint.title, outcome);

		await writeAuditLog({
			userId: payment.userId,
			action: `PAYMENT_${outcome.status}`,
			entityType: "PAYMENT",
			entityId: paymentId,
			metadata: {
				method: outcome.source,
				gateway: resolveGateway(payment),
				trxID: outcome.trxId ?? null,
				paymentIntentId: outcome.paymentIntentId ?? null,
				amount: payment.amount.toString(),
			},
		});
	}

	return { payment: result, skipped: false };
};

const finalizeBkashResult = async (
	paymentId: string,
	gatewayData: Record<string, unknown>,
	source: "execute" | "query" | "webhook",
) => {
	const transactionStatus = String(
		gatewayData.transactionStatus ?? "",
	).toUpperCase();
	const trxID = gatewayData.trxID ? String(gatewayData.trxID) : null;

	const status =
		transactionStatus === "COMPLETED"
			? PaymentStatus.PAID
			: transactionStatus === "CANCELLED" || transactionStatus === "REFUNDED"
				? PaymentStatus.CANCELLED
				: PaymentStatus.FAILED;

	return applyPaymentOutcome(paymentId, {
		status,
		source,
		trxId: trxID,
		gatewayResponse: gatewayData as Prisma.InputJsonValue,
	});
};

const resolveStripeSessionStatus = (session: Record<string, unknown>) => {
	const sessionStatus = String(session.status ?? "").toLowerCase();
	const paymentStatus = String(session.payment_status ?? "").toLowerCase();

	if (sessionStatus === "expired") {
		return PaymentStatus.CANCELLED;
	}

	if (paymentStatus === "paid" || paymentStatus === "no_payment_required") {
		return PaymentStatus.PAID;
	}

	return PaymentStatus.PENDING;
};

const extractPaymentIntentId = (object: Record<string, unknown>) => {
	const intent = object.payment_intent;

	if (typeof intent === "string") {
		return intent;
	}

	if (intent && typeof intent === "object" && "id" in intent) {
		return String((intent as { id: unknown }).id);
	}

	return typeof object.id === "string" && object.id.startsWith("pi_")
		? object.id
		: null;
};

const finalizeStripeSession = async (
	paymentId: string,
	session: Record<string, unknown>,
	source: "execute" | "query" | "webhook",
	eventId?: string | null,
) => {
	const paymentIntentId = extractPaymentIntentId(session);
	const customerId =
		typeof session.customer === "string" ? session.customer : null;

	return applyPaymentOutcome(paymentId, {
		status: resolveStripeSessionStatus(session),
		source,
		paymentIntentId,
		sessionId: typeof session.id === "string" ? session.id : null,
		customerId,
		eventId: eventId ?? null,
		gatewayResponse: session as Prisma.InputJsonValue,
	});
};

const executePayment = async (paymentId: string, actor: IPaymentActor) => {
	const payment = await findPaymentOrThrow(paymentId);
	assertPaymentAccess(payment, actor);

	if (payment.status === PaymentStatus.PAID) {
		return { alreadyProcessed: true, payment };
	}

	if (resolveGateway(payment) === "stripe") {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Stripe payments cannot be executed manually. Payment is confirmed by the Stripe webhook. Use GET /api/v1/payments/:id/status to sync.",
		);
	}

	if (!payment.bkashPaymentId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Payment has no gateway reference to execute",
		);
	}

	const gatewayData = await bkash.executePayment(payment.bkashPaymentId);

	const { payment: result } = await finalizeBkashResult(
		paymentId,
		gatewayData as Record<string, unknown>,
		"execute",
	);

	return { alreadyProcessed: false, payment: result };
};

const queryPaymentStatus = async (paymentId: string, actor: IPaymentActor) => {
	const payment = await findPaymentOrThrow(paymentId);
	assertPaymentAccess(payment, actor);

	if (payment.status === PaymentStatus.PAID) {
		return { alreadyProcessed: true, payment };
	}

	if (resolveGateway(payment) === "stripe") {
		if (!payment.stripeSessionId) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Payment has no Stripe session reference to query",
			);
		}

		const session = await stripe.retrieveSession(payment.stripeSessionId);

		const { payment: result } = await finalizeStripeSession(
			paymentId,
			session,
			"query",
		);

		return { alreadyProcessed: false, payment: result };
	}

	if (!payment.bkashPaymentId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Payment has no gateway reference to query",
		);
	}

	const gatewayData = await bkash.queryPayment(payment.bkashPaymentId);

	const { payment: result } = await finalizeBkashResult(
		paymentId,
		gatewayData as Record<string, unknown>,
		"query",
	);

	return { alreadyProcessed: false, payment: result };
};

const getPaymentById = async (paymentId: string, actor: IPaymentActor) => {
	const payment = await findPaymentOrThrow(paymentId);
	assertPaymentAccess(payment, actor);
	return payment;
};

const getMyPayments = async (
	actor: IPaymentActor,
	query: Record<string, unknown>,
) => {
	const pagination = parsePagination(query as never);
	const { status, gateway } = query as { status?: string; gateway?: string };

	const where: Record<string, unknown> = {
		userId: actor.userId,
	};

	if (status) {
		where.status = status;
	}

	if (gateway) {
		where.paymentGateway = gateway;
	}

	const [payments, total] = await Promise.all([
		prisma.payment.findMany({
			where: where as never,
			skip: pagination.skip,
			take: pagination.limit,
			orderBy: { createdAt: "desc" },
			include: {
				complaint: {
					select: {
						id: true,
						title: true,
						status: true,
					},
				},
			},
		}),
		prisma.payment.count({ where: where as never }),
	]);

	return {
		data: payments,
		meta: buildPaginationMeta(total, pagination),
	};
};

const getAllPayments = async (query: Record<string, unknown>) => {
	const pagination = parsePagination(query as never);
	const { status, complaintId, gateway } = query as {
		status?: string;
		complaintId?: string;
		gateway?: string;
	};

	const where: Record<string, unknown> = {};

	if (status) {
		where.status = status;
	}

	if (complaintId) {
		where.complaintId = complaintId;
	}

	if (gateway) {
		where.paymentGateway = gateway;
	}

	const [payments, total] = await Promise.all([
		prisma.payment.findMany({
			where: where as never,
			skip: pagination.skip,
			take: pagination.limit,
			orderBy: { createdAt: "desc" },
			include: {
				complaint: {
					select: {
						id: true,
						title: true,
						status: true,
					},
				},
				user: {
					omit: {
						password: true,
					} as const,
				},
			},
		}),
		prisma.payment.count({ where: where as never }),
	]);

	return {
		data: payments,
		meta: buildPaginationMeta(total, pagination),
	};
};

const handleBkashWebhook = async (payload: Record<string, unknown>) => {
	const paymentID = payload.paymentID ?? payload.paymentId;

	if (!paymentID) {
		throw new AppError(httpStatus.BAD_REQUEST, "paymentID is required");
	}

	const payment = await prisma.payment.findUnique({
		where: { bkashPaymentId: String(paymentID) },
	});

	if (!payment) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No payment found for this gateway reference",
		);
	}

	const gatewayData = await bkash.queryPayment(String(paymentID));

	await finalizeBkashResult(
		payment.id,
		gatewayData as Record<string, unknown>,
		"webhook",
	);

	return { received: true, gateway: "bkash" };
};

const markStripeEventProcessed = async (eventId: string) => {
	try {
		const cached = await redisClient.set(`stripe:event:${eventId}`, "1", {
			NX: true,
			EX: STRIPE_EVENT_TTL_SECONDS,
		});

		return cached === "OK";
	} catch {
		const existing = await prisma.payment.findFirst({
			where: { stripeEventId: eventId },
			select: { id: true },
		});

		return !existing;
	}
};

const findPaymentForStripeEvent = async (event: IStripeEvent) => {
	const object = event.data?.object ?? {};
	const metadata = (object.metadata ?? {}) as Record<string, unknown>;

	const sessionId =
		typeof object.id === "string" && object.id.startsWith("cs_")
			? object.id
			: null;
	const paymentIntentId = extractPaymentIntentId(object);
	const paymentId =
		typeof metadata.paymentId === "string" && metadata.paymentId
			? metadata.paymentId
			: null;

	if (sessionId) {
		return prisma.payment.findUnique({ where: { stripeSessionId: sessionId } });
	}

	if (paymentIntentId) {
		return prisma.payment.findFirst({
			where: { stripePaymentIntentId: paymentIntentId },
		});
	}

	if (paymentId) {
		return prisma.payment.findUnique({ where: { id: paymentId } });
	}

	return null;
};

const handleStripeWebhook = async (rawBody: Buffer, signature?: string) => {
	const event = stripe.constructEvent(rawBody, signature);

	const isFirstDelivery = await markStripeEventProcessed(event.id);

	if (!isFirstDelivery) {
		return {
			received: true,
			gateway: "stripe",
			duplicate: true,
			eventId: event.id,
		};
	}

	const object = event.data?.object ?? {};
	const payment = await findPaymentForStripeEvent(event);

	if (!payment) {
		return {
			received: true,
			gateway: "stripe",
			ignored: true,
			eventId: event.id,
		};
	}

	switch (event.type) {
		case "checkout.session.completed":
		case "checkout.session.async_payment_succeeded": {
			await finalizeStripeSession(payment.id, object, "webhook", event.id);
			break;
		}
		case "checkout.session.expired": {
			await applyPaymentOutcome(payment.id, {
				status: PaymentStatus.CANCELLED,
				source: "webhook",
				sessionId: typeof object.id === "string" ? object.id : null,
				eventId: event.id,
				gatewayResponse: object as Prisma.InputJsonValue,
			});
			break;
		}
		case "payment_intent.succeeded": {
			await applyPaymentOutcome(payment.id, {
				status: PaymentStatus.PAID,
				source: "webhook",
				paymentIntentId: extractPaymentIntentId(object),
				eventId: event.id,
				gatewayResponse: object as Prisma.InputJsonValue,
			});
			break;
		}
		case "payment_intent.payment_failed":
		case "payment_intent.canceled": {
			await applyPaymentOutcome(payment.id, {
				status: PaymentStatus.FAILED,
				source: "webhook",
				paymentIntentId: extractPaymentIntentId(object),
				eventId: event.id,
				gatewayResponse: object as Prisma.InputJsonValue,
			});
			break;
		}
		case "charge.refunded": {
			const intentId =
				typeof object.payment_intent === "string"
					? object.payment_intent
					: null;

			await applyPaymentOutcome(payment.id, {
				status: PaymentStatus.REFUNDED,
				source: "webhook",
				paymentIntentId: intentId,
				eventId: event.id,
				gatewayResponse: object as Prisma.InputJsonValue,
			});
			break;
		}
		default: {
			return {
				received: true,
				gateway: "stripe",
				ignored: true,
				eventType: event.type,
				eventId: event.id,
			};
		}
	}

	return {
		received: true,
		gateway: "stripe",
		eventType: event.type,
		eventId: event.id,
		paymentId: payment.id,
	};
};

const refundPayment = async (
	paymentId: string,
	actor: IPaymentActor,
	payload: { amount?: number; reason: string },
) => {
	const payment = await findPaymentOrThrow(paymentId);

	if (payment.status !== PaymentStatus.PAID) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Only successful payments can be refunded",
		);
	}

	const refundAmount = toAmountString(payment.amount, payload.amount);

	if (resolveGateway(payment) === "stripe") {
		if (!payment.stripePaymentIntentId) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Payment is missing the Stripe payment intent reference",
			);
		}

		const refund = await stripe.refundPayment({
			paymentIntentId: payment.stripePaymentIntentId,
			amount: refundAmount as string,
			reason: "requested_by_customer",
		});

		const { payment: _outcome } = await applyPaymentOutcome(paymentId, {
			status: PaymentStatus.REFUNDED,
			source: "refund",
			paymentIntentId: payment.stripePaymentIntentId,
			gatewayResponse: {
				refundId: refund.refundId,
				status: refund.status,
				raw: refund.raw as Prisma.InputJsonValue,
			},
		});

		await prisma.payment.update({
			where: { id: paymentId },
			data: {
				refundTrxId: refund.refundId ?? undefined,
				refundAmount: new Prisma.Decimal(refundAmount as string),
				refundReason: payload.reason,
				refundedAt: new Date().toISOString(),
			},
		});

		await writeAuditLog({
			userId: actor.userId,
			action: "PAYMENT_REFUNDED",
			entityType: "PAYMENT",
			entityId: paymentId,
			metadata: {
				gateway: "stripe",
				amount: refundAmount,
				refundId: refund.refundId,
			},
		});

		return findPaymentOrThrow(paymentId);
	}

	if (!payment.bkashPaymentId || !payment.bkashTrxId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Payment is missing gateway transaction reference",
		);
	}

	const gatewayData = await bkash.refundPayment({
		paymentID: payment.bkashPaymentId,
		amount: refundAmount as string,
		trxID: payment.bkashTrxId,
		reason: payload.reason,
	});

	const refundTrxID = gatewayData.refundTrxID
		? String(gatewayData.refundTrxID)
		: null;

	const result = await prisma.payment.update({
		where: { id: paymentId },
		data: {
			status: PaymentStatus.REFUNDED,
			refundTrxId: refundTrxID ?? undefined,
			refundAmount: new Prisma.Decimal(refundAmount as string),
			refundReason: payload.reason,
			refundedAt: new Date().toISOString(),
			gatewayResponse: gatewayData as Prisma.InputJsonValue,
		},
		include: {
			complaint: {
				select: {
					id: true,
					title: true,
				},
			},
		},
	});

	await createNotification({
		userId: payment.userId,
		title: "Payment refunded",
		message: `Your payment for complaint "${result.complaint.title}" was refunded.`,
		type: NotificationType.PAYMENT_RECEIVED,
		complaintId: payment.complaintId,
	});

	await writeAuditLog({
		userId: actor.userId,
		action: "PAYMENT_REFUNDED",
		entityType: "PAYMENT",
		entityId: paymentId,
		metadata: {
			gateway: "bkash",
			amount: refundAmount,
			refundTrxID,
		},
	});

	return result;
};

export const PaymentService = {
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
