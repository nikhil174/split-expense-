// An error the API answers with: { error: message, ...extra } and a status.
// Services and controllers throw it; the error handler (http/responses.ts,
// like Spring's @ControllerAdvice) turns it into the response.
export class ApiError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(message: string, status = 400, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Shorthands for the common ones.
export const notFound = (message = "Not found.") => new ApiError(message, 404);
export const forbidden = (message: string) => new ApiError(message, 403);
export const conflict = (message: string, extra?: Record<string, unknown>) => new ApiError(message, 409, extra);
export const tooMany = () => new ApiError("Too many attempts. Please wait a few minutes and try again.", 429);
export const needGroupAdmin = () => new ApiError("Only a group admin can do that.", 403);
