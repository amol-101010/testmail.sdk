import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { saveAttachment } from './node.js';
import { TestmailClient } from './client.js';

// Mock fs/promises
vi.mock('fs/promises', () => {
  return {
    stat: vi.fn(),
    writeFile: vi.fn(),
  };
});

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
