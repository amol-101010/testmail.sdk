# @testmail-stream/sdk

TypeScript SDK for [testmail.stream](https://testmail.stream) — programmable
temporary and permanent email inboxes for automated tests and workflows.

## Install

```bash
npm install @testmail-stream/sdk
```

### Upgrading the Package
To upgrade the SDK to the latest version and update/save it in your `package.json`, run the following command:

```bash
npm install @testmail-stream/sdk@latest
```

*(If you are using yarn, pnpm, or bun, run `yarn add @testmail-stream/sdk@latest`, `pnpm add @testmail-stream/sdk@latest`, or `bun add @testmail-stream/sdk@latest` respectively to upgrade and update your `package.json` dependencies).*

Requires **Node ≥ 18** (uses native `fetch`). Works in ESM and CommonJS projects.

## Get an API key

Sign up or request access at [testmail.stream](https://testmail.stream). Your personal API key
(starts with `tm_`) is shown on your profile page — copy it and store it as an environment variable.

Both **Free** and **Pro** accounts receive an API key on sign-up.

## Quick start

```typescript
import { TestmailClient } from '@testmail-stream/sdk';

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

## Common Recipes & Patterns

### 1. Create an Inbox and Wait for an Email
Creating a new temporary inbox and waiting for an email to arrive is the standard flow for integration tests (e.g., signup verification):

```typescript
import { TestmailClient } from '@testmail-stream/sdk';

const client = new TestmailClient({ apiKey: 'tm_your_api_key' });

// 1. Create inbox
const inbox = await client.createInbox({
  alias: 'signup-test-flow', // unique alias
  ttlMinutes: 30,             // auto-deletes in 30 minutes
});

console.log(`Waiting for emails sent to: ${inbox.address}`);

// 2. Wait for a specific verification email
const email = await client.waitForEmail(inbox.id, {
  filter: (e) => e.subject?.includes('Verify') ?? false,
});

console.log('Received verification email subject:', email.subject);
```

---

### 2. Connect to an Existing Inbox and Search/Filter
If you already have an inbox or want to reconnect to a previously created one to search historical emails:

```typescript
// Look up by alias (returns null if not found or expired)
const inbox = await client.findByAlias('signup-test-flow');

if (inbox) {
  // Option A: Retrieve all messages and search client-side
  const emails = await client.getEmails(inbox.id);
  
  // Find a specific email in the array by its subject (resilient to line breaks/case)
  const registrationEmail = client.findEmailBySubject(emails, 'Welcome to our platform!');
  // Or using a regular expression:
  const verifyEmail = client.findEmailBySubject(emails, /Verify your email/i);
  
  // Find a specific email in the array by matching unique text in the subject or body (resilient to line breaks)
  const paymentEmail = client.findEmailByText(emails, 'successful payment invoice #1024');
  
  // Option B: Retrieve using a smart lookup (alias or UUID)
  const resolvedInbox = await client.resolve('signup-test-flow');
  
  // Option C: Get or create idempotently
  const activeInbox = await client.getOrCreateInbox('signup-test-flow', {
    ttlMinutes: 60
  });
}
```

---

### 3. Extracting Email Body, Subject, Links, and Attachments
Once an email is found, you can access its textual content, metadata, verify text presence, or extract/download attachments and links:

```typescript
const email = await client.waitForEmail(inbox.id, {
  filter: (e) => e.subject === 'Invoice #1024'
});

// 1. Accessing metadata and text/HTML body
console.log('From:', email.from);
console.log('Subject:', email.subject);
console.log('Text Body:', email.bodyText);
console.log('HTML Body:', email.bodyHtml);

// 2. Checking if a particular text exists in the email (subject or body)
const codeExists = client.hasText(email, 'verification code');
if (codeExists) {
  console.log('Email contains verification code instructions.');
}

// 3. Extracting a link with particular link text
// (Returns the URL as a string, or an empty string "" if not found)
const paymentUrl = client.extractLinkByText(email, 'Pay Invoice');
if (paymentUrl) {
  console.log('Navigate here to pay:', paymentUrl);
}

// 4. Waiting directly for a link with a particular link text
const resetUrl = await client.waitForLinkByText(inbox.id, 'Reset Password', {
  timeout: 15_000,
});
console.log('Reset your password at:', resetUrl);

// 5. Accessing and downloading attachments
// Option A: Look up and download directly by filename
try {
  const file = await client.downloadAttachmentByFilename(email, 'invoice.pdf');
  console.log(`Downloaded ${file.filename} (${file.data.byteLength} bytes)`);
} catch (err: any) {
  console.error('Download failed:', err.message);
}

// Option B: Node.js helper to save an attachment directly to disk
import { saveAttachment } from '@testmail-stream/sdk/node';

if (email.attachments && email.attachments.length > 0) {
  const attachment = email.attachments[0];
  
  // Saves the attachment to the specified folder (resolving its filename automatically)
  const savedPath = await saveAttachment(client, attachment.id, './downloads');
  console.log(`Attachment saved to: ${savedPath}`);
}
```

---

### 4. Polling & Timeout Customization
By default, `waitForEmail` polls the inbox every **2,000 ms** and throws a `TimeoutError` if no matching email is found within **30,000 ms**. You can customize this behavior using the optional parameters:

```typescript
import { TimeoutError } from '@testmail-stream/sdk';

try {
  const email = await client.waitForEmail(inbox.id, {
    timeout: 60_000,   // Wait for up to 60 seconds (default: 30,000 ms)
    interval: 5_000,   // Poll every 5 seconds (default: 2,000 ms)
    filter: (e) => e.from === 'alerts@security.com'
  });
  console.log('Security alert received:', email.bodyText);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error('Expected alert email did not arrive within 60 seconds.');
  } else {
    throw err;
  }
}
```

---

### 5. Wait for a One-Time Passcode (OTP)
For login / 2FA flows, `waitForOtp` waits for the email and returns just the code:

```typescript
const inbox = await client.createInbox({ alias: 'login-2fa' });
// ... trigger the login that emails a code ...
const code = await client.waitForOtp(inbox.id, { length: 6, timeout: 30_000 });
await page.fill('[name=otp]', code);
```

---

## Client options

```typescript
new TestmailClient({
  apiKey:   'tm_...',                    // required — from your profile page
  baseUrl:  'https://testmail.stream',   // optional (default)
  timeout:  10_000,                      // optional ms per request
  maxRetries: 2,                         // optional, retries on network/429/5xx (default 2; 0 disables)
  retryDelay: 500,                       // optional, backoff base in ms (default 500)
})

### Automatic retries

Transient failures — network errors, HTTP **429**, and **5xx** — are retried automatically with exponential backoff (honoring a `Retry-After` header when present). Request timeouts are **not** retried, since they reflect your configured `timeout`. Tune with `maxRetries` / `retryDelay`, or set `maxRetries: 0` to disable.
```

## Plans

| Feature | Free | Pro |
|---|---|---|
| API key | ✅ | ✅ |
| Temp inboxes (active at once) | 10 | 10 |
| Permanent inboxes | ❌ | 5 |
| Permanent inbox duration | — | 1 year |

## API

### `createInbox(options?)`

Creates a new inbox. Default TTL: **60 minutes**.

```typescript
// Temporary inbox (Free + Pro)
const inbox = await client.createInbox({
  alias:      'my-test',   // optional human-readable name (unique)
  ttlMinutes: 60,          // 5–1440 (24 h)
});

// Permanent inbox — Pro only
const permanent = await client.createInbox({
  alias:     'ci-builds',
  permanent: true,          // never expires; counts against your 5-inbox Pro limit
});
```

Throws **`AliasConflictError`** if the alias is already taken by an active inbox.
The error carries `.existingInboxId` so you can decide whether to reuse it.

Throws **`PlanRestrictionError`** (HTTP 403) when `permanent: true` is used on a Free account.

Throws **`QuotaExceededError`** (HTTP 409) when the active inbox cap is reached
(10 temp for Free/Pro, or 5 permanent for Pro). The error carries `.limit` and `.current`.

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
const inbox = await client.resolve('my-test');        // alias
const inbox2 = await client.resolve('550e8400-...');  // UUID
```

---

### `getInbox(inboxId)`

Returns a single inbox by ID, or `null`.

---

### `listInboxes()`

Returns all active inboxes owned by your API key.

---

### `getEmails(inboxId)`

Returns all emails received by the inbox, newest first.

```typescript
const emails = await client.getEmails(inbox.id);
```

---

### `searchEmails(inboxId, options?)`

Server-side search, filtering, and cursor pagination. Returns one page of emails plus a `nextCursor` (`null` when there are no more pages). Use this instead of `getEmails` for busy inboxes (which returns at most 200) or when you need filtering.

```typescript
// First page of matching emails
const page = await client.searchEmails(inbox.id, {
  query:         'invoice',          // full-text search across subject + body
  from:          'billing@acme.com', // substring match on sender
  subject:       'Receipt',          // substring match on subject
  since:         new Date(Date.now() - 86_400_000), // Date or ISO string
  hasAttachment: true,
  limit:         50,                 // server caps at 200 (default 50)
});

console.log(page.emails.length, page.nextCursor);

// Walk every page
let cursor: string | null = undefined as any;
do {
  const p = await client.searchEmails(inbox.id, { query: 'invoice', cursor });
  for (const email of p.emails) console.log(email.subject);
  cursor = p.nextCursor;
} while (cursor);
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

### `waitForOtp(inboxId, options?)`

Polls until an email arrives, extracts a one-time code from it, and returns the code as a string. Combines `waitForEmail` + `extractOtp`. Accepts all `waitForEmail` options plus extraction options (`length`, `regex`, `keywords`, `alphanumeric`, `preferHtml`).

```typescript
const code = await client.waitForOtp(inbox.id, {
  timeout: 30_000,
  length:  6,                 // expect a 6-digit code
  // alphanumeric: true,      // for codes like AB-C123
  // filter: e => e.from === 'noreply@acme.com',
});
await page.fill('[name=otp]', code);
```

Throws **`TimeoutError`** if no email yielding a code arrives within `timeout` ms.

---

### `waitForLink(inboxId, options?)`

Polls until an email arrives, extracts the most likely verification/action link, and returns the URL. Combines `waitForEmail` + `extractVerificationLink`. Accepts `waitForEmail` options plus `keywords` and `domainAllowlist`.

```typescript
const link = await client.waitForLink(inbox.id, {
  keywords:        ['verify', 'confirm'],
  domainAllowlist: ['acme.com'], // only accept links on these hosts
});
await page.goto(link);
```

---

### `waitForLinkByText(inboxId, linkText, options?)`

Polls until an email contains an anchor (or text line) whose visible text matches `linkText`, then returns that link's URL.

```typescript
const resetUrl = await client.waitForLinkByText(inbox.id, 'Reset Password', { timeout: 15_000 });
```

---

### Standalone extractors

The extraction helpers are also exported as pure functions you can run against any `Email` you already have (e.g. one returned by `getEmails`/`searchEmails`):

```typescript
import {
  extractOtp,
  extractLinks,
  extractVerificationLink,
  extractLinkByText,
  hasText,
  findEmailBySubject,
  findEmailByText,
} from '@testmail-stream/sdk';

const code  = extractOtp(email, { length: 6 });          // string | null
const links = extractLinks(email);                       // string[]
const verify = extractVerificationLink(email, {          // string | null
  domainAllowlist: ['acme.com'],
});
const payUrl = extractLinkByText(email, 'Pay Invoice');  // string ('' if none)
const present = hasText(email, 'verification code');     // boolean

// Find email in an array of emails by subject (case and newline resilient)
const welcome = findEmailBySubject(emails, 'Welcome to testmail'); // Email | null
// Find email in an array containing search text anywhere in subject/body (newline resilient)
const codeMsg = findEmailByText(emails, 'activation code');        // Email | null
```

All of these read the plain-text body when present and otherwise fall back to the HTML body with `<script>`/`<style>` blocks stripped, so markup, styling, and line breaks never pollute matches. All search methods automatically normalize and collapse newlines, carriage returns, and extra whitespace to standard spaces prior to matching.

---

### `deleteInbox(inboxId)`

Immediately deletes the inbox and all its emails.

---

## Playwright example

```typescript
import { test, expect } from '@playwright/test';
import { TestmailClient } from '@testmail-stream/sdk';

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
| `AliasConflictError` | Alias already taken by an active inbox (HTTP 409) |
| `PlanRestrictionError` | Feature requires Pro plan — e.g. `permanent: true` on Free (HTTP 403) |
| `QuotaExceededError` | Active inbox cap reached (HTTP 409); check `.limit` and `.current` |
| `TimeoutError` | `waitForEmail` exceeded its timeout |
| `RequestTimeoutError` | Network/server timeout on a single fetch |
| `ApiError` | Any other non-2xx response |

All errors extend `TestmailError` which extends `Error`.

```typescript
import { PlanRestrictionError, QuotaExceededError } from '@testmail-stream/sdk';

try {
  await client.createInbox({ permanent: true });
} catch (err) {
  if (err instanceof PlanRestrictionError) {
    console.log('Upgrade to Pro for permanent inboxes');
  } else if (err instanceof QuotaExceededError) {
    console.log(`Hit limit: ${err.current}/${err.limit} permanent inboxes`);
  }
}
```

## Build

```bash
cd sdk
npm install
npm run build        # produces dist/esm, dist/cjs, dist/types
npm run build:check  # tsc type-check only, no emit
```

## Public Temporary Inboxes

`testmail.stream` also supports public, anonymous temporary inboxes. Since these do not require authentication or API keys, they are not wrapped in the standard `TestmailClient` SDK. Instead, you can call them directly via HTTP REST endpoints:

* **Create public inbox**: `POST https://api.testmail.stream/public/inbox` -> returns `{ id, address, expires_at }`
* **List public messages**: `GET https://api.testmail.stream/public/inbox/:id/messages` -> returns message list JSON
* **Download public attachment**: `GET https://api.testmail.stream/attachment/:attId`

Creations are strictly limited to **1 per IP address per 24 hours** (quota is not reset by manual deletion), and public inboxes auto-destruct in **1 hour**.
