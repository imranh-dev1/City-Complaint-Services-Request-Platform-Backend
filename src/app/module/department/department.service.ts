import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
    ICreateDepartment,
    IUpdateDepartment,
} from "./department.interface";
import { Role } from "../../../generated/prisma/enums";
import { writeAuditLog } from "../../utils/auditLog";
import { buildOrderBy, buildPaginationMeta, parsePagination } from "../../utils/pagination";
const createDepartment = async (payload: ICreateDepartment, actorId: string) => {
    const existing = await prisma.department.findFirst({
        where: {
            OR: [{ name: payload.name }, { code: payload.code }],
        },
    });

    if (existing && !existing.deletedAt) {
        throw new AppError(httpStatus.CONFLICT, "Department with this name or code already exists");
    }

    const result = await prisma.department.create({
        data: {
            name: payload.name.trim(),
            code: payload.code.trim().toUpperCase(),
            description: payload.description,
        },
        include: {
            manager: {
                omit: {
                    password: true,
                },
            },
            _count: {
                select: {
                    staff: true,
                    categories: true,
                    complaints: true,
                },
            },
        },
    });

    await writeAuditLog({
        userId: actorId,
        action: "DEPARTMENT_CREATED",
        entityType: "DEPARTMENT",
        entityId: result.id,
        metadata: { name: result.name, code: result.code },
    });

    return result;
};

const getAllDepartments = async (query: Record<string, unknown>, actorId: string) => {
    const pagination = parsePagination(query as never);
    const { search, isActive, withManager } = query as {
        search?: string;
        isActive?: string;
        withManager?: string;
    };

    const where: Record<string, unknown> = {
        deletedAt: null,
    };

    if (search) {
        where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
        ];
    }

    if (isActive !== undefined) {
        where.isActive = isActive === "true";
    }

    if (withManager === "true") {
        where.managerId = { not: null };
    }

    const [departments, total] = await Promise.all([
        prisma.department.findMany({
            where: where as never,
            skip: pagination.skip,
            take: pagination.limit,
            orderBy: buildOrderBy(pagination, ["name", "createdAt"] as never[]),
            include: {
                manager: {
                    omit: {
                        password: true,
                    },
                },
                _count: {
                    select: {
                        staff: true,
                        categories: true,
                        complaints: true,
                    },
                },
            },
        }),
        prisma.department.count({ where: where as never }),
    ]);

    return {
        data: departments,
        meta: buildPaginationMeta(total, pagination),
    };
};

const getDepartmentById = async (id: string) => {
    const department = await prisma.department.findFirst({
        where: {
            id,
            deletedAt: null,
        },
        include: {
            manager: {
                omit: {
                    password: true,
                },
            },
            categories: {
                where: { deletedAt: null },
            },
            _count: {
                select: {
                    staff: true,
                    complaints: true,
                },
            },
        },
    });

    if (!department) {
        throw new AppError(httpStatus.NOT_FOUND, "Department not found");
    }

    return department;
};

const updateDepartment = async (
    id: string,
    payload: IUpdateDepartment,
    actorId: string,
) => {
    const existing = await prisma.department.findFirst({
        where: { id, deletedAt: null },
    });

    if (!existing) {
        throw new AppError(httpStatus.NOT_FOUND, "Department not found");
    }

    if (payload.name) {
        const nameTaken = await prisma.department.findUnique({
            where: { name: payload.name },
        });
        if (nameTaken && nameTaken.id !== id) {
            throw new AppError(httpStatus.CONFLICT, "Department with this name already exists");
        }
    }

    if (payload.code) {
        const codeTaken = await prisma.department.findUnique({
            where: { code: payload.code },
        });
        if (codeTaken && codeTaken.id !== id) {
            throw new AppError(httpStatus.CONFLICT, "Department with this code already exists");
        }
    }

    const result = await prisma.department.update({
        where: { id },
        data: {
            ...(payload.name !== undefined && { name: payload.name.trim() }),
            ...(payload.code !== undefined && { code: payload.code.trim().toUpperCase() }),
            ...(payload.description !== undefined && { description: payload.description }),
            ...(payload.isActive !== undefined && { isActive: payload.isActive }),
        },
        include: {
            manager: { omit: { password: true } },
        },
    });

    await writeAuditLog({
        userId: actorId,
        action: "DEPARTMENT_UPDATED",
        entityType: "DEPARTMENT",
        entityId: id,
        metadata: { payload },
    });

    return result;
};

const deleteDepartment = async (id: string, actorId: string) => {
    const existing = await prisma.department.findFirst({
        where: { id, deletedAt: null },
        include: {
            _count: {
                select: { categories: true, complaints: true },
            },
        },
    });

    if (!existing) {
        throw new AppError(httpStatus.NOT_FOUND, "Department not found");
    }

    if ((existing._count.categories ?? 0) > 0) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            "Department has active categories. Deactivate or move them before deletion.",
        );
    }

    const result = await prisma.department.update({
        where: { id },
        data: {
            deletedAt: new Date(),
            isActive: false,
        },
    });

    await writeAuditLog({
        userId: actorId,
        action: "DEPARTMENT_DELETED",
        entityType: "DEPARTMENT",
        entityId: id,
        metadata: { name: existing.name },
    });

    return result;
};

const assignManager = async (id: string, userId: string, actorId: string) => {
    const department = await prisma.department.findFirst({
        where: { id, deletedAt: null },
    });

    if (!department) {
        throw new AppError(httpStatus.NOT_FOUND, "Department not found");
    }

    const managerCandidate = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!managerCandidate || managerCandidate.isDeleted) {
        throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }

    const managerRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.TECHNICIAN];
    if (!managerRoles.includes(managerCandidate.role)) {
        throw new AppError(
            httpStatus.BAD_REQUEST,
            "Only ADMIN, SUPER_ADMIN or TECHNICIAN users can be department managers",
        );
    }

    const result = await prisma.$transaction(async (tx) => {
        await tx.department.updateMany({
            where: {
                managerId: userId,
                id: { not: id },
            },
            data: {
                managerId: null,
            },
        });

        return tx.department.update({
            where: { id },
            data: {
                managerId: userId,
            },
            include: {
                manager: { omit: { password: true } },
            },
        });
    });

    await writeAuditLog({
        userId: actorId,
        action: "DEPARTMENT_MANAGER_ASSIGNED",
        entityType: "DEPARTMENT",
        entityId: id,
        metadata: { managerId: userId },
    });

    return result;
};

const getDepartmentTechnicians = async (id: string) => {
    const department = await prisma.department.findFirst({
        where: { id, deletedAt: null },
    });

    if (!department) {
        throw new AppError(httpStatus.NOT_FOUND, "Department not found");
    }

    const technicians = await prisma.user.findMany({
        where: {
            departmentId: id,
            role: Role.TECHNICIAN,
            isDeleted: false,
            technician: {
                isNot: null,
            },
        },
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            imageUrl: true,
            status: true,
            technician: {
                select: {
                    specialization: true,
                    experience: true,
                    rating: true,
                    totalJobs: true,
                    availability: true,
                    isVerified: true,
                    serviceRadius: true,
                    hourlyRate: true,
                },
            },
        },
        orderBy: {
            name: "asc",
        },
    });

    return technicians;
};

export const DepartmentService = {
    createDepartment,
    getAllDepartments,
    getDepartmentById,
    updateDepartment,
    deleteDepartment,
    assignManager,
    getDepartmentTechnicians,
};