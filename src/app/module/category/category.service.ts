import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/auditLog";
import type { ICreateCategory, IUpdateCategory } from "./category.interface";
import status from "http-status";

const createCategory = async (payload: ICreateCategory, actorId: string) => {
	const existingCategory = await prisma.category.findUnique({
		where: {
			name: payload.name,
		},
	});

	if (existingCategory && !existingCategory.deletedAt) {
		throw new AppError(status.BAD_REQUEST, "Category already exists");
	}

	const department = await prisma.department.findFirst({
		where: {
			id: payload.departmentId,
			deletedAt: null,
		},
	});

	if (!department) {
		throw new AppError(status.NOT_FOUND, "Department not found");
	}

	const result = await prisma.category.create({
		data: {
			name: payload.name.trim(),
			description: payload.description,
			slaHours: payload.slaHours ?? 48,
			departmentId: payload.departmentId,
		},
		include: {
			department: true,
		},
	});

	await writeAuditLog({
		userId: actorId,
		action: "CATEGORY_CREATED",
		entityType: "CATEGORY",
		entityId: result.id,
		metadata: { name: result.name, departmentId: result.departmentId },
	});

	return result;
};

const getAllCategories = async () => {
	const result = await prisma.category.findMany({
		where: {
			deletedAt: null,
			isActive: true,
		},
		include: {
			department: true,
			_count: {
				select: {
					complaints: true,
				},
			},
		},
		orderBy: {
			createdAt: "desc",
		},
	});

	return result;
};

const getCategoryById = async (id: string) => {
	const result = await prisma.category.findFirst({
		where: {
			id,
			deletedAt: null,
		},
		include: {
			department: true,
			_count: {
				select: {
					complaints: true,
				},
			},
		},
	});

	if (!result) {
		throw new AppError(status.NOT_FOUND, "Category not found");
	}

	return result;
};

const updateCategory = async (
	id: string,
	payload: IUpdateCategory,
	actorId: string,
) => {
	const category = await prisma.category.findFirst({
		where: {
			id,
			deletedAt: null,
		},
	});

	if (!category) {
		throw new AppError(status.NOT_FOUND, "Category not found");
	}

	if (payload.departmentId) {
		const department = await prisma.department.findFirst({
			where: {
				id: payload.departmentId,
				deletedAt: null,
			},
		});

		if (!department) {
			throw new AppError(status.NOT_FOUND, "Department not found");
		}
	}

	const result = await prisma.category.update({
		where: {
			id,
		},
		data: {
			...(payload.name !== undefined && { name: payload.name.trim() }),
			...(payload.description !== undefined && {
				description: payload.description,
			}),
			...(payload.isActive !== undefined && { isActive: payload.isActive }),
			...(payload.slaHours !== undefined && { slaHours: payload.slaHours }),
			...(payload.departmentId !== undefined && {
				departmentId: payload.departmentId,
			}),
		},
		include: {
			department: true,
		},
	});

	await writeAuditLog({
		userId: actorId,
		action: "CATEGORY_UPDATED",
		entityType: "CATEGORY",
		entityId: id,
		metadata: { payload },
	});

	return result;
};

const deleteCategory = async (id: string, actorId: string) => {
	const category = await prisma.category.findFirst({
		where: {
			id,
			deletedAt: null,
		},
	});

	if (!category) {
		throw new AppError(status.NOT_FOUND, "Category not found");
	}

	const result = await prisma.category.update({
		where: {
			id,
		},
		data: {
			deletedAt: new Date(),
			isActive: false,
		},
	});

	await writeAuditLog({
		userId: actorId,
		action: "CATEGORY_DELETED",
		entityType: "CATEGORY",
		entityId: id,
		metadata: { name: category.name },
	});

	return result;
};

export const CategoryService = {
	createCategory,
	getAllCategories,
	getCategoryById,
	updateCategory,
	deleteCategory,
};
