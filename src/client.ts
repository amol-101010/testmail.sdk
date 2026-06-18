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
  Attachment,
  RawAttachment,
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
import { extractOtp, extractVerificationLink } from './extract.js';

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
    storageKey:  raw.storage_key,
    createdAt:   new Date(raw.created_at),
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
    attachments: raw.attachments?.map(toAttachment),
  };
}

// --- TestmailClient -----------------------------------------------------------

export class TestmailClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: ClientOptions) {
    if (!options.apiKey) throw new Error('TestmailClient: apiKey is required');
    this.apiKey   = options.apiKey;
    this.baseUrl  = (options.baseUrl ?? 'https://testmail.stream').replace(/\/$/, '');
    this.timeout  = options.timeout ?? 10_000;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization:  'Bearer ' + this.apiKey,
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

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      if (response.status === 401) throw new AuthError(parsed);

      if (typeof parsed === 'object' && parsed !== null) {
        const p = parsed as Record<string, unknown>;

        if (response.status === 403 && p.error === 'permanent_inboxes_require_pro') {
          throw new PlanRestrictionError(parsed);
        }

        if (response.status === 409) {
          if (p.error === 'quota_exceeded' && typeof p.limit === 'number' && typeof p.current === 'number') {
            throw new QuotaExceededError(p.limit, p.current, parsed);
          }
          if (typeof p.inbox_id === 'string' && typeof p.expires_at === 'string') {
            throw new AliasConflictError('', p.inbox_id, new Date(p.expires_at), parsed);
          }
        }
      }

      const msg = (parsed as { error?: string })?.error ?? response.statusText;
      throw new ApiError(response.status, parsed, msg);
    }

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
      const raw = await this.request<RawInbox>('GET', '/inbox/' + inboxId);
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

  async getEmails(inboxId: string): Promise<Email[]> {
    const raws = await this.request<RawMessage[]>('GET', '/inbox/' + inboxId + '/messages');
    return raws.map(toEmail);
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

  async deleteInbox(inboxId: string): Promise<void> {
    await this.request<{ success: boolean }>('DELETE', '/inbox/' + inboxId);
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
    const raw = await this.request<RawTeamDetail>('GET', '/teams/' + teamId);
    return toTeamDetail(raw);
  }

  async inviteTeamMember(teamId: string, email: string): Promise<void> {
    await this.request('POST', '/teams/' + teamId + '/members', { email });
  }

  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await this.request('DELETE', '/teams/' + teamId + '/members/' + userId);
  }

  async deleteTeam(teamId: string): Promise<void> {
    await this.request('DELETE', '/teams/' + teamId);
  }

  async downloadAttachment(attachmentId: string): Promise<ArrayBuffer> {
    const url = this.baseUrl + '/attachment/' + encodeURIComponent(attachmentId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + this.apiKey,
        },
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

    if (!response.ok) {
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      if (response.status === 401) throw new AuthError(parsed);
      const msg = (parsed as { error?: string })?.error ?? response.statusText;
      throw new ApiError(response.status, parsed, msg);
    }

    return response.arrayBuffer();
  }
}
