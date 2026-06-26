import { describe, it, expect, vi, afterEach } from 'vitest';
import { pollForEmail } from './poller.js';
import { TimeoutError } from './errors.js';
import { Email } from './types.js';

const email = (id: string): Email => ({
  id,
  inboxId: 'inbox_1',
  from: 'a@b.com',
  subject: 's',
  bodyText: 'b',
  bodyHtml: null,
  rawSize: 1,
  receivedAt: new Date(),
  auth: { spf: null, dkim: null, dmarc: null },
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('pollForEmail', () => {
  it('returns immediately when a match exists on first fetch', async () => {
    const fetch = vi.fn().mockResolvedValue([email('1')]);
    const result = await pollForEmail('inbox_1', fetch, { interval: 1000, timeout: 5000 });
    expect(result.id).toBe('1');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('polls repeatedly until a matching email arrives', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([email('42')]);
    const promise = pollForEmail('inbox_1', fetch, { interval: 1000, timeout: 10000 });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result.id).toBe('42');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('applies the filter predicate', async () => {
    const fetch = vi.fn().mockResolvedValue([email('1'), email('2')]);
    const result = await pollForEmail('inbox_1', fetch, {
      filter: (e) => e.id === '2',
    });
    expect(result.id).toBe('2');
  });

  it('throws TimeoutError when no match arrives before the deadline', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue([]);
    const promise = pollForEmail('inbox_1', fetch, { interval: 1000, timeout: 3000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(4000);
    const err = await promise;
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).inboxId).toBe('inbox_1');
    expect((err as TimeoutError).timeoutMs).toBe(3000);
  });
});
