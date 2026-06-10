import {
  ClientOptions,
  CreateInboxOptions,
  Email,
  Inbox,
  RawInbox,
  RawMessage,
  WaitForEmailOptions,
} from './types.js';
import {
  AliasConflictError,
  ApiError,
  AuthError,
  RequestTimeoutError,
} from './errors.js';
import { pollForEmail } from './poller.js';

// ─── Deserialise raw server shapes → SDK types ───────────────────────────────

function toInbox(raw: RawInbox): Inbox {
  return {
    id:         raw.id,
    address:    raw.address,
    prefix:     raw.prefix,
    alias:      raw.alias,
    ttlMinutes: raw.ttl_minutes,
    createdAt:  new Date(raw.created_at),
    expiresAt:  new Date(raw.expires_at),
  };
}

function toEmail(raw: RawMessage): Email {
  return {
    id:          raw.id,
    inboxId:     raw.inbox_id,
    from:        raw.from_addr,
    subject:     raw.subject,
    bodyText:    raw.body_text,
    bodyHtml:    raw.body_html,
    rawSize:     raw.raw_size,
    receivedAt:  new Date(raw.received_at),
  };
}

// ─── TestmailClient ───────────────────────────────────────────────────────────

/**
 * Main client for the testmail.stream API.
 *
 * @example
 * ```ts
 * import { TestmailClient } from '@testmail/sdk';
 *
 * const client = new TestmailClient({ apiKey: process.env.TESTMAIL_API_KEY! });
 *
 * const inbox = await client.createInbox({ alias: 'signup-test', ttlMinutes: 60 });
 * console.log(inbox.address); // "abc123@testmail.stream"
 *
 * const email = await client.waitForEmail(inbox.id, {
 *   filter: e => e.subject?.includes('Verify') ?? false,
 * });
 * ```
 */
export class TestmailClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: ClientOptions) {
    if (!options.apiKey) throw new Error('TestmailClient: apiKey is required');
    this.apiKey   = options.apiKey;
    this.baseUrl  = (options.baseUrl ?? 'https://worker.testmail.stream').replace(/\/$/, '');
    this.timeout  = options.timeout ?? 10_000;
  }

  // ── Private fetch wrapper ─────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization:  `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body:   body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new RequestTimeoutError(url, this.timeout);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    // Parse JSON body regardless of status (error responses also carry JSON)
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      if (response.status === 401) throw new AuthError(parsed);

      // Alias conflict — server returns 409 with inbox_id + expires_at
      if (response.status === 409 && typeof parsed === 'object' && parsed !== null) {
        const p = parsed as Record<string, string>;
        if (p.inbox_id && p.expires_at) {
          // Extract alias from the request path if we're in createInbox context.
          // The field won't be set here so we pass a placeholder; AliasConflictError
          // is always thrown from createInbox() which adds the alias.
          throw new AliasConflictError('', p.inbox_id, new Date(p.expires_at), parsed);
        }
      }

      const msg = (parsed as { error?: string })?.error ?? response.statusText;
      throw new ApiError(response.status, parsed, msg);
    }

    return parsed as T;
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /**
   * Creates a new temporary inbox.
   *
   * When `alias` is provided the email address will be `alias@<domain>`
   * (e.g. alias "signup-test" → "signup-test@testmail.stream").
   * When omitted a random 8-character prefix is generated instead.
   *
   * @param options.alias       Desired address prefix (e.g. "signup-test").
   *                            Must be unique among active inboxes.
   *                            Throws AliasConflictError if already taken.
   * @param options.ttlMinutes  Inbox lifetime (5–1440 min). Default: 60.
   */
  async createInbox(options: CreateInboxOptions = {}): Promise<Inbox> {
    const { alias, ttlMinutes } = options;
    let raw: RawInbox;
    try {
      raw = await this.request<RawInbox>('POST', '/inbox', {
        alias:       alias,
        ttl_minutes: ttlMinutes,
      });
    } catch (err) {
      // Re-throw AliasConflictError with the alias filled in
      if (err instanceof AliasConflictError && alias) {
        throw new AliasConflictError(alias, err.existingInboxId, err.existingExpiresAt, err.body);
      }
      throw err;
    }
    return toInbox(raw);
  }

  /**
   * Looks up an active inbox by its human-readable alias.
   *
   * @returns The inbox if found and still active, or `null` if the alias
   *          doesn't exist / has expired / has been deleted.
   *
   * @example
   * ```ts
   * const inbox = await client.findByAlias('signup-test');
   * if (inbox) {
   *   console.log('Found:', inbox.address, 'expires', inbox.expiresAt);
   * }
   * ```
   */
  async findByAlias(alias: string): Promise<Inbox | null> {
    try {
      const raw = await this.request<RawInbox>('GET', `/inbox/by-alias/${encodeURIComponent(alias)}`);
      return toInbox(raw);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Returns true if an active inbox with the given alias exists.
   * Convenience wrapper around `findByAlias`.
   */
  async aliasExists(alias: string): Promise<boolean> {
    return (await this.findByAlias(alias)) !== null;
  }

  /**
   * Fetches the details of a single inbox by its ID.
   * Returns `null` if the inbox is not found, expired, or deleted.
   */
  async getInbox(inboxId: string): Promise<Inbox | null> {
    try {
      const raw = await this.request<RawInbox>('GET', `/inbox/${inboxId}`);
      return toInbox(raw);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Returns all active inboxes visible to this API key.
   */
  async listInboxes(): Promise<Inbox[]> {
    const raws = await this.request<RawInbox[]>('GET', '/inboxes');
    return raws.map(toInbox);
  }

  /**
   * Returns all emails received by the given inbox, newest first.
   */
  async getEmails(inboxId: string): Promise<Email[]> {
    const raws = await this.request<RawMessage[]>('GET', `/inbox/${inboxId}/messages`);
    return raws.map(toEmail);
  }

  /**
   * Polls until an email matching `options.filter` arrives, then returns it.
   *
   * Use this in tests after triggering an action that should send an email
   * (form submission, password reset, etc.).
   *
   * @param inboxId - ID of the inbox to watch
   * @param options.timeout  - Max ms to wait (default 30 000)
   * @param options.interval - Polling cadence in ms (default 2 000)
   * @param options.filter   - Predicate; first matching email is returned.
   *                           Defaults to "any email".
   *
   * @throws {TimeoutError} if no matching email arrives within `timeout` ms.
   *
   * @example
   * ```ts
   * const email = await client.waitForEmail(inbox.id, {
   *   timeout: 20_000,
   *   filter: e => e.subject?.toLowerCase().includes('verify') ?? false,
   * });
   * const otp = email.bodyText?.match(/\b\d{6}\b/)?.[0];
   * ```
   */
  async waitForEmail(inboxId: string, options: WaitForEmailOptions = {}): Promise<Email> {
    return pollForEmail(inboxId, () => this.getEmails(inboxId), options);
  }

  /**
   * Soft-deletes an inbox immediately.
   * All emails in the inbox are also discarded.
   * Call this in `afterEach` / teardown to keep the system clean.
   */
  async deleteInbox(inboxId: string): Promise<void> {
    await this.request<{ success: boolean }>('DELETE', `/inbox/${inboxId}`);
  }

  /**
   * Returns an existing active inbox for `alias`, or creates one if none exists.
   *
   * This is the recommended way to get a named inbox when you don't want to
   * handle AliasConflictError yourself.
   *
   * The resulting email address will be `alias@<domain>`.
   *
   * @param alias       Desired address prefix (e.g. "tv-only").
   * @param options     Same options as createInbox (ttlMinutes, permanent).
   *                    Ignored if the inbox already exists.
   *
   * @example
   * ```ts
   * const inbox = await client.getOrCreateInbox('tv-only');
   * console.log(inbox.address); // "tv-only@testmail.stream"
   * ```
   */
  async getOrCreateInbox(alias: string, options: Omit<CreateInboxOptions, 'alias'> = {}): Promise<Inbox> {
    const existing = await this.findByAlias(alias);
    if (existing) return existing;
    return this.createInbox({ ...options, alias });
  }

  /**
   * Resolves an alias or inbox ID to a live Inbox object.
   *
   * Useful when you store only the alias in config and want the runtime
   * inbox object without branching on whether you have an ID or alias.
   *
   * @example
   * ```ts
   * const inbox = await client.resolve('signup-test');   // alias lookup
   * const inbox2 = await client.resolve('550e8400-...');  // id lookup
   * ```
   */
  async resolve(aliasOrId: string): Promise<Inbox | null> {
    // Heuristic: UUIDs contain hyphens in fixed positions; aliases may also
    // have hyphens but are not 36 chars. Try ID first if it looks like a UUID.
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(aliasOrId);

    if (looksLikeUuid) {
      return this.getInbox(aliasOrId);
    }
    return this.findByAlias(aliasOrId);
  }
}
