/**
 * Example: Plain Node.js script — ad-hoc inbox management
 *
 * Run with:
 *   npx tsx examples/node-script.ts
 * or:
 *   npx ts-node examples/node-script.ts
 */

import { TestmailClient, AliasConflictError, TimeoutError } from '@testmail-stream/sdk';

const client = new TestmailClient({
  apiKey:  process.env.TESTMAIL_API_KEY ?? 'your-api-key-here',
  timeout: 10_000,
});

async function main() {
  // ── Demo 1: Create or reuse an inbox by alias ──────────────────────────────
  console.log('\n─── Demo 1: Create inbox with alias ───');

  let inbox = await client.findByAlias('demo-inbox');

  if (inbox) {
    console.log('Reusing existing inbox:', inbox.address);
    console.log('Expires at:', inbox.expiresAt.toISOString());
  } else {
    try {
      inbox = await client.createInbox({
        alias:      'demo-inbox',
        ttlMinutes: 60,            // 1 hour (the default)
      });
      console.log('Created inbox:', inbox.address);
      console.log('Alias:       ', inbox.alias);
      console.log('Expires at:  ', inbox.expiresAt.toISOString());
    } catch (err) {
      if (err instanceof AliasConflictError) {
        // Rare race condition — another process created the alias between
        // our findByAlias() check and createInbox() call.
        console.log('Alias conflict! Existing inbox id:', err.existingInboxId);
        inbox = (await client.getInbox(err.existingInboxId))!;
      } else {
        throw err;
      }
    }
  }

  // ── Demo 2: Check alias existence ─────────────────────────────────────────
  console.log('\n─── Demo 2: Alias existence check ───');
  const taken = await client.aliasExists('demo-inbox');
  console.log(`Alias "demo-inbox" exists: ${taken}`);

  const free = await client.aliasExists('definitely-not-taken-xyz999');
  console.log(`Alias "definitely-not-taken-xyz999" exists: ${free}`);

  // ── Demo 3: Resolve by alias or ID (smart lookup) ─────────────────────────
  console.log('\n─── Demo 3: Resolve alias or ID ───');
  const resolved = await client.resolve('demo-inbox');
  console.log('Resolved:', resolved?.address ?? 'not found');

  // ── Demo 4: List all inboxes ──────────────────────────────────────────────
  console.log('\n─── Demo 4: List inboxes ───');
  const inboxes = await client.listInboxes();
  console.log(`Active inboxes: ${inboxes.length}`);
  for (const i of inboxes) {
    const minutesLeft = Math.round((i.expiresAt.getTime() - Date.now()) / 60_000);
    console.log(`  ${i.address}  alias=${i.alias ?? '(none)'}  TTL=${minutesLeft}min`);
  }

  // ── Demo 5: waitForEmail with timeout ─────────────────────────────────────
  console.log('\n─── Demo 5: Wait for email (10 s timeout) ───');
  console.log(`Send an email to ${inbox.address} now…`);
  try {
    const email = await client.waitForEmail(inbox.id, {
      timeout:  10_000,
      interval: 2_000,
    });
    console.log('Got email!');
    console.log('From:   ', email.from);
    console.log('Subject:', email.subject);
    console.log('Body:   ', email.bodyText?.slice(0, 200));
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.log('No email arrived within 10 s — that is expected in this demo.');
    } else {
      throw err;
    }
  }

  // ── Demo 6: Create inbox with a 24-hour TTL ────────────────────────────────
  console.log('\n─── Demo 6: Long-lived inbox (24 h) ───');
  const longInbox = await client.createInbox({
    alias:      `long-lived-${Date.now()}`,   // unique alias each run
    ttlMinutes: 1440,                          // 24 hours (maximum)
  });
  console.log('Created long-lived inbox:', longInbox.address);
  console.log('Expires at:', longInbox.expiresAt.toISOString());

  // Clean up the long-lived one immediately in this demo
  await client.deleteInbox(longInbox.id);
  console.log('Deleted long-lived inbox.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
