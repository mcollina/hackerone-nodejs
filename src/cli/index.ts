import { parseArgs } from 'node:util';
import { HackerOneClient } from '../lib/client.ts';
import { ReportState, type ReportStateValue } from '../lib/types.ts';
import { runProgramsList, runProgramsShow } from './commands/programs.ts';
import { runReportsList, runReportsShow } from './commands/reports.ts';
import { runDownloadReport, runDownloadBulk } from './commands/download.ts';
import { printError } from './output.ts';

const HELP = `
HackerOne CLI

Usage:
  hackerone <command> [options]

Commands:
  programs list             List your programs
  programs show <id>        Show program details
  reports list              List reports
  reports show <id>         Show report details
  download <id>             Download a report with attachments
  download --program <h>    Download all reports from a program

Options:
  --help, -h                Show this help message
  --json                    Output as JSON

Programs Options:
  --page <n>                Page number (default: 1)
  --limit <n>               Results per page (default: 25, max: 100)
  --scopes                  Include structured scopes (with show)

Reports Options:
  --program <handle>        Filter by program handle
  --state <state>           Filter by state (can be repeated)
  --severity <level>        Filter by severity (can be repeated)
  --page <n>                Page number (default: 1)
  --limit <n>               Results per page (default: 25, max: 100)
  --with-comments           Include comments (requires --program)

Download Options:
  --output-dir <path>       Output directory (default: ./reports)
  --program <handle>        Download all reports from program
  --state <state>           Filter by state when bulk downloading

Valid states: new, triaged, needs-more-info, resolved, not-applicable, informative, duplicate, spam

Environment:
  HACKERONE_API_IDENTIFIER  API identifier (required)
  HACKERONE_API_TOKEN       API token (required)

Examples:
  hackerone programs list
  hackerone programs show 12345 --scopes
  hackerone reports list --program myprogram --state triaged
  hackerone reports list --state new --state triaged
  hackerone reports show 12345 --with-comments --program myprogram
  hackerone download 12345 --output-dir ./downloads
  hackerone download --program myprogram --state triaged
`.trim();

function getClient(): HackerOneClient {
  const apiIdentifier = process.env.HACKERONE_API_IDENTIFIER;
  const apiToken = process.env.HACKERONE_API_TOKEN;

  if (!apiIdentifier || !apiToken) {
    printError(
      'HACKERONE_API_IDENTIFIER and HACKERONE_API_TOKEN environment variables are required'
    );
    process.exit(1);
  }

  return new HackerOneClient({ apiIdentifier, apiToken });
}

function parseStates(values: string[]): ReportStateValue[] {
  const validStates = Object.values(ReportState);
  const result: ReportStateValue[] = [];

  for (const value of values) {
    if (!validStates.includes(value as ReportStateValue)) {
      printError(`Invalid state: ${value}. Valid states: ${validStates.join(', ')}`);
      process.exit(1);
    }
    result.push(value as ReportStateValue);
  }

  return result;
}

interface ParsedOptions {
  help: boolean;
  json: boolean;
  page: string | undefined;
  limit: string | undefined;
  program: string[];
  state: string[];
  severity: string[];
  scopes: boolean;
  withComments: boolean;
  outputDir: string | undefined;
}

function parseOptions(args: string[]): { options: ParsedOptions; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      json: { type: 'boolean', default: false },
      page: { type: 'string' },
      limit: { type: 'string' },
      program: { type: 'string', multiple: true, default: [] },
      state: { type: 'string', multiple: true, default: [] },
      severity: { type: 'string', multiple: true, default: [] },
      scopes: { type: 'boolean', default: false },
      'with-comments': { type: 'boolean', default: false },
      'output-dir': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  return {
    options: {
      help: values.help as boolean,
      json: values.json as boolean,
      page: values.page as string | undefined,
      limit: values.limit as string | undefined,
      program: values.program as string[],
      state: values.state as string[],
      severity: values.severity as string[],
      scopes: values.scopes as boolean,
      withComments: values['with-comments'] as boolean,
      outputDir: values['output-dir'] as string | undefined,
    },
    positionals,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }

  const command = args[0];
  const subcommand = args[1];

  const { options, positionals } = parseOptions(
    args.slice(command === 'download' ? 1 : 2)
  );

  if (options.help) {
    console.log(HELP);
    return;
  }

  const client = getClient();

  switch (command) {
    case 'programs':
      if (subcommand === 'list') {
        await runProgramsList(client, {
          page: options.page ? parseInt(options.page, 10) : undefined,
          limit: options.limit ? parseInt(options.limit, 10) : undefined,
          json: options.json,
        });
      } else if (subcommand === 'show') {
        const programId = positionals[0];
        if (!programId) {
          printError('Program ID required');
          process.exit(1);
        }
        await runProgramsShow(client, programId, {
          json: options.json,
          scopes: options.scopes,
        });
      } else {
        printError(`Unknown subcommand: ${subcommand}`);
        console.log(HELP);
        process.exit(1);
      }
      break;

    case 'reports':
      if (subcommand === 'list') {
        const states = options.state.length > 0 ? parseStates(options.state) : undefined;
        await runReportsList(client, {
          program: options.program.length === 1 ? options.program[0] : options.program.length > 0 ? options.program : undefined,
          state: states?.length === 1 ? states[0] : states,
          severity: options.severity.length > 0 ? options.severity : undefined,
          page: options.page ? parseInt(options.page, 10) : undefined,
          limit: options.limit ? parseInt(options.limit, 10) : undefined,
          json: options.json,
        });
      } else if (subcommand === 'show') {
        const reportId = positionals[0];
        if (!reportId) {
          printError('Report ID required');
          process.exit(1);
        }
        await runReportsShow(client, reportId, {
          withComments: options.withComments,
          program: options.program[0],
          json: options.json,
        });
      } else {
        printError(`Unknown subcommand: ${subcommand}`);
        console.log(HELP);
        process.exit(1);
      }
      break;

    case 'download': {
      const reportId = positionals[0];
      const states = options.state.length > 0 ? parseStates(options.state) : undefined;

      if (reportId) {
        // Download single report
        await runDownloadReport(client, reportId, {
          outputDir: options.outputDir,
          program: options.program[0],
          state: states?.length === 1 ? states[0] : states,
        });
      } else if (options.program.length > 0) {
        // Bulk download
        await runDownloadBulk(client, {
          program: options.program[0],
          outputDir: options.outputDir,
          state: states?.length === 1 ? states[0] : states,
        });
      } else {
        printError('Report ID or --program required');
        process.exit(1);
      }
      break;
    }

    default:
      printError(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  printError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
