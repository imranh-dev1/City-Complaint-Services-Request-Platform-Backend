import crypto from "node:crypto";
import config from "../config";
import { AppError } from "../utils/AppError";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

const requireConfig = () => {
	if (!config.stripe_secret_key) {
		throw new AppError(
			503,
			"Stripe payment gateway is not configured. Set STRIPE_SECRET_KEY environment variable.",
		);
	}

	return {
		secretKey: config.stripe_secret_key,
		webhookSecret: config.stripe_webhook_secret,
		currency: (config.stripe_currency || "BDT").toUpperCase(),
		successUrl: config.stripe_success_url,
		cancelUrl: config.stripe_cancel_url,
		tolerance: Number(config.stripe_webhook_tolerance || 300),
	};
};

type TStripeForm = Record<string, string | number | boolean | undefined>;

const encodeForm = (payload: TStripeForm) =>
	Object.entries(payload)
		.filter(([, value]) => value !== undefined && value !== "")
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
		)
		.join("&");

const toMinorUnits = (amount: string | number) =>
	Math.round(Number(amount) * 100);

const request = async (
	method: "GET" | "POST",
	path: string,
	form?: TStripeForm,
) => {
	const { secretKey } = requireConfig();

	const response = await fetch(`${STRIPE_API_BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${secretKey}`,
			...(method === "POST" && {
				"Content-Type": "application/x-www-form-urlencoded",
			}),
		},
		...(method === "POST" && form && { body: encodeForm(form) }),
	});

	const data = (await response.json()) as Record<string, unknown> & {
		error?: { message?: string; type?: string };
	};

	if (!response.ok) {
		throw new AppError(
			502,
			`Stripe request failed (${data.error?.type ?? response.status}): ${data.error?.message ?? response.statusText}`,
		);
	}

	return data;
};

export interface ICreateStripeCheckout {
	paymentId: string;
	complaintId: string;
	amount: string;
	merchantInvoiceNumber: string;
	payerReference?: string;
	description: string;
	successURL?: string;
	cancelURL?: string;
}

const createCheckoutSession = async (payload: ICreateStripeCheckout) => {
	const { currency, successUrl, cancelUrl } = requireConfig();

	const data = await request("POST", "/checkout/sessions", {
		mode: "payment",
		success_url: payload.successURL ?? successUrl,
		cancel_url: payload.cancelURL ?? cancelUrl,
		client_reference_id: payload.merchantInvoiceNumber,
		customer_email: payload.payerReference,
		"line_items[0][price_data][currency]": currency.toLowerCase(),
		"line_items[0][price_data][unit_amount]": toMinorUnits(payload.amount),
		"line_items[0][price_data][product_data][name]": payload.description,
		"line_items[0][quantity]": 1,
		"metadata[paymentId]": payload.paymentId,
		"metadata[complaintId]": payload.complaintId,
		"metadata[merchantInvoiceNumber]": payload.merchantInvoiceNumber,
	});

	if (!data.id) {
		throw new AppError(502, "Stripe checkout session creation failed");
	}

	return {
		sessionId: String(data.id),
		checkoutUrl: typeof data.url === "string" ? data.url : null,
	};
};

const retrieveSession = async (sessionId: string) =>
	request(
		"GET",
		`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
	);

const retrievePaymentIntent = async (paymentIntentId: string) =>
	request("GET", `/payment_intents/${encodeURIComponent(paymentIntentId)}`);

export interface IRefundStripePayment {
	paymentIntentId: string;
	amount: string;
	reason?: string;
}

const refundPayment = async (payload: IRefundStripePayment) => {
	const data = await request("POST", "/refunds", {
		payment_intent: payload.paymentIntentId,
		amount: toMinorUnits(payload.amount),
		reason: payload.reason,
	});

	return {
		refundId: data.id ? String(data.id) : null,
		status: data.status ? String(data.status) : null,
		raw: data,
	};
};

export interface IStripeEvent {
	id: string;
	type: string;
	data: {
		object: Record<string, unknown>;
	};
}

const constructEvent = (
	rawBody: Buffer,
	signatureHeader?: string,
): IStripeEvent => {
	const { webhookSecret, tolerance } = requireConfig();

	if (!webhookSecret) {
		throw new AppError(503, "Stripe webhook secret is not configured");
	}

	if (!signatureHeader) {
		throw new AppError(400, "Missing Stripe-Signature header");
	}

	const parts = signatureHeader.split(",");
	const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
	const signatures = parts
		.filter((part) => part.startsWith("v1="))
		.map((part) => part.slice(3));

	if (!timestamp || signatures.length === 0) {
		throw new AppError(400, "Malformed Stripe-Signature header");
	}

	const age = Math.abs(Date.now() / 1000 - Number(timestamp));

	if (!Number.isFinite(age) || age > tolerance) {
		throw new AppError(
			400,
			"Stripe signature timestamp is outside the allowed tolerance",
		);
	}

	const expected = crypto
		.createHmac("sha256", webhookSecret)
		.update(`${timestamp}.${rawBody.toString("utf8")}`)
		.digest("hex");

	const expectedBuffer = Buffer.from(expected, "utf8");
	const matched = signatures.some((signature) => {
		const candidate = Buffer.from(signature, "utf8");
		return (
			candidate.length === expectedBuffer.length &&
			crypto.timingSafeEqual(candidate, expectedBuffer)
		);
	});

	if (!matched) {
		throw new AppError(400, "Stripe signature verification failed");
	}

	let event: IStripeEvent;

	try {
		event = JSON.parse(rawBody.toString("utf8")) as IStripeEvent;
	} catch {
		throw new AppError(400, "Stripe webhook payload is not valid JSON");
	}

	if (!event?.id || !event?.type) {
		throw new AppError(400, "Stripe webhook payload is missing id or type");
	}

	return event;
};

export const stripe = {
	createCheckoutSession,
	retrieveSession,
	retrievePaymentIntent,
	refundPayment,
	constructEvent,
};

export const stripeIsConfigured = () => {
	try {
		requireConfig();
		return true;
	} catch {
		return false;
	}
};
