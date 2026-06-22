/**
 * Example: Playwright — parallel tests each with their own isolated inbox
 *
 * Playwright runs tests in parallel by default. Each test gets a fresh inbox
 * in beforeEach and deletes it in afterEach. The alias includes the test title
 * slug so failures are easy to correlate with inbox contents in the dashboard.
 */

import { test, expect } from '@playwright/test';
import { TestmailClient, Inbox } from '@testmail-stream/sdk';

const mail = new TestmailClient({ apiKey: process.env.TESTMAIL_API_KEY! });

/** Turn a test title into a valid alias slug */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

test.describe('Password flows', () => {
  let inbox: Inbox;

  test.beforeEach(async ({}, testInfo) => {
    const alias = `pw-${slugify(testInfo.title)}`;

    // Reuse if alias is still live (avoids quota burn on re-runs)
    inbox = (await mail.findByAlias(alias)) ?? await mail.createInbox({
      alias,
      ttlMinutes: 15,
    });
  });

  test.afterEach(async () => {
    // Best-effort cleanup — don't fail the test if delete errors
    await mail.deleteInbox(inbox.id).catch(() => {});
  });

  test('password reset email arrives', async ({ page }) => {
    await page.goto('https://myapp.example.com/forgot-password');
    await page.fill('[name=email]', inbox.address);
    await page.click('[type=submit]');

    const email = await mail.waitForEmail(inbox.id, {
      timeout: 20_000,
      filter:  (e) => e.subject?.toLowerCase().includes('reset') ?? false,
    });

    expect(email.bodyText).toContain('reset your password');

    const resetLink = email.bodyText?.match(/https:\/\/\S+/)?.[0];
    expect(resetLink).toBeTruthy();

    await page.goto(resetLink!);
    await expect(page).toHaveURL(/\/reset-password/);
  });

  test('welcome email is sent after signup', async ({ page }) => {
    await page.goto('https://myapp.example.com/signup');
    await page.fill('[name=email]',    inbox.address);
    await page.fill('[name=password]', 'Welcome1!');
    await page.click('[type=submit]');

    const email = await mail.waitForEmail(inbox.id, {
      timeout: 20_000,
      filter:  (e) => e.subject?.toLowerCase().includes('welcome') ?? false,
    });

    expect(email.from).toContain('hello@myapp.example.com');
    expect(email.bodyText).toContain('Welcome');
  });
});
