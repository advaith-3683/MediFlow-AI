const multer = require("multer");

class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const errorHandler = (error, _req, res, _next) => {
  let status = Number(error.status || error.statusCode) || 500;
  let message = status >= 500 && !(error instanceof AppError) ? "Internal server error" : error.message;
  let code = error.code;

  if (error.message === "Origin is not allowed by CORS") {
    status = 403; message = "Origin is not allowed"; code = "CORS_ORIGIN_DENIED";
  } else if (error instanceof multer.MulterError) {
    status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message = error.code === "LIMIT_FILE_SIZE" ? "File must be 10 MB or smaller" : "Invalid file upload";
  } else if (error.name === "VersionError") {
    status = 409; message = "Record changed during this request. Reload before retrying"; code = "STALE_RECORD";
  } else if (error.name === "ValidationError" || error.name === "CastError") {
    status = 400; message = "Invalid request data"; code = "INVALID_REQUEST";
  } else if (error.code === 11000) {
    status = 409; message = "A record with those details already exists"; code = "DUPLICATE_RECORD";
  } else if (error.message?.startsWith("Only PDF")) {
    status = 400; message = error.message; code = "UNSUPPORTED_FILE_TYPE";
  }

  // Error names/codes can also contain external or user-supplied data.
  if (status >= 500) console.error("Request failed");
  const body = { message: message || "Request failed" };
  if (typeof code === "string") body.code = code;
  res.status(status).json(body);
};

module.exports = { AppError, errorHandler };
