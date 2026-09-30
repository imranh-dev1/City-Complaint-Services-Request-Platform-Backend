export interface IPaginationOptions {
    page: number;
    limit: number;
    skip: number;
    sortBy: string;
    sortOrder: "asc" | "desc";
}

export interface IListQuery {
    page?: string | number;
    limit?: string | number;
    sortBy?: string;
    sortOrder?: string;
}

export const parsePagination = (query: IListQuery): IPaginationOptions => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    const sortBy = query.sortBy || "createdAt";
    const sortOrder = (query.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc";

    return {
        page,
        limit,
        skip: (page - 1) * limit,
        sortBy,
        sortOrder,
    };
};

export const buildOrderBy = <T extends Record<string, unknown>>(
    pagination: IPaginationOptions,
    allowedFields: (keyof T)[],
) => {
    if (!allowedFields.includes(pagination.sortBy as keyof T)) {
        return [{ createdAt: pagination.sortOrder }] as unknown as T[];
    }

    return [
        { [pagination.sortBy]: pagination.sortOrder },
        { createdAt: pagination.sortOrder },
    ] as unknown as T[];
};

export const buildPaginationMeta = (
    total: number,
    pagination: IPaginationOptions,
) => {
    return {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
    };
};