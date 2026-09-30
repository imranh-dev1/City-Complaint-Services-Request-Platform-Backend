import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/auditLog";
import { createNotification } from "../../utils/notify";
import type { ICreateFeedback } from "./feedback.interface";
import {
	ComplaintStatus,
	NotificationType,
	Role,
} from "../../../generated/prisma/enums";

export interface IFeedbackActor {
	userId: string;
	role: Role;
	name?: string;
}

const verifyComplaintAccess = async (
	complaintId: string,
	actor: IFeedbackActor,
) => {
	const complaint = await prisma.complaint.findFirst({
		where: {
			id: complaintId,
			deletedAt: null,
		},
		select: {
			id: true,
			status: true,
			citizenId: true,
			assignedTechnicianId: true,
			title: true,
		},
	});

	if (!complaint) {
		throw new AppError(httpStatus.NOT_FOUND, "Complaint not found");
	}

	if (actor.role === Role.CITIZEN && complaint.citizenId !== actor.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only access your own complaints",
		);
	}

	if (
		actor.role === Role.TECHNICIAN &&
		complaint.assignedTechnicianId !== actor.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not assigned to this complaint",
		);
	}

	return complaint;
};

const createFeedback = async (
	complaintId: string,
	actor: IFeedbackActor,
	payload: ICreateFeedback,
) => {
	const complaint = await verifyComplaintAccess(complaintId, actor);

	if (actor.role !== Role.CITIZEN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only the citizen can submit feedback",
		);
	}

	if (
		complaint.status !== ComplaintStatus.RESOLVED &&
		complaint.status !== ComplaintStatus.CLOSED
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Feedback can only be submitted after the complaint is resolved",
		);
	}

	const existing = await prisma.feedback.findUnique({
		where: {
			complaintId,
		},
	});

	if (existing) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Feedback for this complaint already exists",
		);
	}

	const result = await prisma.$transaction(async (tx) => {
		const feedback = await tx.feedback.create({
			data: {
				complaintId,
				citizenId: actor.userId,
				rating: payload.rating,
				comment: payload.comment,
			},
		});

		const updated = await tx.complaint.update({
			where: { id: complaintId },
			data: {
				status: ComplaintStatus.CLOSED,
			},
			select: {
				id: true,
				status: true,
				assignedTechnicianId: true,
			},
		});

		return { feedback, updated };
	});

	await createNotification({
		userId: complaint.citizenId,
		title: "Complaint closed",
		message: `Complaint "${complaint.title}" has been closed after your feedback.`,
		type: NotificationType.FEEDBACK_RECEIVED,
		complaintId,
	});

	if (result.updated.assignedTechnicianId) {
		await createNotification({
			userId: result.updated.assignedTechnicianId,
			title: "Feedback received",
			message: `Citizen rated the resolved complaint "${complaint.title}" ${payload.rating}/5.`,
			type: NotificationType.FEEDBACK_RECEIVED,
			complaintId,
		});
	}

	await writeAuditLog({
		userId: actor.userId,
		action: "FEEDBACK_SUBMITTED",
		entityType: "COMPLAINT",
		entityId: complaintId,
		metadata: { rating: payload.rating },
	});

	return result.feedback;
};

const getFeedbackByComplaint = async (
	complaintId: string,
	actor: IFeedbackActor,
) => {
	await verifyComplaintAccess(complaintId, actor);

	const feedback = await prisma.feedback.findUnique({
		where: {
			complaintId,
		},
		include: {
			citizen: {
				omit: {
					password: true,
				} as const,
			},
		},
	});

	if (!feedback) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No feedback for this complaint yet",
		);
	}

	return feedback;
};

export const FeedbackService = {
	createFeedback,
	getFeedbackByComplaint,
};
