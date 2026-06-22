# testmail.stream TypeScript SDK — Documentation

> **Scope:** A typed, isomorphic TypeScript client that any developer can
> `npm install` and use to create temporary or permanent inboxes and read
> received emails — with zero knowledge of the underlying Cloudflare / Supabase internals.

---

## 1. Purpose

The SDK is the **primary interface** for end-users of testmail.stream.
It wraps the Worker REST API into a clean, Promise-based class with:

- API key authentication (personal `tm_` key from the user profile page — both Free and Pro)
- Typed request / response objects
- A `waitForEmail()` helper that polls until a matching email arrives
  (essential for Playwright / Cypress / Jest integration tests)
- Plan-aware error types: `PlanRestrictionError` and `QuotaExceededError`
- Full ESM + CommonJS dual build so it works in Node, Bun, Deno, and browsers

### Plan limits enforced by the API (not the SDK)

| | Free | Pro |
|---|---|---|
| Temp inboxes active at once | 10 | 10 |
| Permanent inboxes | 0 | 5 |

The SDK itself has no plan-checking logic — it simply surfaces the errors the
Worker returns when a limit is exceeded.

---

## 2. Folder Structure

```
sdk/
├── src/
│   ├── client.ts          # TestmailClient — the main exported class
│   ├── types.ts           # All public types (Inbox, Email, CreateInboxOptions, …)
│   ├── errors.ts          # Typed error classes (ApiError, TimeoutError, …)
│   ├── poller.ts          # waitForEmail polling logic (extracted for testability)
│   └── index.ts           # Re-exports everything public
├── tests/
│   ├── client.test.ts     # Unit tests (fetch is mocked with msw)
│   └── poller.test.ts     # Polling logic tests with fake timers
├── examples/
│   ├── playwright-basic.ts     # Create inbox, trigger signup, wait for OTP
│   ├── playwright-advanced.ts  # Parallel inboxes, custom TTL
│   └── node-script.ts          # Simple Node.js CLI usage
├── .env.example           # TESTMAIL_API_KEY, TESTMAIL_BASE_URL
├── package.json
├── tsconfig.json
├── tsconfig.build.json    # Stricter settings for the dist build
└── README.md              # Quick-start (separate from this deep-dive doc)
```

---

## 3. Public API

### 3.1 `TestmailClient`

```typescript
import { TestmailClient } from '@testmail-stream/sdk';

const client = new TestmailClient({
  apiKey: 'tm_...',                    // required — from your profile page
  baseUrl: 'https://testmail.stream',  // optional, defaults to production
  timeout: 10_000,                     // optional, ms per individual fetch
});
```

#### Constructor options

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `apiKey` | `string` | ✅ | — | Personal `tm_` key from the testmail.stream profile page. Free and Pro users both have one. |
| `baseUrl` | `string` | ❌ | `https://testmail.stream` | Override for local dev / staging |
| `timeout` | `number` | ❌ | `10000` | Per-request fetch timeout in ms |

---

### 3.2 `createInbox(options?)`

Creates a new inbox (temporary or permanent) and returns its details.

```typescript
// Temporary inbox — Free + Pro, lives for ttlMinutes then auto-expires
const inbox = await client.createInbox({
  alias:      'signup-test',  // optional
  ttlMinutes: 60,             // 5–1440 (24 h), default 60
});

// Permanent inbox — Pro only, never auto-expires
const permanent = await client.createInbox({
  alias:     'ci-builds',
  permanent: true,
});

// inbox: Inbox
// {
//   id:        "550e8400-e29b-41d4-a716-446655440000",
//   address:   "abc123@testmail.stream",
//   alias:     "signup-test",
//   permanent: false,
//   createdAt: Date,
//   expiresAt: Date,   // year 2099 for permanent inboxes
// }
```

**Worker route:** `POST /inbox`

| Option | Type | Default | Description |
|---|---|---|---|
| `alias` | `string` | auto-generated | Human-readable unique name (1–64 chars, lowercase/digits/hyphens) |
| `ttlMinutes` | `number` | `60` | Inbox lifetime in minutes (5–1440). Ignored when `permanent: true`. |
| `permanent` | `boolean` | `false` | Never auto-expire. **Pro plan only.** Throws `PlanRestrictionError` on Free accounts. |

**Errors thrown:**

| Error | Condition |
|---|---|
| `AliasConflictError` | Alias already taken by an active inbox |
| `PlanRestrictionError` | `permanent: true` on a Free account (HTTP 403) |
| `QuotaExceededError` | 10+ active temp inboxes, or 5+ permanent inboxes on Pro (HTTP 409) |

---

### 3.3 `listInboxes()`

Returns all active inboxes created by this API key.

```typescript
const inboxes = await client.listInboxes();
// inboxes: Inbox[]
```

**Worker route:** `GET /inboxes`

---

### 3.4 `getInbox(inboxId)`

Fetch the current state of a single inbox (useful to re-check `expiresAt`).

```typescript
const inbox = await client.getInbox('550e8400-...');
// inbox: Inbox
```

**Worker route:** `GET /inboxes/:id`

---

### 3.5 `getEmails(inboxId, options?)`

Returns all emails received by the inbox so far.

```typescript
const emails = await client.getEmails(inbox.id);

// emails: Email[]
// [
//   {
//     id:          "uuid",
//     inboxId:     "uuid",
//     from:        "no-reply@github.com",
//     subject:     "Verify your email address",
//     receivedAt:  Date,
//     bodyText:    "Click here: https://...",
//     bodyHtml:    "<html>...</html>" | null,
//     rawSize:     4096
//   }
// ]
```

**Worker route:** `GET /inboxes/:id/messages`

| Option | Type | Default | Description |
|---|---|---|---|
| `page` | `number` | `1` | Page number |
| `perPage` | `number` | `20` | Items per page (max 100) |

---

### 3.6 `waitForEmail(inboxId, options?)`

The **killer feature** for test automation. Polls `getEmails()` on an interval
until at least one email matches the predicate, or the timeout elapses.

```typescript
const email = await client.waitForEmail(inbox.id, {
  timeout:  30_000,                           // ms to wait total (default: 30 s)
  interval: 2_000,                            // ms between polls (default: 2 s)
  filter: (email) =>
    email.subject.includes('Verify') &&
    email.from === 'no-reply@github.com',
});

// Returns the first matching Email
// Throws TimeoutError if nothing matches within `timeout`
```

| Option | Type | Default | Description |
|---|---|---|---|
| `timeout` | `number` | `30000` | Max ms to wait before throwing `TimeoutError` |
| `interval` | `number` | `2000` | Polling cadence in ms |
| `filter` | `(email: Email) => boolean` | `() => true` | Predicate to find the right email |

---

### 3.7 `deleteInbox(inboxId)`

Immediately deletes the inbox and all its emails.
Useful in `afterEach` teardown to keep the system clean.

```typescript
await client.deleteInbox(inbox.id);
```

**Worker route:** `DELETE /inboxes/:id`

---

## 4. Types

```typescript
// sdk/src/types.ts

export interface Inbox {
  id:         string;
  address:    string;
  prefix:     string;
  alias:      string | null;
  ttlMinutes: number;      // 0 for permanent inboxes
  permanent:  boolean;     // true = never expires (Pro only)
  createdAt:  Date;
  expiresAt:  Date;        // year 2099 for permanent inboxes
}

export interface Email {
  id:         string;
  inboxId:    string;
  from:       string | null;
  subject:    string | null;
  receivedAt: Date;
  bodyText:   string | null;
  bodyHtml:   string | null;
  rawSize:    number | null;
}

export interface CreateInboxOptions {
  alias?:      string;
  ttlMinutes?: number;
  permanent?:  boolean;  // Pro only; throws PlanRestrictionError on Free
}

export interface WaitForEmailOptions {
  timeout?:  number;
  interval?: number;
  filter?:   (email: Email) => boolean;
}

export interface ClientOptions {
  apiKey:   string;   // personal tm_ key from dashboard; required for Free + Pro
  baseUrl?: string;   // default: "https://testmail.stream"
  timeout?: number;
}
```

---

## 5. Error Handling

```typescript
// sdk/src/errors.ts (hierarchy)

TestmailError
├── ApiError(statusCode, body, message)
│   ├── AuthError             — HTTP 401: wrong/missing API key
│   ├── AliasConflictError    — HTTP 409: alias taken; carries .existingInboxId
│   ├── PlanRestrictionError  — HTTP 403: feature requires Pro plan
│   └── QuotaExceededError    — HTTP 409: plan cap hit; carries .limit + .current
└── TimeoutError              — waitForEmail timed out
└── RequestTimeoutError       — network/server fetch timed out
```

Usage:
```typescript
import {
  ApiError, TimeoutError, PlanRestrictionError, QuotaExceededError
} from '@testmail-stream/sdk';

// Handling permanent inbox creation errors
try {
  await client.createInbox({ permanent: true });
} catch (err) {
  if (err instanceof PlanRestrictionError) {
    // Free account — redirect to upgrade page
  } else if (err instanceof QuotaExceededError) {
    console.log(`${err.current}/${err.limit} permanent inboxes used`);
  }
}

// Handling waitForEmail errors
try {
  const email = await client.waitForEmail(inbox.id, { timeout: 10_000 });
} catch (err) {
  if (err instanceof TimeoutError) {
    console.log('Email never arrived — is the signup form actually sending?');
  } else if (err instanceof ApiError) {
    console.log(`HTTP ${err.statusCode}: ${err.message}`);
  } else {
    throw err;
  }
}
```

---

## 6. Internal Design

### 6.1 `fetch` wrapper

All HTTP calls go through a single private `request<T>()` method on
`TestmailClient`. It:

1. Attaches `Authorization: Bearer <apiKey>` header
2. Attaches `Content-Type: application/json` on POST/PUT
3. Wraps the native `fetch` with an `AbortController` timeout
4. On non-2xx: parses the response body and throws an `ApiError`
   (or `AuthError` on 401)
5. Returns `T` (the parsed JSON body)

### 6.2 `waitForEmail` implementation

```
start = Date.now()
loop:
  emails = await getEmails(inboxId)
  match  = emails.find(filter)
  if match → return match
  if Date.now() - start >= timeout → throw TimeoutError
  await sleep(interval)
```

`sleep` is a simple `setTimeout`-wrapped Promise. The loop is `async/await`
(not `setInterval`) so there is never a concurrent overlapping poll.

### 6.3 Date handling

All `Date` fields on `Inbox` and `Email` are proper JS `Date` objects in the
SDK's public types, even though the Worker sends ISO strings over the wire.
The `request<T>()` method passes responses through a `deserialize()` function
that converts known timestamp field names.

---

## 7. Build & Packaging

### tsconfig strategy

Two tsconfigs:
- `tsconfig.json` — used during development and tests (`module: NodeNext`)
- `tsconfig.build.json` — extends the base, targets `ES2020`, emits declarations

### Dual ESM + CJS output

`package.json` exports map:
```json
{
  "name": "@testmail-stream/sdk",
  "version": "0.1.0",
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js",
      "types":   "./dist/types/index.d.ts"
    }
  },
  "main":  "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/types/index.d.ts"
}
```

Build command (using `tsc` twice):
```bash
# ESM
tsc -p tsconfig.build.json --module esnext --outDir dist/esm
# CJS
tsc -p tsconfig.build.json --module commonjs --outDir dist/cjs
```

Or use `tsup` (zero-config bundler, recommended):
```bash
npx tsup src/index.ts --format esm,cjs --dts --clean
```

---

## 8. Usage Examples

### 8.1 Playwright — basic OTP test

```typescript
// tests/signup.spec.ts
import { test, expect } from '@playwright/test';
import { TestmailClient } from '@testmail-stream/sdk';

const mail = new TestmailClient({ apiKey: process.env.TESTMAIL_API_KEY! });

test('user can verify email after signup', async ({ page }) => {
  const inbox = await mail.createInbox({ label: 'signup-test', ttlSeconds: 300 });

  await page.goto('https://myapp.com/signup');
  await page.fill('[name=email]', inbox.address);
  await page.fill('[name=password]', 'Test1234!');
  await page.click('[type=submit]');

  const email = await mail.waitForEmail(inbox.id, {
    timeout: 20_000,
    filter: (e) => e.subject.toLowerCase().includes('verify'),
  });

  // Extract OTP from email body
  const otp = email.bodyText!.match(/\b\d{6}\b/)![0];

  await page.fill('[name=otp]', otp);
  await page.click('[data-testid=verify-btn]');
  await expect(page).toHaveURL('/dashboard');

  await mail.deleteInbox(inbox.id);   // cleanup
});
```

### 8.2 Playwright — parallel tests with separate inboxes

```typescript
import { test } from '@playwright/test';
import { TestmailClient } from '@testmail-stream/sdk';

const mail = new TestmailClient({ apiKey: process.env.TESTMAIL_API_KEY! });

test.describe('email flows', () => {
  let inbox: Awaited<ReturnType<typeof mail.createInbox>>;

  test.beforeEach(async () => {
    inbox = await mail.createInbox({ ttlSeconds: 120 });
  });

  test.afterEach(async () => {
    await mail.deleteInbox(inbox.id);
  });

  test('password reset email arrives', async ({ page }) => {
    // use inbox.address ...
    const email = await mail.waitForEmail(inbox.id, {
      filter: (e) => e.subject.includes('Reset'),
    });
    expect(email.bodyText).toContain('reset your password');
  });
});
```

### 8.3 Plain Node.js script

```typescript
import { TestmailClient } from '@testmail-stream/sdk';

const client = new TestmailClient({ apiKey: 'sk-...' });

const inbox = await client.createInbox({ label: 'manual-check' });
console.log('Send an email to:', inbox.address);
console.log('Waiting up to 60 s…');

const email = await client.waitForEmail(inbox.id, { timeout: 60_000 });
console.log('Got:', email.subject, 'from', email.from);
console.log(email.bodyText);
```

---

## 9. Environment Variables (for SDK consumers)

```bash
# .env.example  (for projects using the SDK)
TESTMAIL_API_KEY=sk-xxxxxxxxxxxxxxxx
TESTMAIL_BASE_URL=https://worker.testmail.stream   # omit for production default
```

In Playwright, load via `playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config();
export default defineConfig({ /* ... */ });
```

---

## 10. Publishing to npm

```bash
cd sdk
npm run build          # produces dist/
npm pack --dry-run     # verify what will be included

# First release
npm publish --access public   # if scoped: @testmail-stream/sdk
```

`package.json` should include:
```json
{
  "files": ["dist", "README.md"],
  "keywords": ["email", "testing", "playwright", "temporary-email", "testmail"]
}
```

Versioning strategy: **semver**.
- `0.x.y` while in private beta
- `1.0.0` once the Worker API is considered stable

---

## 11. Worker Changes Required for SDK

Required changes to `src/worker.ts` as part of the multi-tenant rollout:

| Change | Why |
|---|---|
| User API key auth path (`tm_` prefix) | SDK requests are authenticated with personal keys, not the admin key |
| Accept `permanent` in `POST /inbox` body | SDK `createInbox({ permanent: true })` (Pro only) |
| Return `permanent` field in all inbox responses | SDK `Inbox.permanent` must be populated |
| Return HTTP 403 with `{ error: '...' }` for plan restriction | SDK throws `PlanRestrictionError` |
| Return HTTP 409 with `{ error: '...', limit, current }` for quota | SDK throws `QuotaExceededError` with `.limit` + `.current` |
| Scope `GET /inboxes` to caller's `user_id` | Returns only the calling user's inboxes |
| Scope ownership checks on `GET/DELETE /inbox/:id` | Users can only access their own inboxes |

The default `baseUrl` in `ClientOptions` is updated from `https://worker.testmail.stream` to `https://testmail.stream`.

---

## 12. What Is Out of Scope (for now)

- Webhook support (push instead of poll) — add later as `enableWebhook(url)`
- Attachment download as `Buffer` / `Blob`
- Browser-native build (CORS headers on Worker needed first)
- Rate-limit retry logic with exponential back-off (add after seeing real traffic)
- Multiple API keys / key rotation within one client instance

---

## 13. Public Temporary Inboxes (REST-only)

`testmail.stream` also supports public, anonymous temporary inboxes. Since these do not require authentication or API keys, they are not wrapped in the standard `TestmailClient` class. Instead, they are exposed as direct public HTTP endpoints:

### 13.1 `POST /public/inbox`
Provision an anonymous public inbox.
* **Headers**: None required.
* **Rate Limits**: Strictly restricted to **1 creation per IP address per 24 hours**.
* **Lifetime**: Expires and auto-destructs after **1 hour** (60 minutes).
* **Response**:
  ```json
  {
    "id": "uuid",
    "address": "a8x9j2m1@testmail.stream",
    "expires_at": "2026-06-09T11:00:00Z"
  }
  ```

### 13.2 `GET /public/inbox/:id`
Fetch the active public inbox metadata (useful for countdown synchronization). Returns `404` if the inbox is expired or deleted.

### 13.3 `GET /public/inbox/:id/messages`
Retrieve all emails received by the public inbox by UUID. Returns `404` if the inbox is expired or deleted.

### 13.4 `GET /attachment/:attId`
Anonymously download email attachments or load inline media associated with public inboxes. If the attachment belongs to a private inbox, this gateway will fall back to authenticated token checks.
