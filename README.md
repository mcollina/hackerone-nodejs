# hackerone

A TypeScript client library and CLI for the [HackerOne API](https://api.hackerone.com/). Use it to list programs, inspect reports, fetch report activity, and download reports with attachments.

## Features

- ESM TypeScript library for HackerOne API v1
- CLI for programs, reports, and downloads
- Basic-auth API token support via environment variables
- Pagination helpers for reports and activities
- Report export to JSON and Markdown
- Attachment downloads using expiring HackerOne attachment URLs, with safe file names and an optional size limit

## Requirements

- Node.js `>=22.6.0`
- A HackerOne API identifier and token

## Installation

```sh
npm install @matteo.collina/hackerone
```

For CLI usage, install globally or run via your package manager:

```sh
npm install -g @matteo.collina/hackerone
hackerone --help
```

From a checkout of this repository:

```sh
npm install
npm run build
```

During development you can run the TypeScript sources directly with Node.js type stripping:

```sh
node --env-file=.env src/cli/index.ts programs list
```

## Authentication

The CLI reads credentials from environment variables:

```sh
export HACKERONE_API_IDENTIFIER="your_api_identifier"
export HACKERONE_API_TOKEN="your_api_token"
# Optional: override the API base URL (useful for local development/testing)
export HACKERONE_BASE_URL="https://api.hackerone.com/v1"
```

For local development, copy the example environment file and fill in your credentials:

```sh
cp .env.example .env
```

> Do not commit `.env` files. HackerOne reports and downloaded attachments may contain sensitive vulnerability information.

## CLI usage

```sh
hackerone <command> [options]
```

### Commands

| Command | Description |
| --- | --- |
| `programs list` | List your accessible programs |
| `programs show <id>` | Show program details |
| `reports list --program <handle>` | List reports for a program |
| `reports show <id>` | Show report details |
| `reports comment <id>` | Post a comment on a report |
| `reports state <id> <state>` | Change a report's state; the message is visible to the reporter |
| `download <id>` | Download one report and its attachments |
| `download --program <handle>` | Download all reports from a program |

### Common options

| Option | Description |
| --- | --- |
| `--json` | Print raw JSON output |
| `--page <n>` | Page number, default `1` |
| `--limit <n>` | Results per page, default `25`, max `100` |
| `--program <handle>` | Filter by program handle |
| `--state <state>` | Filter by state; can be repeated |
| `--severity <level>` | Filter by severity; can be repeated |
| `--output-dir <path>` | Download directory, default `./reports` |
| `--message <text>` | Message for `reports comment` (required) and `reports state` |
| `--message-file <path>` | Read the message from a file, or `-` for stdin |
| `--internal` | Post an internal (team-only) comment |
| `--attachment-id <id>` | Attach a file to a comment or state change (can be repeated) |
| `--original-report-id <id>` | Original report when changing the state to `duplicate` |

### Report states

| State | Status | Message required | Definition |
| --- | --- | --- | --- |
| `new` | Open | No | The report is pending validation. Moving a closed report here reopens it for a fresh review. |
| `pending-program-review` | Open | No | HackerOne triage has initially validated the report, and it awaits review and severity validation by the program team. Only applies to programs that use HackerOne's triage services. |
| `triaged` | Open | No | The report is validated and escalated for remediation. The vulnerability is treated as live and reproducible until it is fixed. |
| `needs-more-info` | Open | Yes | The reporter must provide more information to reproduce the issue or demonstrate impact. HackerOne closes the report as informative, with no reputation change, after 30 days without a reply. |
| `retesting` | Open | No | A fix is deployed and the reporter is verifying it. The report returns to triaged if the fix fails, or moves to resolved once confirmed. HackerOne sets this state through its retest flow, not through a state change. |
| `resolved` | Closed | No | The vulnerability is fixed and no longer reproducible; no further action is needed. The reporter gains 7 reputation and is credited in the program's hall of fame. |
| `not-applicable` | Closed | No | The report has no valid, reproducible issue and no demonstrated security impact; explain why so the reporter can improve. The reporter loses 5 reputation and their signal drops. |
| `informative` | Closed | Yes | The report contains valid information that needs no action, such as an out-of-scope finding, a known issue, or an accepted risk. The reporter's reputation does not change. |
| `duplicate` | Closed | Yes | The issue was already reported or is otherwise known, or one fix resolves several reports. The reporter's reputation change depends on how the original report is closed. |
| `spam` | Closed | No | The report does not describe a legitimate security vulnerability, or it is incomprehensible, abusive, harassing, or selling a product or service. The reporter loses 10 reputation. |

`reports state` and `changeReportState()` accept every state except `retesting`, which HackerOne sets through its retest flow. The state-change message is visible to the reporter. Closed reports can only move back to `new` or `triaged`; HackerOne rejects other transitions. Definitions follow HackerOne's [report states](https://docs.hackerone.com/en/articles/8475030-report-states) and [change state API](https://api.hackerone.com/customer-resources/#reports-change-state) documentation.

### Examples

```sh
# List programs
hackerone programs list

# Show one program and its structured scopes
hackerone programs show 12345 --scopes

# List triaged reports for a program
hackerone reports list --program myprogram --state triaged

# Show a report, including comments from the incremental activity API
hackerone reports show 12345 --with-comments --program myprogram

# Post a public comment on a report
hackerone reports comment 12345 --message "A fix has been deployed. Can you retest?"

# Post an internal (team-only) comment
hackerone reports comment 12345 --message "Internal triage note" --internal

# Post a comment with an attached file
hackerone reports comment 12345 --message "See attached POC" --attachment-id 42

# Post a longer internal note from a file
hackerone reports comment 12345 --internal --message-file notes.md

# Triage a report, with a reply to the reporter read from stdin
hackerone reports state 12345 triaged --message-file - < reply.md

# Close a report as informative
hackerone reports state 12345 informative --message "This is an accepted risk."

# Close a report as a duplicate of another report
hackerone reports state 12345 duplicate --message "Already reported" --original-report-id 11111

# Download one report to ./downloads/12345
hackerone download 12345 --program myprogram --output-dir ./downloads

# Download all triaged reports for a program
hackerone download --program myprogram --state triaged
```

Downloads are written as:

```text
reports/
  <report-id>/
    report.json
    activities.json
    report.md
    attachments/
      <attachment-id>-<file name>
```

Reporters choose attachment file names, so each file is saved as its attachment ID, a dash, and the file name with folder parts and unsafe characters removed. Two attachments with the same name stay separate, and no name can write outside `attachments/`. A failed or expired download raises an error instead of saving the error response as the file.

## Library usage

```ts
import {
  HackerOneClient,
  ReportState,
  listPrograms,
  listReports,
  getReport,
  listAllReports,
} from 'hackerone';

const client = new HackerOneClient({
  apiIdentifier: process.env.HACKERONE_API_IDENTIFIER!,
  apiToken: process.env.HACKERONE_API_TOKEN!,
});

const programs = await listPrograms(client, { pageSize: 25 });
console.log(programs.data.map((program) => program.attributes.handle));

const reports = await listReports(client, {
  program: 'myprogram',
  state: [ReportState.New, ReportState.Triaged],
  pageSize: 100,
});
console.log(reports.data.map((report) => report.attributes.title));

const report = await getReport(client, reports.data[0].id);
console.log(report.attributes.vulnerability_information);

for await (const item of listAllReports(client, { program: 'myprogram' })) {
  console.log(item.id, item.attributes.state, item.attributes.title);
}
```

### Downloading attachments

```ts
import { attachmentFileName, downloadAttachments, listReportAttachments } from 'hackerone';

// Attachments on the report and on its comments and other activities.
// Download links expire, so download soon after fetching them.
const attachments = await listReportAttachments(client, 12345);

const downloaded = await downloadAttachments(attachments, './downloads/12345', {
  maxBytes: 50 * 1024 * 1024, // optional; larger attachments throw ATTACHMENT_TOO_LARGE
});
for (const { attachment, path } of downloaded) {
  console.log(attachment.attributes.content_type, path);
}

attachmentFileName(attachments[0]); // for example "4242-poc.png"
```

Each file is written under a temporary name and renamed once complete, so a failed download leaves no partial file and does not replace an existing one. A download link that does not return HTTP 200, for example once it has expired, throws an `API_ERROR`. `downloadAttachments()` stops at the first failure; files already downloaded are kept.

### Changing a report's state

```ts
import {
  changeReportState,
  changeableReportStates,
  getReportStateInfo,
  ReportState,
  validateStateChange,
} from 'hackerone';

// Every state with its status, definition, and message requirement
for (const state of changeableReportStates) {
  const info = getReportStateInfo(state)!;
  console.log(state, info.status, info.requiresMessage, info.definition);
}

// Throws a VALIDATION_ERROR before any request when the change is invalid
validateStateChange('duplicate', { message: 'Already reported', originalReportId: 11111 });

await changeReportState(client, 12345, ReportState.Duplicate, {
  message: 'Already reported', // visible to the reporter
  originalReportId: 11111,
  attachmentIds: [42],
});
```

`changeReportState()` validates its input with `validateStateChange()` first, so a missing required message, an unknown state, or `retesting` fails without calling HackerOne. It does not know the report's current state, so HackerOne still rejects invalid transitions.

The client defaults to `https://api.hackerone.com/v1`. Pass `baseUrl` to `HackerOneClient` to use another endpoint.

## Exported API

| Export | Description |
| --- | --- |
| `HackerOneClient` | Authenticated API client |
| `listPrograms`, `getProgram`, `listStructuredScopes` | Program APIs |
| `listReports`, `getReport`, `listAllReports` | Report APIs and pagination helper |
| `changeReportState` | Change a report's state, with an optional message to the reporter, original report, and attachments |
| `reportStates`, `changeableReportStates`, `getReportStateInfo` | Every report state with its status, definition, and whether a state change needs a message |
| `isChangeableReportState`, `validateStateChange` | Check a state change before sending it |
| `listActivities`, `listAllActivities`, `filterComments` | Incremental activity APIs |
| `createComment` | Post a public or internal comment on a report |
| `listReportAttachments` | Fetch a report's attachments, including those on comments and other activities |
| `downloadAttachments`, `downloadAttachment`, `downloadReportWithAttachments` | Download helpers, with an optional `maxBytes` limit |
| `attachmentFileName` | The safe file name an attachment is saved under |
| `collectAllAttachments` | Attachments of a report and its activities, each listed once |
| `ReportState` | Report state constants |
| `isAppError`, `validationError`, `attachmentTooLargeError` | Error helpers; local validation failures use the `VALIDATION_ERROR` code, and downloads over `maxBytes` use `ATTACHMENT_TOO_LARGE` |
| `HackerOneConfig`, `Program`, `Report`, `Activity`, `Attachment`, `StructuredScope` | TypeScript types |
| `DownloadOptions`, `DownloadedAttachment`, `ListReportAttachmentsOptions` | Attachment download types |
| `ReportStateValue`, `ChangeableReportState`, `ReportStateInfo`, `ChangeStateOptions` | Report state types |

## Development

```sh
npm test                 # unit tests with node:test
npm run typecheck        # TypeScript check
npm run build            # emit dist/
npm run test:integration # integration tests; requires real API credentials in .env
```

The test suite uses `undici` `MockAgent`. When adding tests, restore the global dispatcher after each test to avoid cross-test failures.

## License

MIT
