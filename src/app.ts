import cookieParser from "cookie-parser";
import express, { type Application, type Request, type Response } from "express";
import httpStatus from "http-status";
import cors from "cors";
import config from "./app/config";

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
		message: "Welcome to Healthcare System Backend",
	});
});

export default app;
