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

  // Save report markdown
  const markdownPath = join(destDir, 'report.md');
  await writeFile(markdownPath, generateReportMarkdown(report, activities));

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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toISOString().split('T')[0];
}

export function generateReportMarkdown(
  report: Report,
  activities: Activity[]
): string {
  const { attributes, relationships } = report;
  const reporter = relationships?.reporter?.data?.attributes?.username ?? 'Unknown';
  const program = relationships?.program?.data?.attributes?.handle ?? 'Unknown';
  const attachments = collectAllAttachments(report, activities);

  let md = `# ${attributes.title}

| Field | Value |
|-------|-------|
| **Report ID** | ${report.id} |
| **State** | ${attributes.state} |
| **Reporter** | ${reporter} |
| **Program** | ${program} |
| **Submitted** | ${formatDate(attributes.created_at)} |
| **Severity** | ${attributes.severity_rating ?? 'Not rated'} |

## Description

${attributes.vulnerability_information}
`;

  if (attachments.length > 0) {
    md += `\n## Attachments\n\n`;
    for (const att of attachments) {
      md += `- [${att.attributes.file_name}](attachments/${att.attributes.file_name})\n`;
    }
  }

  if (activities.length > 0) {
    md += `\n## Activity\n\n`;
    for (const activity of activities) {
      const date = formatDate(activity.attributes.created_at);
      const actor = activity.relationships?.actor?.data?.attributes?.username ?? 'system';
      const internal = activity.attributes.internal ? ' [internal]' : '';

      md += `### ${date} - ${actor}${internal}\n\n`;
      if (activity.attributes.message) {
        md += `${activity.attributes.message}\n\n`;
      } else {
        md += `*${activity.type}*\n\n`;
      }
    }
  }

  return md;
}
