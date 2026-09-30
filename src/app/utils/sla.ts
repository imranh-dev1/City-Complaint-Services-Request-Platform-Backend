import { ComplaintStatus } from "../../generated/prisma/enums";

 


export type SlaStatus = "ON_TRACK" | "APPROACHING" | "BREACHED" | "COMPLETED_ON_TIME" | "COMPLETED_LATE" | "PENDING";

export interface ISlaInfo {
    slaStatus: SlaStatus;
    slaDeadline: Date | null;
    resolvedAt: Date | null;
    remainingHours: number | null;
    isSlaBreached: boolean;
}

interface ISlaComplaint {
    status: ComplaintStatus;
    slaDeadline?: Date | null;
    resolvedAt?: Date | null;
}

export const computeSlaStatus = (
    complaint: ISlaComplaint,
    totalHours: number,
): ISlaInfo => {
    const deadline = complaint.slaDeadline ?? null;
    const resolvedAt = complaint.resolvedAt ?? null;

    const isTerminal =
        complaint.status === ComplaintStatus.RESOLVED || complaint.status === ComplaintStatus.CLOSED;

    if (!deadline) {
        return {
            slaStatus: "PENDING",
            slaDeadline: deadline,
            resolvedAt,
            remainingHours: null,
            isSlaBreached: false,
        };
    }

    const now = new Date();
    const remainingMs = deadline.getTime() - now.getTime();
    const remainingHours = Math.max(0, remainingMs / (1000 * 60 * 60));

    if (isTerminal && resolvedAt) {
        const wasOnTime = resolvedAt <= deadline;
        return {
            slaStatus: wasOnTime ? "COMPLETED_ON_TIME" : "COMPLETED_LATE",
            slaDeadline: deadline,
            resolvedAt,
            remainingHours,
            isSlaBreached: !wasOnTime,
        };
    }

    if (remainingMs <= 0) {
        return {
            slaStatus: "BREACHED",
            slaDeadline: deadline,
            resolvedAt,
            remainingHours: 0,
            isSlaBreached: true,
        };
    }

    const approachingThreshold = Math.max(1, totalHours * 0.25);

    return {
        slaStatus: remainingHours <= approachingThreshold ? "APPROACHING" : "ON_TRACK",
        slaDeadline: deadline,
        resolvedAt,
        remainingHours,
        isSlaBreached: false,
    };
};