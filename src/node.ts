import * as fs from 'fs/promises';
import * as path from 'path';
import { TestmailClient } from './client.js';
import type { Email, ScreenshotOptions } from './types.js';
import { TestmailError, ScreenshotDependencyError } from './errors.js';

/**
 * Downloads an attachment and saves it directly to the filesystem.
 * If destPath resolves to a directory, the attachment's filename (or ID) is appended.
 * Returns the final path where the file was written.
 */
export async function saveAttachment(
  client: TestmailClient,
  attachmentId: string,
  destPath: string
): Promise<string> {
  const { data, filename } = await client.downloadAttachment(attachmentId);
  let finalPath = destPath;

  try {
    const stats = await fs.stat(destPath);
    if (stats.isDirectory()) {
      const name = filename || attachmentId;
      finalPath = path.join(destPath, name);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  await fs.writeFile(finalPath, Buffer.from(data));
  return finalPath;
}

const VIEWPORT_PRESETS = {
  desktop: { width: 800, height: 1200 },
  mobile: { width: 375, height: 812 },
} as const;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHeader(email: Email): string {
  const rows: [string, string][] = [
    ['From', email.from ?? '(unknown)'],
    ...(email.replyTo ? ([['Reply-To', email.replyTo]] as [string, string][]) : []),
    ['Subject', email.subject ?? '(no subject)'],
    ['Received', email.receivedAt.toISOString()],
  ];
  const body = rows
    .map(([k, v]) => `<div><b style="display:inline-block;width:72px;color:#555">${k}</b>${escapeHtml(v)}</div>`)
    .join('');
  return `<div style="font:13px/1.6 sans-serif;padding:12px 16px;margin-bottom:12px;background:#f3f4f6;border-bottom:1px solid #d1d5db">${body}</div>`;
}

/**
 * Renders an email's HTML body in a local headless browser and returns a PNG
 * screenshot as a Buffer. Runs entirely on your own machine/CI runner —
 * no data is sent to testmail.stream or any third party for rendering.
 *
 * Requires `playwright` to be installed in your project (it is an optional
 * peer dependency, not bundled with this SDK, so it never adds weight for
 * SDK users who don't call this function):
 *
 *   npm i -D playwright
 *
 * JavaScript is disabled in the rendered page, since email HTML is
 * untrusted content that may embed tracking scripts.
 */
export async function screenshotEmail(email: Email, options: ScreenshotOptions = {}): Promise<Buffer> {
  if (!email.bodyHtml) {
    throw new TestmailError(`Email "${email.id}" has no HTML body to render.`);
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new ScreenshotDependencyError();
  }

  const viewport =
    typeof options.viewport === 'object' ? options.viewport : VIEWPORT_PRESETS[options.viewport ?? 'desktop'];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      const html = options.includeHeader ? renderHeader(email) + email.bodyHtml : email.bodyHtml;
      await page.setContent(html, { waitUntil: 'networkidle' });
      return (await page.screenshot({ fullPage: options.fullPage ?? true })) as Buffer;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
