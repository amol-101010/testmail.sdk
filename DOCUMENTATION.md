# testmail.stream TypeScript SDK — Documentation

> **Scope:** A typed, isomorphic TypeScript client that any developer can
> `npm install` and use to create temporary inboxes and read received emails —
> with zero knowledge of the underlying Cloudflare / Supabase internals.

---

## 1. Purpose

The SDK is the **primary interface** for end-users of testmail.stream.
It wraps the Worker REST API into a clean, Promise-based class with:

- API key authentication
- Typed request / response objects
- A `waitForEmail()` helper that polls until a matching email arrives
  (essential for Playwright / Cypress / Jest integration tests)
- Full ESM + CommonJS dual build so it works in Node, Bun, Deno, and browsers

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
import { TestmailClient } from '@testmail/sdk';

const client = new TestmailClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://worker.testmail.stream',  // optional, defaults to production
  timeout: 10_000,                            // optional, ms per individual fetch
});
```

#### Constructor options

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `apiKey` | `string` | ✅ | — | Bearer token issued from testmail dashboard |
| `baseUrl` | `string` | ❌ | `https://worker.testmail.stream` | Override for local dev / staging |
| `timeout` | `number` | ❌ | `10000` | Per-request fetch timeout in ms |

---

### 3.2 `createInbox(options?)`

Creates a new temporary inbox and returns its details.

```typescript
const inbox = await client.createInbox({
  ttlSeconds: 3600,    // optional; default from server (3600 = 1 hour)
  label: 'signup-test' // optional; human label stored for your reference
});

// inbox: Inbox
// {
//   id:         "550e8400-e29b-41d4-a716-446655440000",
//   address:    "abc123@testmail.stream",
//   createdAt:  Date,
//   expiresAt:  Date,
//   label:      "signup-test"
// }
```

**Worker route:** `POST /inboxes`

| Option | Type | Default | Description |
|---|---|---|---|
| `ttlSeconds` | `number` | `3600` | Inbox lifetime in seconds (max: 86400 / 24 h) |
| `label` | `string` | `undefined` | Arbitrary tag stored alongside the inbox |

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
  id:        string;
  address:   string;
  createdAt: Date;
  expiresAt: Date;
  label?:    string;
  deleted:   boolean;
}

export interface Email {
  id:         string;
  inboxId:    string;
  from:       string;
  subject:    string;
  receivedAt: Date;
  bodyText:   string | null;
  bodyHtml:   string | null;
  rawSize:    number;
}

export interface CreateInboxOptions {
  ttlSeconds?: number;
  label?:      string;
}

export interface GetEmailsOptions {
  page?:    number;
  perPage?: number;
}

export interface WaitForEmailOptions {
  timeout?:  number;
  interval?: number;
  filter?:   (email: Email) => boolean;
}

export interface ClientOptions {
  apiKey:   string;
  baseUrl?: string;
  timeout?: number;
}
```

---

## 5. Error Handling

```typescript
// sdk/src/errors.ts

export class TestmailError extends Error {
  constructor(message: string) { super(message); this.name = 'TestmailError'; }
}

export class ApiError extends TestmailError {
  constructor(
    public statusCode: number,
    public body: unknown,
    message: string
  ) { super(message); this.name = 'ApiError'; }
}

export class TimeoutError extends TestmailError {
  constructor(inboxId: string, timeoutMs: number) {
    super(`No matching email in inbox ${inboxId} within ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export class AuthError extends ApiError {
  // Thrown when the server returns 401
}
```

Usage:
```typescript
import { ApiError, TimeoutError } from '@testmail/sdk';

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
  "name": "@testmail/sdk",
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
import { TestmailClient } from '@testmail/sdk';

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
import { TestmailClient } from '@testmail/sdk';

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
import { TestmailClient } from '@testmail/sdk';

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
npm publish --access public   # if scoped: @testmail/sdk
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

The existing `src/worker.ts` already covers the core SDK routes.
These minor additions improve the SDK experience:

| Change | Why |
|---|---|
| Accept `label` in `POST /inboxes` body | SDK `createInbox({ label })` needs to store it |
| Return `label` in `GET /inboxes` and `GET /inboxes/:id` | SDK `listInboxes()` should surface the label |
| Add `message_count` to inbox responses | Avoids a second fetch just to check if emails arrived |
| `DELETE /inboxes/:id` — already exists ✅ | Nothing to add |

---

## 12. What Is Out of Scope (for now)

- Webhook support (push instead of poll) — add later as `enableWebhook(url)`
- Attachment download as `Buffer` / `Blob`
- Browser-native build (CORS headers on Worker needed first)
- Rate-limit retry logic with exponential back-off (add after seeing real traffic)
- Multiple API keys / key rotation within one client instance
