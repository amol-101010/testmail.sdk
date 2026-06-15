// ─── Public SDK types ─────────────────────────────────────────────────────────

/**
 * An active temporary or permanent inbox.
 */
export interface Inbox {
  /** UUID assigned by the database */
  id: string;
  /** Full email address, e.g. "abc123@testmail.stream" */
  address: string;
  /** The random 8-char prefix that forms the local part of the address */
  prefix: string;
  /**
   * Human-readable alias, e.g. "signup-test".
   * Unique among all active (non-deleted, non-expired) inboxes.
   * null when no alias was provided at creation time.
   */
  alias: string | null;
  /** How long this inbox lives, in minutes. 0 for permanent inboxes. */
  ttlMinutes: number;
  /**
   * If true, this inbox never auto-expires (expiresAt will be year 2099).
   * Requires a Pro plan — createInbox() throws PlanRestrictionError for Free users.
   * Pro plan allows a maximum of 5 permanent inboxes.
   */
  permanent: boolean;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * An email received in an inbox.
 */
export interface Email {
  id: string;
  inboxId: string;
  from: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  /** Raw email size in bytes */
  rawSize: number | null;
  receivedAt: Date;
}

// ─── Request option types ────────────────────────────────────────────────────

export interface CreateInboxOptions {
  /**
   * Human-readable alias for the inbox.
   * Rules: 1–64 chars, lowercase letters / digits / hyphens,
   * cannot start or end with a hyphen.
   * Must be unique among active inboxes — createInbox() will throw
   * AliasConflictError if the alias is already taken.
   */
  alias?: string;
  /**
   * How many minutes this inbox should live.
   * Min: 5 | Max: 1440 (24 h) | Default: 60
   * Ignored when permanent is true.
   */
  ttlMinutes?: number;
  /**
   * Create a permanent inbox that never auto-expires.
   * Requires a Pro plan — throws PlanRestrictionError for Free users.
   * Pro plan allows a maximum of 5 permanent inboxes across all aliases.
   * Throws QuotaExceededError if the 5-inbox cap is reached.
   * @default false
   */
  permanent?: boolean;
}

export interface WaitForEmailOptions {
  /**
   * Total time in ms to wait before giving up.
   * @default 30_000
   */
  timeout?: number;
  /**
   * How often to poll in ms.
   * @default 2_000
   */
  interval?: number;
  /**
   * Optional predicate — waitForEmail returns the first email that passes.
   * If omitted, the first email that arrives is returned.
   */
  filter?: (email: Email) => boolean;
}

export interface ClientOptions {
  /**
   * Your personal API key from the testmail.stream dashboard.
   * Starts with "tm_". Free and Pro users both receive one on sign-up.
   */
  apiKey: string;
  /**
   * API base URL. Default is the production endpoint.
   * Override for local dev or staging.
   * @default "https://testmail.stream"
   */
  baseUrl?: string;
  /**
   * Per-request fetch timeout in ms.
   * @default 10_000
   */
  timeout?: number;
}

// ─── Raw server shapes (internal — never exported) ───────────────────────────

export interface RawInbox {
  id: string;
  address: string;
  prefix: string;
  alias: string | null;
  ttl_minutes: number;
  permanent: boolean;
  created_at: string;
  expires_at: string;
  deleted: boolean;
}

export interface RawMessage {
  id: string;
  inbox_id: string;
  from_addr: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  raw_size: number | null;
  received_at: string;
}
