import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestmailClient } from './client.js';
import {
  AuthError,
  ApiError,
  PlanRestrictionError,
  QuotaExceededError,
  AliasConflictError,
} from './errors.js';

function resp(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status ' + status,
    headers: new Headers(headers),
    json: async () => body,
    arrayBuffer: async () =>
      new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer,
  } as unknown as Response;
}

const client = (overrides = {}) =>
  new TestmailClient({ apiKey: 'k', baseUrl: 'https://api.test', retryDelay: 10, ...overrides });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TestmailClient construction', () => {
  it('requires an apiKey', () => {
    // @ts-expect-error intentionally missing apiKey
    expect(() => new TestmailClient({})).toThrow(/apiKey is required/);
  });

  it('strips a trailing slash from baseUrl', async () => {
    const fetch = vi.fn().mockResolvedValue(resp(200, []));
    vi.stubGlobal('fetch', fetch);
    await client({ baseUrl: 'https://api.test/' }).listInboxes();
    expect(fetch.mock.calls[0][0]).toBe('https://api.test/inboxes');
  });
});

describe('error mapping', () => {
  it('maps 401 to AuthError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(401, { error: 'nope' })));
    await expect(client().listInboxes()).rejects.toBeInstanceOf(AuthError);
  });

  it('maps 403 permanent_inboxes_require_pro to PlanRestrictionError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(403, { error: 'permanent_inboxes_require_pro' })));
    await expect(client().createInbox({ permanent: true })).rejects.toBeInstanceOf(PlanRestrictionError);
  });

  it('maps 409 quota_exceeded to QuotaExceededError with limit/current', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(409, { error: 'quota_exceeded', limit: 10, current: 10 })));
    const err = await client().createInbox().catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err.limit).toBe(10);
    expect(err.current).toBe(10);
  });

  it('maps 409 alias conflict to AliasConflictError carrying the alias', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(409, { inbox_id: 'ib1', expires_at: '2030-01-01T00:00:00Z' })));
    const err = await client().createInbox({ alias: 'foo' }).catch((e) => e);
    expect(err).toBeInstanceOf(AliasConflictError);
    expect(err.alias).toBe('foo');
    expect(err.existingInboxId).toBe('ib1');
  });

  it('maps an unknown non-2xx to a generic ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(400, { error: 'bad request' })));
    const err = await client().listInboxes().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(400);
  });

  it('returns null from getInbox on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(404, { error: 'not found' })));
    await expect(client().getInbox('id')).resolves.toBeNull();
  });
});

describe('retry behaviour', () => {
  it('retries a 500 then succeeds', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(resp(500, { error: 'boom' }))
      .mockResolvedValueOnce(resp(200, []));
    vi.stubGlobal('fetch', fetch);
    const p = client().listInboxes();
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a network error then succeeds', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(resp(200, []));
    vi.stubGlobal('fetch', fetch);
    const p = client().listInboxes();
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After on 429', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(resp(429, { error: 'slow down' }, { 'retry-after': '1' }))
      .mockResolvedValueOnce(resp(200, []));
    vi.stubGlobal('fetch', fetch);
    const p = client().listInboxes();
    await vi.advanceTimersByTimeAsync(1100);
    await expect(p).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and throws the ApiError', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(resp(503, { error: 'unavailable' }));
    vi.stubGlobal('fetch', fetch);
    const p = client({ maxRetries: 2 }).listInboxes().catch((e) => e);
    await vi.advanceTimersByTimeAsync(5000);
    const err = await p;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does NOT retry a 4xx', async () => {
    const fetch = vi.fn().mockResolvedValue(resp(400, { error: 'bad' }));
    vi.stubGlobal('fetch', fetch);
    await client().listInboxes().catch(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('searchEmails', () => {
  it('builds query params and parses the paginated shape', async () => {
    const fetch = vi.fn().mockResolvedValue(
      resp(200, {
        messages: [
          {
            id: 'm1', inbox_id: 'ib', from_addr: 'x@y.com', subject: 'hi',
            body_text: 't', body_html: null, raw_size: 5, received_at: '2026-01-01T00:00:00Z',
          },
        ],
        nextCursor: 'CUR',
      })
    );
    vi.stubGlobal('fetch', fetch);
    const page = await client().searchEmails('ib', { query: 'invoice', from: 'x@y.com', limit: 25 });
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toContain('/inbox/ib/messages?');
    expect(url).toContain('paginate=true');
    expect(url).toContain('q=invoice');
    expect(url).toContain('from=x%40y.com');
    expect(url).toContain('limit=25');
    expect(page.nextCursor).toBe('CUR');
    expect(page.emails).toHaveLength(1);
    expect(page.emails[0].from).toBe('x@y.com');
    expect(page.emails[0].receivedAt).toBeInstanceOf(Date);
  });
});

describe('downloadAttachment', () => {
  it('returns bytes plus content-type and parsed filename', async () => {
    const fetch = vi.fn().mockResolvedValue(
      resp(200, 'PDFDATA', {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="report.pdf"',
      })
    );
    vi.stubGlobal('fetch', fetch);
    const out = await client().downloadAttachment('att1');
    expect(out.contentType).toBe('application/pdf');
    expect(out.filename).toBe('report.pdf');
    expect(out.data.byteLength).toBeGreaterThan(0);
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.test/attachment/att1');
  });
});

describe('downloadAttachmentByFilename', () => {
  const sampleEmail = (attachments?: any[]) => ({
    id: 'msg1',
    inboxId: 'ib1',
    from: 'x@y.com',
    subject: 'test',
    bodyText: 'body',
    bodyHtml: null,
    rawSize: 100,
    receivedAt: new Date(),
    attachments,
  }) as any;

  it('downloads the attachment when a unique match is found', async () => {
    const fetch = vi.fn().mockResolvedValue(
      resp(200, 'PDFDATA', {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="report.pdf"',
      })
    );
    vi.stubGlobal('fetch', fetch);

    const email = sampleEmail([
      { id: 'att1', filename: 'report.pdf' },
      { id: 'att2', filename: 'other.png' },
    ]);

    const out = await client().downloadAttachmentByFilename(email, 'report.pdf');
    expect(out.filename).toBe('report.pdf');
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.test/attachment/att1');
  });

  it('throws error when attachments metadata is not loaded', async () => {
    const email = sampleEmail(undefined);
    await expect(client().downloadAttachmentByFilename(email, 'report.pdf')).rejects.toThrow(
      /attachments not loaded/
    );
  });

  it('throws error when no matching attachment is found', async () => {
    const email = sampleEmail([
      { id: 'att2', filename: 'other.png' },
    ]);
    await expect(client().downloadAttachmentByFilename(email, 'report.pdf')).rejects.toThrow(
      /No attachment named "report.pdf"/
    );
  });

  it('throws error when multiple matching attachments are found', async () => {
    const email = sampleEmail([
      { id: 'att1', filename: 'report.pdf' },
      { id: 'att2', filename: 'report.pdf' },
    ]);
    await expect(client().downloadAttachmentByFilename(email, 'report.pdf')).rejects.toThrow(
      /Ambiguous: 2 attachments named "report.pdf"/
    );
  });
});
