/**
 * Webhook consumer example — no SDK required.
 *
 * Run:
 *   npm install express
 *   node webhook-consumer-example.mjs
 *
 * Then expose locally with: npx localtunnel --port 3000
 * Or: ngrok http 3000
 *
 * Register the public URL as a webhook:
 *   curl -X POST https://<worker-url>/webhooks \
 *     -H "Authorization: Bearer tm_<your-api-key>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"inbox_id": "<uuid>", "url": "https://<your-tunnel>/webhook"}'
 *
 * The response includes a "secret" field — copy it into WEBHOOK_SECRET below.
 */

import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Config ─────────────────────────────────────────────────────────────────
const PORT           = 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'paste-secret-from-registration-response';
const TESTMAIL_API   = process.env.TESTMAIL_API_URL ?? 'https://testmail-stream.testmailstream.workers.dev';
const API_KEY        = process.env.TESTMAIL_API_KEY ?? 'tm_your_api_key';

// ── Signature verification ─────────────────────────────────────────────────

/**
 * Verify X-Testmail-Signature against the raw body.
 * Uses constant-time comparison to prevent timing attacks.
 */
function verifySignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false; // header length mismatch
  }
}

// ── Fetch full email from API ───────────────────────────────────────────────

async function fetchEmail(messageId, inboxId) {
  const res = await fetch(`${TESTMAIL_API}/inbox/${inboxId}/messages`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const emails = await res.json();
  return emails.find(e => e.id === messageId) ?? null;
}

// ── Express server ─────────────────────────────────────────────────────────

const app = express();

// Capture raw body BEFORE JSON parsing — required for HMAC verification
app.use('/webhook', express.raw({ type: 'application/json' }));

app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-testmail-signature'];
  const rawBody   = req.body; // Buffer (raw bytes)

  // 1. Verify signature
  if (!verifySignature(WEBHOOK_SECRET, rawBody, signature)) {
    console.warn('Rejected webhook: bad signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 2. Parse payload
  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { event, timestamp, data } = payload;

  // 3. Respond immediately — don't block on processing
  res.sendStatus(200);

  // 4. Handle event asynchronously
  if (event === 'email.received') {
    console.log(`\n📬 New email received at ${data.inbox_address}`);
    console.log(`   Message ID : ${data.message_id}`);
    console.log(`   From       : ${data.from}`);
    console.log(`   Subject    : ${data.subject}`);
    console.log(`   Attachments: ${data.has_attachments}`);
    console.log(`   Received at: ${data.received_at}`);

    // Optionally fetch the full message body
    try {
      const email = await fetchEmail(data.message_id, data.inbox_id);
      if (email) {
        console.log(`   Body (text): ${email.body_text?.slice(0, 200) ?? '(empty)'}`);
      }
    } catch (err) {
      console.error('   Failed to fetch full email:', err.message);
    }
  }

  if (event === 'webhook.test') {
    console.log(`\n✅ Webhook test ping received at ${new Date(timestamp).toISOString()}`);
    console.log(`   Message: ${data.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Webhook receiver listening on http://localhost:${PORT}/webhook`);
  console.log(`Expose with:  npx localtunnel --port ${PORT}`);
  console.log(`          or: ngrok http ${PORT}`);
});
