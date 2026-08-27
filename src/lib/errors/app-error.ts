/**
 * Errors carry two audiences: a message safe to show a user, and the
 * underlying cause for the server log. Section 37: users get
 * "Van 01 only has 4 units remaining", never "500 Internal Server Error",
 * and never internal detail.
 */
export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "insufficient_stock"
  | "credit_limit"
  | "unavailable"
  | "unknown";

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** Safe to render in the interface. */
  readonly userMessage: string;
  readonly cause?: unknown;

  constructor(code: AppErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.cause = cause;
  }
}

/** PostgreSQL / PostgREST error shape we care about. */
interface PostgresErrorLike {
  code?: string;
  message?: string;
  details?: string;
}

/**
 * Translate a database error into something a user can act on.
 *
 * The database raises deliberately worded exceptions ("Credit limit
 * exceeded for customer: outstanding ..., sale ..., limit ..."). Those are
 * written for people, so they are surfaced rather than replaced. Anything
 * unrecognised becomes a generic message and the original is logged.
 */
export function fromDatabaseError(error: unknown): AppError {
  const e = error as PostgresErrorLike;
  const message = e?.message ?? "";

  // Raised by our own PL/pgSQL guards.
  if (message.includes("Credit limit exceeded") || message.includes("Credit limit reached")) {
    return new AppError("credit_limit", message, error);
  }
  if (
    message.includes("does not carry enough") ||
    message.includes("Insufficient stock") ||
    // record_sale names the product and the number it actually has, which
    // is what the person standing at the counter needs to hear.
    /^Only \d+ units of /.test(message)
  ) {
    return new AppError("insufficient_stock", message, error);
  }
  // Written for the person reading them, so they are passed through.
  if (
    message.includes("A driver cannot") ||
    message.includes("no van assignment") ||
    message.includes("does not permit recording sales") ||
    message.includes("must say why") ||
    message.includes("Only the salesperson")
  ) {
    return new AppError("forbidden", message, error);
  }
  if (message.includes("append-only")) {
    return new AppError(
      "forbidden",
      "Stock history cannot be edited. Post a correcting movement instead.",
      error,
    );
  }
  if (message.includes("Cross-organization reference")) {
    return new AppError("forbidden", "That record belongs to another organization.", error);
  }
  if (message.startsWith("Permission denied") || message.includes("cannot approve their own")) {
    return new AppError("forbidden", message, error);
  }

  switch (e?.code) {
    case "42501": // insufficient_privilege
      return new AppError("forbidden", "You do not have permission to do that.", error);
    case "23505": // unique_violation
      return new AppError("conflict", "That record already exists.", error);
    case "23503": // foreign_key_violation
      return new AppError("validation", "A referenced record does not exist.", error);
    case "23514": // check_violation
      return new AppError("validation", "That value is not allowed.", error);
    case "PGRST116": // no rows when one expected
      return new AppError("not_found", "That record could not be found.", error);
    default:
      return new AppError(
        "unknown",
        "Something went wrong. The details have been logged.",
        error,
      );
  }
}

/** Never let an unknown throw reach the UI as a raw message. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return fromDatabaseError(error);
}
