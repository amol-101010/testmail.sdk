// ─── SDK error hierarchy ──────────────────────────────────────────────────────

/** Base class for all testmail SDK errors */
export class TestmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestmailError';
    // Maintain proper prototype chain in transpiled code
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the server returns a non-2xx response.
 * Inspect `statusCode` for the HTTP status and `body` for the raw payload.
 */
export class ApiError extends TestmailError {
  constructor(
    public readonly statusCode: number,
    public readonly body: unknown,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown specifically on HTTP 401 — wrong or missing API key.
 */
export class AuthError extends ApiError {
  constructor(body: unknown) {
    super(401, body, 'Invalid or missing API key. Check your `apiKey` option.');
    this.name = 'AuthError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when createInbox() is called with an alias that is already in use
 * by another active inbox.  `existingInboxId` and `existingExpiresAt` let
 * callers decide whether to reuse the existing inbox instead.
 */
export class AliasConflictError extends ApiError {
  constructor(
    public readonly alias: string,
    public readonly existingInboxId: string,
    public readonly existingExpiresAt: Date,
    body: unknown
  ) {
    super(409, body, `Alias "${alias}" is already taken by inbox ${existingInboxId}`);
    this.name = 'AliasConflictError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when waitForEmail() times out without finding a matching email.
 */
export class TimeoutError extends TestmailError {
  constructor(
    public readonly inboxId: string,
    public readonly timeoutMs: number
  ) {
    super(`No matching email arrived in inbox "${inboxId}" within ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a fetch call itself times out (network / server unresponsive).
 */
export class RequestTimeoutError extends TestmailError {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the requested operation requires a Pro plan but the API key
 * belongs to a Free account.
 * Example: calling createInbox({ permanent: true }) on a Free plan.
 */
export class PlanRestrictionError extends ApiError {
  constructor(body: unknown) {
    super(403, body, 'This feature requires a Pro plan. Upgrade at testmail.stream/dashboard.');
    this.name = 'PlanRestrictionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a plan limit has been reached.
 * Example: attempting to create an 11th active temp inbox on Free,
 * or a 6th permanent inbox on Pro.
 * Check `limit` and `current` for details.
 */
export class QuotaExceededError extends ApiError {
  constructor(
    public readonly limit: number,
    public readonly current: number,
    body: unknown
  ) {
    super(409, body, `Plan quota exceeded (limit: ${limit}, current: ${current}). Delete some inboxes or upgrade your plan.`);
    this.name = 'QuotaExceededError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
