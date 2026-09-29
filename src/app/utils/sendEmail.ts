import ejs from "ejs";
import path from "path";
import config from "../config";
import { transporter } from "../lib/nodemailer";

interface SendEmailOptions {
	to: string;
	subject: string;
	template: string;
	data?: Record<string, unknown>;
}

const sendEmail = async ({
	to,
	subject,
	template,
	data = {},
}: SendEmailOptions) => {
	const templatePath = path.join(
		process.cwd(),
		"src",
		"app",
		"templates",
		`${template}.ejs`,
	);

	const html = await ejs.renderFile(templatePath, {
		...data,
		year: new Date().getFullYear(),
	});

	await transporter.sendMail({
		from: `"City Complaint & Service Request Platform" <${config.smtp_email_sender}>`,
		to,
		subject,
		html,
	});
};

export default sendEmail;
