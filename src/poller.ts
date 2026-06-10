import { Email, WaitForEmailOptions } from './types.js';
import { TimeoutError } from './errors.js';

/**
 * Polls `fetchEmails` on a fixed interval until the filter predicate matches
 * an email, or the timeout is exceeded.
 *
 * Extracted from TestmailClient so it can be unit-tested independently
 * with fake timers and a mock fetch function.
 *
 * @param inboxId   - ID of the inbox being polled (used only in TimeoutError)
 * @param fetchEmails - Async function that returns the current list of emails
 * @param options   - Timeout, interval, filter (see WaitForEmailOptions)
 * @returns The first Email that passes the filter
 * @throws {TimeoutError} if no matching email arrives within `timeout` ms
 */
export async function pollForEmail(
  inboxId: string,
  fetchEmails: () => Promise<Email[]>,
  options: WaitForEmailOptions = {}
): Promise<Email> {
  const {
    timeout  = 30_000,
    interval = 2_000,
    filter   = () => true,
  } = options;

  const deadline = Date.now() + timeout;

  while (true) {
    const emails = await fetchEmails();

    const match = emails.find(filter);
    if (match) return match;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new TimeoutError(inboxId, timeout);
    }

    // Sleep for the interval, but don't overshoot the deadline
    await sleep(Math.min(interval, remaining));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
