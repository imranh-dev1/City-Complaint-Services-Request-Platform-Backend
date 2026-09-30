import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { CategoryService } from "./category.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";

const createCategory = catchAsync(async (req: Request, res: Response) => {
	const result = await CategoryService.createCategory(
		req.body,
		req.user?.userId as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Category created successfully",
		data: result,
	});
});

const getAllCategories = catchAsync(async (req: Request, res: Response) => {
	const result = await CategoryService.getAllCategories();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Categories retrieved successfully",
		data: result,
	});
});

const getCategoryById = catchAsync(async (req: Request, res: Response) => {
	const result = await CategoryService.getCategoryById(req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Category retrieved successfully",
		data: result,
	});
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
	const result = await CategoryService.updateCategory(
		req.params.id as string,
		req.body,
		req.user?.userId as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Category updated successfully",
		data: result,
	});
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
	const result = await CategoryService.deleteCategory(
		req.params.id as string,
		req.user?.userId as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Category deleted successfully",
		data: result,
	});
});

export const CategoryController = {
	createCategory,
	getAllCategories,
	getCategoryById,
	updateCategory,
	deleteCategory,
};
