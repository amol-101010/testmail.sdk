import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { saveAttachment, screenshotEmail } from './node.js';
import { TestmailClient } from './client.js';
import { TestmailError } from './errors.js';
import type { Email } from './types.js';

// Mock fs/promises
vi.mock('fs/promises', () => {
  return {
    stat: vi.fn(),
    writeFile: vi.fn(),
  };
});

const { mockScreenshot, mockClose, mockNewPage, mockSetContent, mockCloseContext, mockNewContext, mockLaunch } =
  vi.hoisted(() => {
    const mockScreenshot = vi.fn().mockResolvedValue(Buffer.from('PNG-BYTES'));
    const mockSetContent = vi.fn().mockResolvedValue(undefined);
    const mockNewPage = vi.fn().mockResolvedValue({ setContent: mockSetContent, screenshot: mockScreenshot });
    const mockCloseContext = vi.fn().mockResolvedValue(undefined);
    const mockNewContext = vi
      .fn()
      .mockResolvedValue({ newPage: mockNewPage, close: mockCloseContext });
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockLaunch = vi.fn().mockResolvedValue({ newContext: mockNewContext, close: mockClose });
    return { mockScreenshot, mockClose, mockNewPage, mockSetContent, mockCloseContext, mockNewContext, mockLaunch };
  });

vi.mock('playwright', () => ({
  chromium: { launch: mockLaunch },
}));

function makeEmail(overrides: Partial<Email> = {}): Email {
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
    ...overrides,
  };
}

describe('saveAttachment Node helper', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      downloadAttachment: vi.fn().mockResolvedValue({
        data: new TextEncoder().encode('PDF-BYTES-DATA').buffer,
        contentType: 'application/pdf',
        filename: 'invoice.pdf',
      }),
    };
  });

  it('saves file to the exact path if destPath is a file path', async () => {
    const err = new Error();
    (err as any).code = 'ENOENT';
    vi.mocked(fs.stat).mockRejectedValueOnce(err);
    vi.mocked(fs.writeFile).mockResolvedValueOnce();

    const finalPath = await saveAttachment(mockClient, 'att123', 'downloads/my-invoice.pdf');

    expect(mockClient.downloadAttachment).toHaveBeenCalledWith('att123');
    expect(fs.stat).toHaveBeenCalledWith('downloads/my-invoice.pdf');
    expect(fs.writeFile).toHaveBeenCalledWith(
      'downloads/my-invoice.pdf',
      expect.any(Buffer)
    );
    expect(finalPath).toBe('downloads/my-invoice.pdf');
  });

  it('appends filename if destPath is an existing directory', async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({
      isDirectory: () => true,
    } as any);
    vi.mocked(fs.writeFile).mockResolvedValueOnce();

    const finalPath = await saveAttachment(mockClient, 'att123', 'downloads');

    expect(fs.stat).toHaveBeenCalledWith('downloads');
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join('downloads', 'invoice.pdf'),
      expect.any(Buffer)
    );
    expect(finalPath).toBe(path.join('downloads', 'invoice.pdf'));
  });

  it('appends attachmentId if filename is null/undefined and destPath is a directory', async () => {
    mockClient.downloadAttachment.mockResolvedValueOnce({
      data: new TextEncoder().encode('RAW-BYTES').buffer,
      contentType: 'application/octet-stream',
      filename: null,
    });
    vi.mocked(fs.stat).mockResolvedValueOnce({
      isDirectory: () => true,
    } as any);
    vi.mocked(fs.writeFile).mockResolvedValueOnce();

    const finalPath = await saveAttachment(mockClient, 'att123', 'downloads');

    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join('downloads', 'att123'),
      expect.any(Buffer)
    );
    expect(finalPath).toBe(path.join('downloads', 'att123'));
  });

  it('propagates other filesystem errors', async () => {
    const err = new Error('Permission denied');
    (err as any).code = 'EACCES';
    vi.mocked(fs.stat).mockRejectedValueOnce(err);

    await expect(saveAttachment(mockClient, 'att123', 'downloads/file.pdf')).rejects.toThrow(
      'Permission denied'
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe('screenshotEmail Node helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScreenshot.mockResolvedValue(Buffer.from('PNG-BYTES'));
    mockSetContent.mockResolvedValue(undefined);
    mockNewPage.mockResolvedValue({ setContent: mockSetContent, screenshot: mockScreenshot });
    mockCloseContext.mockResolvedValue(undefined);
    mockNewContext.mockResolvedValue({ newPage: mockNewPage, close: mockCloseContext });
    mockClose.mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ newContext: mockNewContext, close: mockClose });
  });

  it('rejects when the email has no HTML body', async () => {
    const email = makeEmail({ bodyHtml: null });
    await expect(screenshotEmail(email)).rejects.toThrow(TestmailError);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('renders the HTML with a desktop viewport and JS disabled by default', async () => {
    const email = makeEmail();
    const buffer = await screenshotEmail(email);

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockNewContext).toHaveBeenCalledWith({
      viewport: { width: 800, height: 1200 },
      javaScriptEnabled: false,
    });
    expect(mockSetContent).toHaveBeenCalledWith('<p>Hello</p>', { waitUntil: 'networkidle' });
    expect(mockScreenshot).toHaveBeenCalledWith({ fullPage: true });
    expect(buffer).toEqual(Buffer.from('PNG-BYTES'));
  });

  it('applies the mobile viewport preset', async () => {
    await screenshotEmail(makeEmail(), { viewport: 'mobile' });
    expect(mockNewContext).toHaveBeenCalledWith({
      viewport: { width: 375, height: 812 },
      javaScriptEnabled: false,
    });
  });

  it('applies custom viewport dimensions and fullPage: false', async () => {
    await screenshotEmail(makeEmail(), { viewport: { width: 500, height: 900 }, fullPage: false });
    expect(mockNewContext).toHaveBeenCalledWith({
      viewport: { width: 500, height: 900 },
      javaScriptEnabled: false,
    });
    expect(mockScreenshot).toHaveBeenCalledWith({ fullPage: false });
  });

  it('closes the context and browser even if rendering fails', async () => {
    mockSetContent.mockRejectedValueOnce(new Error('render failed'));

    await expect(screenshotEmail(makeEmail())).rejects.toThrow('render failed');

    expect(mockCloseContext).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
