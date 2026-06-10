// ─── Public SDK types ─────────────────────────────────────────────────────────

/**
 * An active temporary inbox.
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
  /** How long this inbox lives, in minutes */
  ttlMinutes: number;
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
   */
  ttlMinutes?: number;
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
  /** API key issued from the testmail.stream dashboard */
  apiKey: string;
  /**
   * Worker base URL.
   * @default "https://worker.testmail.stream"
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
