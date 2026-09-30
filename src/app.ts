import cookieParser from "cookie-parser";
import express, {
	type Application,
	type Request,
	type Response,
} from "express";
import httpStatus from "http-status";
import cors from "cors";
import config from "./app/config";
import { AuthRoutes } from "./app/module/auth/auth.route";
import { UserRoutes } from "./app/module/user/user.route";
import { notFound } from "./app/middleware/notFound";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { CategoryRoutes } from "./app/module/category/category.route";
import { DepartmentRoutes } from "./app/module/department/department.route";

const app: Application = express();

app.use(
	cors({
		origin: config.frontend_url,
		credentials: true,
	}),
);

app.use(express.urlencoded({ extended: true }));

app.use(express.json());
app.use(cookieParser());

app.get("/", async (req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		message: "Welcome to City Complaint Services Request Platform Backend",
	});
});

app.use("/api/v1/auth", AuthRoutes);
app.use("/api/v1/users", UserRoutes);
app.use("/api/v1/categories", CategoryRoutes);
app.use("/api/v1/departments", DepartmentRoutes);

app.use(notFound);
app.use(globalErrorHandler);

export default app;
