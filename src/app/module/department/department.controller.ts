import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { DepartmentService } from "./department.service";

const createDepartment = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.createDepartment(req.body, req.user?.userId as string);

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: "Department created successfully",
        data: result,
    });
});

const getAllDepartments = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.getAllDepartments(
        req.query as Record<string, unknown>,
        req.user?.userId as string,
    );

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Departments retrieved successfully",
        data: result.data,
        meta: result.meta,
    });
});

const getDepartmentById = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.getDepartmentById(req.params.id as string);

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Department retrieved successfully",
        data: result,
    });
});

const updateDepartment = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.updateDepartment(
        req.params.id as string,
        req.body,
        req.user?.userId as string,
    );

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Department updated successfully",
        data: result,
    });
});

const deleteDepartment = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.deleteDepartment(
        req.params.id as string,
        req.user?.userId as string,
    );

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Department deleted successfully",
        data: result,
    });
});

const assignManager = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.assignManager(
        req.params.id as string,
        req.body.userId,
        req.user?.userId as string,
    );

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Department manager assigned successfully",
        data: result,
    });
});

const getDepartmentTechnicians = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.getDepartmentTechnicians(req.params.id as string);

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Department technicians retrieved successfully",
        data: result,
    });
});

export const DepartmentController = {
    createDepartment,
    getAllDepartments,
    getDepartmentById,
    updateDepartment,
    deleteDepartment,
    assignManager,
    getDepartmentTechnicians,
};