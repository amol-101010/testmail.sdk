/**
 * Example: Playwright — email verification flow
 *
 * Scenario: User signs up, receives a verification email, enters the OTP,
 * and lands on the dashboard.
 *
 * Run (with ts-node or via Playwright's built-in TS support):
 *   npx playwright test examples/playwright-basic.ts
 */

import { test, expect } from '@playwright/test';
import { TestmailClient, AliasConflictError } from '@testmail/sdk';

// One shared client per test file — the API key comes from the environment.
const mail = new TestmailClient({
  apiKey: process.env.TESTMAIL_API_KEY!,
});

test.describe('Email verification', () => {
  test('user can verify their email after signup', async ({ page }) => {
    // ── 1. Create a fresh inbox with a meaningful alias ───────────────────────
    // If this alias is already taken (e.g. a previous test run didn't clean up),
    // findByAlias() lets us reuse the existing inbox rather than failing.
    let inbox = await mail.findByAlias('pw-signup-verify');

    if (!inbox) {
      inbox = await mail.createInbox({
        alias:      'pw-signup-verify',
        ttlMinutes: 30,                // 30 min is plenty for a CI run
      });
    }

    console.log('Using inbox:', inbox.address, '→ expires', inbox.expiresAt);

    // ── 2. Trigger the email ──────────────────────────────────────────────────
    await page.goto('https://myapp.example.com/signup');
    await page.fill('[name=email]',    inbox.address);
    await page.fill('[name=password]', 'Test1234!');
    await page.click('[type=submit]');

    // ── 3. Wait for the verification email ───────────────────────────────────
    const email = await mail.waitForEmail(inbox.id, {
      timeout:  25_000,
      interval: 2_000,
      filter:   (e) => e.subject?.toLowerCase().includes('verify') ?? false,
    });

    expect(email.from).toContain('no-reply@myapp.example.com');

    // ── 4. Extract the 6-digit OTP from the email body ────────────────────────
    const otp = email.bodyText?.match(/\b\d{6}\b/)?.[0];
    expect(otp, 'OTP should be present in email body').toBeTruthy();

    // ── 5. Submit the OTP and assert we reach the dashboard ───────────────────
    await page.fill('[name=otp]', otp!);
    await page.click('[data-testid=verify-btn]');
    await expect(page).toHaveURL(/\/dashboard/);

    // ── 6. Teardown ───────────────────────────────────────────────────────────
    await mail.deleteInbox(inbox.id);
  });
});
