import * as fs from 'fs/promises';
import * as path from 'path';
import { TestmailClient } from './client.js';

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
