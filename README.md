# @testmail/sdk

TypeScript SDK for [testmail.stream](https://testmail.stream) — programmable
temporary email inboxes for automated tests and workflows.

## Install

```bash
npm install @testmail/sdk
```

Requires **Node ≥ 18** (uses native `fetch`). Works in ESM and CommonJS projects.

## Quick start

```typescript
import { TestmailClient } from '@testmail/sdk';

const client = new TestmailClient({
  apiKey: process.env.TESTMAIL_API_KEY!,
});

// Create a named inbox (lives for 1 hour by default)
const inbox = await client.createInbox({ alias: 'signup-test' });
console.log(inbox.address); // "abc123@testmail.stream"

// Trigger something that sends an email to inbox.address ...

// Wait up to 30 s for a verification email
const email = await client.waitForEmail(inbox.id, {
  filter: e => e.subject?.includes('Verify') ?? false,
});
console.log(email.bodyText);

// Clean up
await client.deleteInbox(inbox.id);
```

## Client options

```typescript
new TestmailClient({
  apiKey:   'sk-...',                             // required
  baseUrl:  'https://worker.testmail.stream',     // optional (default)
  timeout:  10_000,                               // optional ms per request
})
```

## API

### `createInbox(options?)`

Creates a new inbox. Default TTL: **60 minutes**.

```typescript
const inbox = await client.createInbox({
  alias:      'my-test',   // optional human-readable name (unique)
  ttlMinutes: 60,          // 5–1440 (24 h)
});
```

Throws **`AliasConflictError`** if the alias is already taken by an active inbox.
The error carries `.existingInboxId` so you can decide whether to reuse it.

---

### `findByAlias(alias)`

Returns the active inbox with that alias, or `null` if not found / expired.

```typescript
const inbox = await client.findByAlias('my-test');
// Inbox | null
```

---

### `aliasExists(alias)`

Convenience boolean check.

```typescript
if (await client.aliasExists('my-test')) { ... }
```

---

### `resolve(aliasOrId)`

Smart lookup — pass either a UUID or an alias; the method detects which one.

```typescript
const inbox = await client.resolve('my-test');       // alias
const inbox2 = await client.resolve('550e8400-...');  // id
```

---

### `getInbox(inboxId)`

Returns a single inbox by ID, or `null`.

---

### `listInboxes()`

Returns all active inboxes visible to this API key.

---

### `getEmails(inboxId)`

Returns all emails received by the inbox, newest first.

```typescript
const emails = await client.getEmails(inbox.id);
```

---

### `waitForEmail(inboxId, options?)`

Polls until a matching email arrives or the timeout elapses.

```typescript
const email = await client.waitForEmail(inbox.id, {
  timeout:  30_000,            // ms (default)
  interval: 2_000,             // polling cadence ms (default)
  filter:   e => e.subject?.includes('Reset') ?? false,
});
```

Throws **`TimeoutError`** if no match is found within `timeout` ms.

---

### `deleteInbox(inboxId)`

Immediately deletes the inbox and all its emails.

---

## Playwright example

```typescript
import { test, expect } from '@playwright/test';
import { TestmailClient } from '@testmail/sdk';

const mail = new TestmailClient({ apiKey: process.env.TESTMAIL_API_KEY! });

test('email verification', async ({ page }) => {
  const inbox = await mail.createInbox({ alias: 'e2e-verify', ttlMinutes: 15 });

  await page.goto('/signup');
  await page.fill('[name=email]', inbox.address);
  await page.fill('[name=password]', 'Test1234!');
  await page.click('[type=submit]');

  const email = await mail.waitForEmail(inbox.id, {
    filter: e => e.subject?.includes('Verify') ?? false,
  });

  const otp = email.bodyText!.match(/\b\d{6}\b/)![0];
  await page.fill('[name=otp]', otp);
  await page.click('[data-testid=verify-btn]');
  await expect(page).toHaveURL(/\/dashboard/);

  await mail.deleteInbox(inbox.id);
});
```

## Error types

| Class | When thrown |
|---|---|
| `AuthError` | Wrong or missing API key (HTTP 401) |
| `AliasConflictError` | Alias already taken (HTTP 409) |
| `TimeoutError` | `waitForEmail` exceeded its timeout |
| `RequestTimeoutError` | Network/server timeout on a single fetch |
| `ApiError` | Any other non-2xx response |

All errors extend `TestmailError` which extends `Error`.

## Build

```bash
cd sdk
npm install
npm run build        # produces dist/esm, dist/cjs, dist/types
npm run build:check  # tsc type-check only, no emit
```
