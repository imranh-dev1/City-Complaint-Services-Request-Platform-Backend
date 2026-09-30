import httpStatus from "http-status";
import multer from "multer";
import { AppError } from "../utils/AppError";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 5;

const ALLOWED_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
]);

const storage = multer.memoryStorage();

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(
            new AppError(
                httpStatus.UNSUPPORTED_MEDIA_TYPE,
                `Unsupported file type "${file.mimetype}". Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
            ),
        );
        return;
    }

    cb(null, true);
};

export const upload = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: MAX_FILES_PER_REQUEST,
    },
    fileFilter,
});

export const uploadLimits = {
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    maxFiles: MAX_FILES_PER_REQUEST,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
};
