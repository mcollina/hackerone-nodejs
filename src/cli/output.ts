import type { Program, Report, Activity, Attachment } from '../lib/types.ts';

export function formatProgram(program: Program): string {
  const { handle, created_at, updated_at } = program.attributes;
  return `${program.id}\t${handle}\t${new Date(created_at).toLocaleDateString()}\t${new Date(updated_at).toLocaleDateString()}`;
}

export function formatProgramDetailed(program: Program): string {
  const { handle, created_at, updated_at } = program.attributes;

  return `
ID:         ${program.id}
Handle:     ${handle}
Created:    ${new Date(created_at).toLocaleDateString()}
Updated:    ${new Date(updated_at).toLocaleDateString()}
`.trim();
}

export function formatReport(report: Report): string {
  const { title, state, severity_rating, created_at } = report.attributes;
  const date = new Date(created_at).toLocaleDateString();
  const severity = severity_rating ?? 'none';
  return `${report.id}\t${state}\t${severity}\t${date}\t${title}`;
}

export function formatReportDetailed(report: Report): string {
  const {
    title,
    state,
    created_at,
    triaged_at,
    closed_at,
    severity_rating,
    vulnerability_information,
  } = report.attributes;

  const attachments = report.relationships?.attachments?.data ?? [];

  let output = `
ID:          ${report.id}
Title:       ${title}
State:       ${state}
Severity:    ${severity_rating ?? 'Not rated'}
Created:     ${new Date(created_at).toLocaleDateString()}
Triaged:     ${triaged_at ? new Date(triaged_at).toLocaleDateString() : 'N/A'}
Closed:      ${closed_at ? new Date(closed_at).toLocaleDateString() : 'N/A'}
Attachments: ${attachments.length}

--- Description ---
${vulnerability_information}
`.trim();

  if (attachments.length > 0) {
    output += '\n\n--- Attachments ---\n';
    for (const att of attachments) {
      output += formatAttachment(att) + '\n';
    }
  }

  return output;
}

export function formatActivity(activity: Activity): string {
  const { type, attributes } = activity;
  const date = new Date(attributes.created_at).toLocaleString();
  const actorId = activity.relationships?.actor?.data?.id ?? 'system';
  const internal = attributes.internal ? ' [internal]' : '';

  let message = '';
  if (type === 'activity-comment' && attributes.message) {
    message = `\n    ${attributes.message.replace(/\n/g, '\n    ')}`;
  }

  return `[${date}] ${type} by ${actorId}${internal}${message}`;
}

export function formatAttachment(attachment: Attachment): string {
  const { file_name, content_type, file_size } = attachment.attributes;
  const size = formatFileSize(file_size);
  return `  - ${file_name} (${content_type}, ${size})`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTable(
  headers: string[],
  rows: string[][]
): string {
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, i) =>
    Math.max(...allRows.map((row) => (row[i] ?? '').length))
  );

  const formatRow = (row: string[]) =>
    row.map((cell, i) => (cell ?? '').padEnd(colWidths[i])).join('  ');

  const headerLine = formatRow(headers);
  const separator = colWidths.map((w) => '-'.repeat(w)).join('  ');

  return [headerLine, separator, ...rows.map(formatRow)].join('\n');
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printError(message: string): void {
  console.error(`Error: ${message}`);
}
