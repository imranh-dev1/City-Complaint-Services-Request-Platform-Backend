export type TPaymentGateway = "bkash" | "stripe";

export interface IInitiatePaymentPayload {
	complaintId: string;
	amount?: number;
	gateway?: TPaymentGateway;
	callbackURL?: string;
	successURL?: string;
	cancelURL?: string;
}

export interface IPaymentActor {
	userId: string;
	role: "CITIZEN" | "TECHNICIAN" | "ADMIN" | "SUPER_ADMIN";
	email?: string;
}
