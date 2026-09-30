
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";

export interface IAuditLogPayload {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
}

export const writeAuditLog = async (payload: IAuditLogPayload) => {
    try {
        await prisma.auditLog.create({
            data: {
                userId: payload.userId ?? null,
                action: payload.action,
                entityType: payload.entityType,
                entityId: payload.entityId ?? null,
                metadata: (payload.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
            },
        });
    } catch (error) {
        console.error("Failed to write audit log:", error);
    }
};