import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.get("/gateways", PaymentController.getGateways);

router.post(
	"/initiate",
	auth(Role.CITIZEN, Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(PaymentValidation.initiatePaymentSchema),
	PaymentController.initiatePayment,
);

router.post("/webhook/stripe", PaymentController.handleStripeWebhook);

router.post("/webhook/bkash", PaymentController.handleBkashWebhook);

router.post("/webhook", PaymentController.handleBkashWebhook);

router.get(
	"/my-payments",
	auth(Role.CITIZEN, Role.TECHNICIAN, Role.ADMIN, Role.SUPER_ADMIN),
	PaymentController.getMyPayments,
);

router.get(
	"/admin/all",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	PaymentController.getAllPayments,
);

router.post(
	"/:id/execute",
	auth(Role.CITIZEN, Role.ADMIN, Role.SUPER_ADMIN),
	PaymentController.executePayment,
);

router.get(
	"/:id/status",
	auth(Role.CITIZEN, Role.ADMIN, Role.SUPER_ADMIN),
	PaymentController.queryPaymentStatus,
);

router.post(
	"/:id/refund",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(PaymentValidation.refundPaymentSchema),
	PaymentController.refundPayment,
);

router.get(
	"/:id",
	auth(Role.CITIZEN, Role.ADMIN, Role.SUPER_ADMIN),
	PaymentController.getPaymentById,
);

export const PaymentRoutes = router;
