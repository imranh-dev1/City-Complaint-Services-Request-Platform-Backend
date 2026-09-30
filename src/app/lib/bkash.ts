import config from "../config";
import { AppError } from "../utils/AppError";
import { redisClient } from "./redis";

const TOKEN_KEY = "bkash:access-token";

const requireConfig = () => {
	if (
		!config.bkash_base_url ||
		!config.bkash_app_key ||
		!config.bkash_app_secret ||
		!config.bkash_username ||
		!config.bkash_password
	) {
		throw new AppError(
			503,
			"bKash payment gateway is not configured. Set BKASH_* environment variables.",
		);
	}

	return {
		baseUrl: config.bkash_base_url.replace(/\/$/, ""),
		appKey: config.bkash_app_key,
		appSecret: config.bkash_app_secret,
		username: config.bkash_username,
		password: config.bkash_password,
	};
};

const basicAuthHeader = (appKey: string, appSecret: string) =>
	`Basic ${Buffer.from(`${appKey}:${appSecret}`).toString("base64")}`;

const getAccessToken = async () => {
	const cached = await redisClient.get(TOKEN_KEY);
	if (cached) {
		return cached;
	}

	const { baseUrl, appKey, appSecret, username, password } = requireConfig();

	const response = await fetch(`${baseUrl}/tokenized/checkout/token/grant`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: basicAuthHeader(appKey, appSecret),
		},
		body: JSON.stringify({
			app_key: appKey,
			app_secret: appSecret,
		}),
	});

	const data = (await response.json()) as {
		id_token?: string;
		expires_in?: number;
		statusCode?: string;
		statusMessage?: string;
	};

	if (!response.ok || !data.id_token) {
		throw new AppError(
			502,
			`bKash token grant failed (${data.statusCode ?? "ERR"}): ${data.statusMessage ?? response.statusText}`,
		);
	}

	const ttl = Math.max(60, Number(data.expires_in ?? 3600) - 60);
	await redisClient.set(TOKEN_KEY, data.id_token, { EX: ttl });

	return data.id_token;
};

export interface ICreateBkashPayment {
	amount: string;
	merchantInvoiceNumber: string;
	payerReference: string;
	callbackURL: string;
}

const createPayment = async (payload: ICreateBkashPayment) => {
	const { baseUrl, appKey } = requireConfig();
	const idToken = await getAccessToken();

	const response = await fetch(`${baseUrl}/tokenized/checkout/create`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: `Bearer ${idToken}`,
			"X-APP-Key": appKey,
		},
		body: JSON.stringify({
			mode: "0011",
			payerReference: payload.payerReference,
			callbackURL: payload.callbackURL,
			amount: payload.amount,
			currency: "BDT",
			intent: "sale",
			merchantInvoiceNumber: payload.merchantInvoiceNumber,
		}),
	});

	const data = (await response.json()) as {
		paymentID?: string;
		bkashURL?: string;
		statusCode?: string;
		statusMessage?: string;
	};

	if (!response.ok || !data.paymentID) {
		throw new AppError(
			502,
			`bKash payment creation failed (${data.statusCode ?? "ERR"}): ${data.statusMessage ?? response.statusText}`,
		);
	}

	return {
		paymentID: data.paymentID as string,
		bkashURL: data.bkashURL as string,
	};
};

const executePayment = async (paymentID: string) => {
	const { baseUrl, appKey } = requireConfig();
	const idToken = await getAccessToken();

	const response = await fetch(`${baseUrl}/tokenized/checkout/execute`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: `Bearer ${idToken}`,
			"X-APP-Key": appKey,
		},
		body: JSON.stringify({ paymentID }),
	});

	const data = (await response.json()) as Record<string, unknown>;

	if (!response.ok) {
		throw new AppError(502, "bKash payment execution failed");
	}

	return data;
};

const queryPayment = async (paymentID: string) => {
	const { baseUrl, appKey } = requireConfig();
	const idToken = await getAccessToken();

	const response = await fetch(`${baseUrl}/tokenized/checkout/payment/status`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: `Bearer ${idToken}`,
			"X-APP-Key": appKey,
		},
		body: JSON.stringify({ paymentID }),
	});

	const data = (await response.json()) as Record<string, unknown>;

	if (!response.ok) {
		throw new AppError(502, "bKash payment status query failed");
	}

	return data;
};

export interface IRefundBkashPayment {
	paymentID: string;
	amount: string;
	trxID: string;
	reason: string;
}

const refundPayment = async (payload: IRefundBkashPayment) => {
	const { baseUrl, appKey } = requireConfig();
	const idToken = await getAccessToken();

	const response = await fetch(`${baseUrl}/tokenized/checkout/payment/refund`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: `Bearer ${idToken}`,
			"X-APP-Key": appKey,
		},
		body: JSON.stringify({
			paymentID: payload.paymentID,
			amount: payload.amount,
			trxID: payload.trxID,
			sku: "complaint-service-fee",
			reason: payload.reason,
		}),
	});

	const data = (await response.json()) as Record<string, unknown>;

	if (!response.ok) {
		throw new AppError(502, "bKash refund failed");
	}

	return data;
};

export const bkash = {
	createPayment,
	executePayment,
	queryPayment,
	refundPayment,
};

export const bkashIsConfigured = () => {
	try {
		requireConfig();
		return true;
	} catch {
		return false;
	}
};
