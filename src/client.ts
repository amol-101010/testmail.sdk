import {
  ClientOptions,
  CreateInboxOptions,
  CreateTeamOptions,
  Email,
  Inbox,
  RawInbox,
  RawMessage,
  RawTeam,
  RawTeamDetail,
  Team,
  TeamDetail,
  TeamMember,
  WaitForEmailOptions,
  WaitForOtpOptions,
  WaitForLinkOptions,
  SearchEmailsOptions,
  EmailPage,
  AttachmentDownload,
  Attachment,
  RawAttachment,
  AuthVerdict,
} from './types.js';
import {
  AliasConflictError,
  ApiError,
  AuthError,
  PlanRestrictionError,
  QuotaExceededError,
  RequestTimeoutError,
} from './errors.js';
import { pollForEmail } from './poller.js';
import {
  extractOtp,
  extractVerificationLink,
  extractLinkByText,
  hasText,
  findEmailBySubject,
  findEmailByText,
} from './extract.js';

// --- Internal helpers ----------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Normalize a Date or string to an ISO-8601 string for query params. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Parse a `Retry-After` header (delta-seconds or HTTP date) into ms, or null. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/** Parse a filename out of a Content-Disposition header, or null. */
function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  // RFC 5987 extended form first: filename*=UTF-8''foo.pdf
  const ext = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(value);
  if (ext?.[1]) {
    try { return decodeURIComponent(ext[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ }
  }
  const basic = /filename="?([^";]+)"?/i.exec(value);
  return basic?.[1]?.trim() ?? null;
}

// --- Deserialise raw server shapes -> SDK types --------------------------------

function toInbox(raw: RawInbox): Inbox {
  return {
    id:         raw.id,
    address:    raw.address,
    prefix:     raw.prefix,
    alias:      raw.alias,
    ttlMinutes: raw.ttl_minutes,
    permanent:  raw.permanent,
    createdAt:  new Date(raw.created_at),
    expiresAt:  new Date(raw.expires_at),
    teamId:     raw.team_id,
  };
}

function toTeam(raw: RawTeam): Team {
  return {
    id:          raw.id,
    name:        raw.name,
    slug:        raw.slug,
    createdAt:   new Date(raw.created_at),
    role:        raw.role,
    memberCount: raw.member_count,
    inboxCount:  raw.inbox_count,
  };
}

function toTeamMember(m: RawTeamDetail['members'][0]): TeamMember {
  return {
    userId:   m.user_id,
    role:     m.role,
    joinedAt: new Date(m.joined_at),
    email:    m.email,
  };
}

function toTeamDetail(raw: RawTeamDetail): TeamDetail {
  return {
    ...toTeam(raw),
    members: raw.members.map(toTeamMember),
  };
}

function toAttachment(raw: RawAttachment): Attachment {
  return {
    id:          raw.id,
    messageId:   raw.message_id,
    filename:    raw.filename,
    mimeType:    raw.mime_type,
    sizeBytes:   raw.size_bytes,
    contentId:   raw.content_id,
    isInline:    raw.is_inline,
    createdAt:   new Date(raw.created_at),
  };
}

const AUTH_VERDICTS = new Set([
  'pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy',
]);

function toVerdict(v: string | null | undefined): AuthVerdict | null {
  if (!v) return null;
  const t = v.toLowerCase();
  return AUTH_VERDICTS.has(t) ? (t as AuthVerdict) : null;
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
    attachments: raw.attachments?.map(toAttachment),
    auth: {
      spf:   toVerdict(raw.spf),
      dkim:  toVerdict(raw.dkim),
      dmarc: toVerdict(raw.dmarc),
    },
  };
}

// --- TestmailClient -----------------------------------------------------------

export class TestmailClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(options: ClientOptions) {
    if (!options.apiKey) throw new Error('TestmailClient: apiKey is required');
    this.apiKey     = options.apiKey;
    this.baseUrl    = (options.baseUrl ?? 'https://testmail-stream.testmailstream.workers.dev').replace(/\/$/, '');
    this.timeout    = options.timeout ?? 10_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.retryDelay = Math.max(0, options.retryDelay ?? 500);
  }

  /**
   * Single fetch with a per-attempt timeout. Throws RequestTimeoutError on
   * abort and rethrows network errors; non-2xx responses are returned as-is
   * (the caller decides how to map them).
   */
  private async fetchOnce(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new RequestTimeoutError(url, this.timeout);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * fetchOnce wrapped with retry-on-transient-failure: network errors, HTTP
   * 429, and 5xx are retried up to `maxRetries` times with exponential backoff
   * (honoring a `Retry-After` header when present). Timeouts are NOT retried —
   * they reflect the caller's configured deadline.
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    while (true) {
      let response: Response;
      try {
        response = await this.fetchOnce(url, init);
      } catch (err) {
        // Don't retry deadline timeouts; do retry transient network errors.
        if (err instanceof RequestTimeoutError || attempt >= this.maxRetries) throw err;
        await sleep(this.backoff(attempt));
        attempt++;
        continue;
      }

      const transient = response.status === 429 || response.status >= 500;
      if (transient && attempt < this.maxRetries) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        await sleep(Math.max(retryAfterMs ?? 0, this.backoff(attempt)));
        attempt++;
        continue;
      }

      return response;
    }
  }

  private backoff(attempt: number): number {
    // Exponential with light jitter to avoid thundering-herd retries.
    const base = this.retryDelay * 2 ** attempt;
    return base + Math.floor(Math.random() * (this.retryDelay / 2));
  }

  /** Maps a non-ok response (with its parsed body) to the right typed error. */
  private throwForResponse(status: number, statusText: string, parsed: unknown): never {
    if (status === 401) throw new AuthError(parsed);

    if (typeof parsed === 'object' && parsed !== null) {
      const p = parsed as Record<string, unknown>;

      if (status === 403 && p.error === 'permanent_inboxes_require_pro') {
        throw new PlanRestrictionError(parsed);
      }

      if (status === 409) {
        if (p.error === 'quota_exceeded' && typeof p.limit === 'number' && typeof p.current === 'number') {
          throw new QuotaExceededError(p.limit, p.current, parsed);
        }
        if (typeof p.inbox_id === 'string' && typeof p.expires_at === 'string') {
          throw new AliasConflictError('', p.inbox_id, new Date(p.expires_at), parsed);
        }
      }
    }

    const msg = (parsed as { error?: string })?.error ?? statusText;
    throw new ApiError(status, parsed, msg);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = this.baseUrl + path;
    const response = await this.fetchWithRetry(url, {
      method,
      headers: {
        Authorization:  'Bearer ' + this.apiKey,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    if (!response.ok) this.throwForResponse(response.status, response.statusText, parsed);

    return parsed as T;
  }

  // -- Inbox methods ----------------------------------------------------------

  async createInbox(options: CreateInboxOptions = {}): Promise<Inbox> {
    const { alias, ttlMinutes, permanent, teamId } = options;
    let raw: RawInbox;
    try {
      raw = await this.request<RawInbox>('POST', '/inbox', {
        alias,
        ttl_minutes: ttlMinutes,
        permanent,
        team_id: teamId,
      });
    } catch (err) {
      if (err instanceof AliasConflictError && alias) {
        throw new AliasConflictError(alias, err.existingInboxId, err.existingExpiresAt, err.body);
      }
      throw err;
    }
    return toInbox(raw);
  }

  async findByAlias(alias: string): Promise<Inbox | null> {
    try {
      const raw = await this.request<RawInbox>('GET', '/inbox/by-alias/' + encodeURIComponent(alias));
      return toInbox(raw);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async aliasExists(alias: string): Promise<boolean> {
    return (await this.findByAlias(alias)) !== null;
  }

  async getInbox(inboxId: string): Promise<Inbox | null> {
    try {
      const raw = await this.request<RawInbox>('GET', '/inbox/' + encodeURIComponent(inboxId));
      return toInbox(raw);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async listInboxes(): Promise<Inbox[]> {
    const raws = await this.request<RawInbox[]>('GET', '/inboxes');
    return raws.map(toInbox);
  }

  /**
   * Fetch the most recent emails in an inbox (newest first, up to 200).
   * For filtering, full-text search, or paging beyond 200, use searchEmails().
   */
  async getEmails(inboxId: string): Promise<Email[]> {
    const raws = await this.request<RawMessage[]>(
      'GET',
      '/inbox/' + encodeURIComponent(inboxId) + '/messages'
    );
    return raws.map(toEmail);
  }

  /**
   * Search/filter emails server-side with cursor pagination. Returns one page
   * of results plus a `nextCursor` (null when there are no more pages).
   */
  async searchEmails(inboxId: string, options: SearchEmailsOptions = {}): Promise<EmailPage> {
    const params = new URLSearchParams();
    // Force the server's paginated response shape even with no other filters.
    params.set('paginate', 'true');
    if (options.query)         params.set('q', options.query);
    if (options.from)          params.set('from', options.from);
    if (options.subject)       params.set('subject', options.subject);
    if (options.since)         params.set('since', toIso(options.since));
    if (options.until)         params.set('until', toIso(options.until));
    if (options.hasAttachment) params.set('hasAttachment', 'true');
    if (options.cursor)        params.set('cursor', options.cursor);
    if (options.limit != null) params.set('limit', String(options.limit));

    const res = await this.request<{ messages: RawMessage[]; nextCursor: string | null }>(
      'GET',
      '/inbox/' + encodeURIComponent(inboxId) + '/messages?' + params.toString()
    );
    return {
      emails: (res.messages ?? []).map(toEmail),
      nextCursor: res.nextCursor ?? null,
    };
  }

  async waitForEmail(inboxId: string, options: WaitForEmailOptions = {}): Promise<Email> {
    return pollForEmail(inboxId, () => this.getEmails(inboxId), options);
  }

  async waitForOtp(inboxId: string, options: WaitForOtpOptions = {}): Promise<string> {
    const { timeout, interval, ...extractOpts } = options;
    let extractedOtp: string | null = null;

    const filterWrapper = (email: Email): boolean => {
      if (options.filter && !options.filter(email)) return false;
      const code = extractOtp(email, extractOpts);
      if (code) {
        extractedOtp = code;
        return true;
      }
      return false;
    };

    await pollForEmail(inboxId, () => this.getEmails(inboxId), {
      timeout,
      interval,
      filter: filterWrapper,
    });

    return extractedOtp!;
  }

  async waitForLink(inboxId: string, options: WaitForLinkOptions = {}): Promise<string> {
    const { timeout, interval, ...extractOpts } = options;
    let extractedLink: string | null = null;

    const filterWrapper = (email: Email): boolean => {
      if (options.filter && !options.filter(email)) return false;
      const link = extractVerificationLink(email, extractOpts);
      if (link) {
        extractedLink = link;
        return true;
      }
      return false;
    };

    await pollForEmail(inboxId, () => this.getEmails(inboxId), {
      timeout,
      interval,
      filter: filterWrapper,
    });

    return extractedLink!;
  }

  async waitForLinkByText(
    inboxId: string,
    linkText: string,
    options: WaitForEmailOptions = {}
  ): Promise<string> {
    const { timeout, interval, filter } = options;
    let extractedLink = '';

    const filterWrapper = (email: Email): boolean => {
      if (filter && !filter(email)) return false;
      const link = extractLinkByText(email, linkText);
      if (link) {
        extractedLink = link;
        return true;
      }
      return false;
    };

    await pollForEmail(inboxId, () => this.getEmails(inboxId), {
      timeout,
      interval,
      filter: filterWrapper,
    });

    return extractedLink;
  }

  extractLinkByText(email: Email, linkText: string): string {
    return extractLinkByText(email, linkText);
  }

  hasText(email: Email, searchText: string): boolean {
    return hasText(email, searchText);
  }

  /**
   * True only if every *reported* auth verdict on the email is `pass`.
   * Methods that weren't reported (null) are ignored. With `require`, you can
   * insist specific methods are present AND pass, e.g.
   * `client.authPassed(email, ['spf', 'dkim'])`.
   */
  authPassed(email: Email, require: Array<'spf' | 'dkim' | 'dmarc'> = []): boolean {
    const a = email.auth;
    for (const m of require) {
      if (a[m] !== 'pass') return false;
    }
    const verdicts: Array<AuthVerdict | null> = [a.spf, a.dkim, a.dmarc];
    return verdicts.every((v) => v === null || v === 'pass');
  }

  findEmailBySubject(emails: Email[], subject: string | RegExp): Email | null {
    return findEmailBySubject(emails, subject);
  }

  findEmailByText(emails: Email[], text: string): Email | null {
    return findEmailByText(emails, text);
  }

  async deleteInbox(inboxId: string): Promise<void> {
    await this.request<{ success: boolean }>('DELETE', '/inbox/' + encodeURIComponent(inboxId));
  }

  async getOrCreateInbox(alias: string, options: Omit<CreateInboxOptions, 'alias'> = {}): Promise<Inbox> {
    const existing = await this.findByAlias(alias);
    if (existing) return existing;
    return this.createInbox({ ...options, alias });
  }

  async resolve(aliasOrId: string): Promise<Inbox | null> {
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(aliasOrId);
    if (looksLikeUuid) return this.getInbox(aliasOrId);
    return this.findByAlias(aliasOrId);
  }

  // -- Team methods -----------------------------------------------------------

  async listTeams(): Promise<Team[]> {
    const res = await this.request<{ teams: RawTeam[] }>('GET', '/teams');
    return res.teams.map(toTeam);
  }

  async createTeam(options: CreateTeamOptions): Promise<Team> {
    const raw = await this.request<RawTeam>('POST', '/teams', options);
    return toTeam(raw);
  }

  async getTeam(teamId: string): Promise<TeamDetail> {
    const raw = await this.request<RawTeamDetail>('GET', '/teams/' + encodeURIComponent(teamId));
    return toTeamDetail(raw);
  }

  async inviteTeamMember(teamId: string, email: string): Promise<void> {
    await this.request('POST', '/teams/' + encodeURIComponent(teamId) + '/members', { email });
  }

  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await this.request(
      'DELETE',
      '/teams/' + encodeURIComponent(teamId) + '/members/' + encodeURIComponent(userId)
    );
  }

  async deleteTeam(teamId: string): Promise<void> {
    await this.request('DELETE', '/teams/' + encodeURIComponent(teamId));
  }

  /**
   * Download an attachment's raw bytes plus its content type and filename.
   * Shares the same timeout + retry transport as every other request.
   */
  async downloadAttachment(attachmentId: string): Promise<AttachmentDownload> {
    const url = this.baseUrl + '/attachment/' + encodeURIComponent(attachmentId);
    const response = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + this.apiKey },
    });

    if (!response.ok) {
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      this.throwForResponse(response.status, response.statusText, parsed);
    }

    // NOTE: Streaming is intentionally deferred while the 25MB cap holds. Entire file is buffered.
    return {
      data: await response.arrayBuffer(),
      contentType: response.headers.get('content-type'),
      filename: parseContentDispositionFilename(response.headers.get('content-disposition')),
    };
  }

  /**
   * Helper to download an attachment by filename, searching within a loaded Email object.
   * Throws an error if attachments metadata is not loaded, if no attachment matches,
   * or if multiple attachments match the name (ambiguous matches).
   */
  async downloadAttachmentByFilename(email: Email, name: string): Promise<AttachmentDownload> {
    if (!email.attachments) {
      throw new Error('Email attachments not loaded; fetch the email with attachment metadata first.');
    }
    const matches = email.attachments.filter(a => a.filename === name);
    if (matches.length === 0) {
      throw new Error(`No attachment named "${name}"`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous: ${matches.length} attachments named "${name}"`);
    }
    return this.downloadAttachment(matches[0].id);
  }
}
