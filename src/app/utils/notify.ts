import { NotificationType } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";

export interface INotificationPayload {
	userId: string;
	title: string;
	message: string;
	type?: NotificationType;
	complaintId?: string;
}

export const createNotification = async (payload: INotificationPayload) => {
	try {
		const notification = await prisma.notification.create({
			data: {
				userId: payload.userId,
				title: payload.title,
				message: payload.message,
				type: payload.type ?? NotificationType.INFO,
				complaintId: payload.complaintId ?? null,
			},
		});

		return notification;
	} catch (error) {
		console.error("Failed to create notification:", error);
		return null;
	}
};
