import { request, type Dispatcher } from 'undici';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Attachment, Report, Activity } from './types.ts';

export interface DownloadOptions {
  dispatcher?: Dispatcher;
}

export async function downloadAttachment(
  attachment: Attachment,
  destPath: string,
  options?: DownloadOptions
): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });

  const { body } = await request(attachment.attributes.expiring_url, {
    dispatcher: options?.dispatcher,
  });
  const writeStream = createWriteStream(destPath);
  await pipeline(body, writeStream);
}

export async function downloadReportWithAttachments(
  report: Report,
  activities: Activity[],
  destDir: string,
  options?: DownloadOptions
): Promise<{ reportPath: string; attachmentPaths: string[] }> {
  await mkdir(destDir, { recursive: true });

  // Save report JSON
  const reportPath = join(destDir, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  // Save activities JSON if present
  if (activities.length > 0) {
    const activitiesPath = join(destDir, 'activities.json');
    await writeFile(activitiesPath, JSON.stringify(activities, null, 2));
  }

  // Collect all attachments
  const allAttachments = collectAllAttachments(report, activities);
  const attachmentPaths: string[] = [];

  // Download attachments
  if (allAttachments.length > 0) {
    const attachmentsDir = join(destDir, 'attachments');
    for (const attachment of allAttachments) {
      const destPath = join(attachmentsDir, attachment.attributes.file_name);
      await downloadAttachment(attachment, destPath, options);
      attachmentPaths.push(destPath);
    }
  }

  return { reportPath, attachmentPaths };
}

export function collectAllAttachments(
  report: Report,
  activities: Activity[]
): Attachment[] {
  const reportAttachments = report.relationships?.attachments?.data ?? [];
  const activityAttachments = activities.flatMap(
    (a) => a.relationships?.attachments?.data ?? []
  );

  return [...reportAttachments, ...activityAttachments];
}
