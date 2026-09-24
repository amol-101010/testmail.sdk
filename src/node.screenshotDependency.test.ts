import { describe, it, expect, vi } from 'vitest';
import { screenshotEmail } from './node.js';
import { ScreenshotDependencyError } from './errors.js';
import type { Email } from './types.js';

// Simulates playwright not being installed: the dynamic import() inside
// screenshotEmail() rejects, just like Node would if the module were missing.
vi.mock('playwright', () => {
  throw new Error("Cannot find package 'playwright'");
});

function makeEmail(): Email {
  return {
    id: 'email_1',
    inboxId: 'inbox_1',
    from: 'sender@example.com',
    subject: 'Hello',
    bodyText: 'Hello',
    bodyHtml: '<p>Hello</p>',
    rawSize: 100,
    receivedAt: new Date(),
    auth: { spf: null, dkim: null, dmarc: null },
    isRead: false,
    readAt: null,
  };
}

describe('screenshotEmail without playwright installed', () => {
  it('throws a clear ScreenshotDependencyError instead of a raw module-not-found error', async () => {
    await expect(screenshotEmail(makeEmail())).rejects.toThrow(ScreenshotDependencyError);
    await expect(screenshotEmail(makeEmail())).rejects.toThrow(/npm i -D playwright/);
  });
});
