# hackerone

A TypeScript client library and CLI for the [HackerOne API](https://api.hackerone.com/). Use it to list programs, inspect reports, fetch report activity, and download reports with attachments.

## Features

- ESM TypeScript library for HackerOne API v1
- CLI for programs, reports, and downloads
- Basic-auth API token support via environment variables
- Pagination helpers for reports and activities
- Report export to JSON and Markdown
- Attachment downloads using expiring HackerOne attachment URLs

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

Valid report states are `new`, `triaged`, `needs-more-info`, `resolved`, `not-applicable`, `informative`, `duplicate`, and `spam`.

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
      <files>
```

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

The client defaults to `https://api.hackerone.com/v1`. Pass `baseUrl` to `HackerOneClient` to use another endpoint.

## Exported API

| Export | Description |
| --- | --- |
| `HackerOneClient` | Authenticated API client |
| `listPrograms`, `getProgram`, `listStructuredScopes` | Program APIs |
| `listReports`, `getReport`, `listAllReports` | Report APIs and pagination helper |
| `listActivities`, `listAllActivities`, `filterComments` | Incremental activity APIs |
| `downloadAttachment`, `downloadReportWithAttachments`, `collectAllAttachments` | Download helpers |
| `ReportState` | Report state constants |
| `HackerOneConfig`, `Program`, `Report`, `Activity`, `Attachment`, `StructuredScope` | TypeScript types |

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
