import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { buildPaginationMeta, parsePagination } from "../../utils/pagination";
import httpStatus from "http-status";

const getMyNotifications = async (
	userId: string,
	query: Record<string, unknown>,
) => {
	const pagination = parsePagination(query as never);
	const { isRead } = query as { isRead?: string };

	const effectiveWhere: Record<string, unknown> = { userId };
	if (isRead !== undefined) {
		effectiveWhere.isRead = isRead === "true";
	}

	const [notifications, total] = await Promise.all([
		prisma.notification.findMany({
			where: effectiveWhere as never,
			skip: pagination.skip,
			take: pagination.limit,
			orderBy: {
				createdAt: "desc",
			},
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
		prisma.notification.count({ where: effectiveWhere as never }),
	]);

	return {
		data: notifications,
		meta: buildPaginationMeta(total, pagination),
		unreadCount: await prisma.notification.count({
			where: {
				userId,
				isRead: false,
			},
		}),
	};
};

const markAsRead = async (userId: string, notificationId: string) => {
	const notification = await prisma.notification.findFirst({
		where: {
			id: notificationId,
			userId,
		},
	});

	if (!notification) {
		throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
	}

	const result = await prisma.notification.update({
		where: { id: notificationId },
		data: {
			isRead: true,
		},
	});

	return result;
};

const markAllAsRead = async (userId: string) => {
	const result = await prisma.notification.updateMany({
		where: {
			userId,
			isRead: false,
		},
		data: {
			isRead: true,
		},
	});

	return {
		updatedCount: result.count,
	};
};

export const NotificationService = {
	getMyNotifications,
	markAsRead,
	markAllAsRead,
};
