import { request, type Dispatcher } from 'undici';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { HackerOneClient } from './client.ts';
import { getReport } from './reports.ts';
import { listAllActivities } from './activities.ts';
import { apiError, attachmentTooLargeError, validationError } from './errors.ts';
import type { Attachment, Report, Activity } from './types.ts';

export interface DownloadOptions {
  dispatcher?: Dispatcher;
  /** Refuse attachments larger than this many bytes. There is no limit by default. */
  maxBytes?: number;
}

export interface DownloadedAttachment {
  attachment: Attachment;
  /** Where the file was saved. */
  path: string;
}

export interface ListReportAttachmentsOptions {
  /** Program handle used to fetch the report's activities. Defaults to the handle on the report. */
  programHandle?: string;
}

const MAX_FILE_NAME_BYTES = 200;
const MAX_ID_BYTES = 50;
// Characters Windows forbids in file names, control characters, and
// bidirectional controls that can disguise a file's real extension.
const UNSAFE_FILE_NAME_CHARACTERS =
  /[<>:"|?*\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function truncateBytes(value: string, maxBytes: number): string {
  let result = '';
  let bytes = 0;
  for (const char of value) {
    bytes += Buffer.byteLength(char);
    if (bytes > maxBytes) break;
    result += char;
  }
  return result;
}

/**
 * The file name downloadAttachments() saves an attachment under: the
 * attachment ID, a dash, then the reporter's file name with folder parts and
 * unsafe characters removed. Reporters choose file names, so never use
 * `file_name` as a path.
 */
export function attachmentFileName(attachment: Attachment): string {
  const id =
    truncateBytes(String(attachment.id).replace(/[^A-Za-z0-9_-]/g, '_'), MAX_ID_BYTES) ||
    'attachment';
  const lastSegment = String(attachment.attributes?.file_name ?? '').split(/[\\/]/).pop() ?? '';
  const name = truncateBytes(
    lastSegment.normalize('NFC').replace(UNSAFE_FILE_NAME_CHARACTERS, '_'),
    MAX_FILE_NAME_BYTES - Buffer.byteLength(id) - 1
  )
    // Windows drops trailing dots and spaces, and "." or ".." are not names.
    .replace(/[. ]+$/, '');
  return `${id}-${name || 'attachment'}`;
}

/**
 * Download one attachment to destPath.
 *
 * The file is written under a temporary name and renamed when complete, so a
 * failed download never leaves a partial file at destPath or replaces an
 * existing one. Throws an API_ERROR when the download link does not return
 * HTTP 200, for example once it has expired, and an ATTACHMENT_TOO_LARGE
 * error when the attachment exceeds options.maxBytes.
 */
export async function downloadAttachment(
  attachment: Attachment,
  destPath: string,
  options?: DownloadOptions
): Promise<void> {
  const maxBytes = options?.maxBytes;
  if (maxBytes !== undefined && !(Number.isSafeInteger(maxBytes) && maxBytes > 0)) {
    throw validationError('maxBytes must be a positive integer');
  }

  const label = `attachment ${attachmentFileName(attachment)}`;
  const tooLarge = () =>
    attachmentTooLargeError(`Could not download ${label}: it is larger than ${maxBytes} bytes`);
  if (maxBytes !== undefined && attachment.attributes.file_size > maxBytes) {
    throw tooLarge();
  }

  const dir = dirname(destPath);
  await mkdir(dir, { recursive: true });

  const { statusCode, headers, body } = await request(attachment.attributes.expiring_url, {
    dispatcher: options?.dispatcher,
  });
  if (statusCode !== 200) {
    await body.dump();
    const hint =
      statusCode === 403
        ? '. Download links expire, so fetch the report again for a new link.'
        : '';
    throw apiError(`Could not download ${label}: HTTP ${statusCode}${hint}`, statusCode);
  }
  if (maxBytes !== undefined && Number(headers['content-length']) > maxBytes) {
    await body.dump();
    throw tooLarge();
  }

  const tempPath = join(dir, `.${randomUUID()}.part`);
  const file = createWriteStream(tempPath, { flags: 'wx' });
  try {
    let received = 0;
    await pipeline(
      body,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          received += chunk.length;
          if (maxBytes !== undefined && received > maxBytes) throw tooLarge();
          yield chunk;
        }
      },
      file
    );
    await rename(tempPath, destPath);
  } catch (err) {
    // A stream destroyed while still opening creates the file afterwards,
    // so wait for it to close before removing the partial file.
    if (!file.closed) await once(file, 'close').catch(() => {});
    await rm(tempPath, { force: true });
    throw err;
  }
}

/**
 * Download attachments into destDir, each named by attachmentFileName().
 * Stops at the first failure and throws; files already downloaded are kept.
 */
export async function downloadAttachments(
  attachments: Attachment[],
  destDir: string,
  options?: DownloadOptions
): Promise<DownloadedAttachment[]> {
  const downloaded: DownloadedAttachment[] = [];
  for (const attachment of attachments) {
    const path = join(destDir, attachmentFileName(attachment));
    await downloadAttachment(attachment, path, options);
    downloaded.push({ attachment, path });
  }
  return downloaded;
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

  const downloaded = await downloadAttachments(
    collectAllAttachments(report, activities),
    join(destDir, 'attachments'),
    options
  );

  return { reportPath, attachmentPaths: downloaded.map((item) => item.path) };
}

/** Attachments of the report and of the given activities, each listed once. */
export function collectAllAttachments(
  report: Report,
  activities: Activity[]
): Attachment[] {
  const all = [
    ...(report.relationships?.attachments?.data ?? []),
    ...activities.flatMap((a) => a.relationships?.attachments?.data ?? []),
  ];
  const seen = new Set<string>();
  return all.filter((attachment) => {
    if (seen.has(attachment.id)) return false;
    seen.add(attachment.id);
    return true;
  });
}

/**
 * Fetch a report's attachments, including those added in comments and other
 * activities. Their download links expire, so download them soon after.
 */
export async function listReportAttachments(
  client: HackerOneClient,
  reportId: number | string,
  options?: ListReportAttachmentsOptions
): Promise<Attachment[]> {
  const report = await getReport(client, reportId);
  const activities = [...(report.relationships.activities?.data ?? [])];
  const programHandle =
    options?.programHandle ?? report.relationships.program?.data?.attributes?.handle;
  if (programHandle) {
    for await (const activity of listAllActivities(client, programHandle, { reportId })) {
      activities.push(activity);
    }
  }
  return collectAllAttachments(report, activities);
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
      const name = attachmentFileName(att);
      md += `- [${name.replace(/[\\[\]]/g, '\\$&')}](attachments/${encodeURIComponent(name)})\n`;
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
