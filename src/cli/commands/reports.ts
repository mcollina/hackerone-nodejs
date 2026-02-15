import type { HackerOneClient } from '../../lib/client.ts';
import { listReports, getReport } from '../../lib/reports.ts';
import { listActivities, filterComments } from '../../lib/activities.ts';
import type { ReportStateValue } from '../../lib/types.ts';
import {
  formatReport,
  formatReportDetailed,
  formatActivity,
  formatTable,
  printJson,
  printError,
} from '../output.ts';

export interface ReportsListOptions {
  program?: string | string[];
  state?: ReportStateValue | ReportStateValue[];
  severity?: string[];
  page?: number;
  limit?: number;
  json?: boolean;
}

export async function runReportsList(
  client: HackerOneClient,
  options: ReportsListOptions
): Promise<void> {
  if (!options.program) {
    printError('--program <handle> is required to list reports');
    process.exit(1);
  }

  try {
    const response = await listReports(client, {
      program: options.program,
      state: options.state,
      severity: options.severity,
      page: options.page,
      pageSize: options.limit,
    });

    if (options.json) {
      printJson(response);
      return;
    }

    if (response.data.length === 0) {
      console.log('No reports found.');
      return;
    }

    const headers = ['ID', 'State', 'Severity', 'Date', 'Title'];
    const rows = response.data.map((r) => [
      r.id,
      r.attributes.state,
      r.attributes.severity_rating ?? 'none',
      new Date(r.attributes.created_at).toLocaleDateString(),
      r.attributes.title.length > 60
        ? r.attributes.title.slice(0, 57) + '...'
        : r.attributes.title,
    ]);

    console.log(formatTable(headers, rows));

    if (response.links.next) {
      console.log(`\nPage ${options.page ?? 1} - more results available`);
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export interface ReportsShowOptions {
  withComments?: boolean;
  program?: string;
  json?: boolean;
}

export async function runReportsShow(
  client: HackerOneClient,
  reportId: string,
  options: ReportsShowOptions
): Promise<void> {
  try {
    const report = await getReport(client, reportId);

    let comments: ReturnType<typeof filterComments> = [];

    if (options.withComments && options.program) {
      const activitiesResponse = await listActivities(client, options.program, {
        reportId,
      });
      comments = filterComments(activitiesResponse.data);
    }

    if (options.json) {
      const data: { report: typeof report; comments?: typeof comments } = {
        report,
      };
      if (options.withComments) {
        data.comments = comments;
      }
      printJson(data);
      return;
    }

    console.log(formatReportDetailed(report));

    if (options.withComments) {
      if (!options.program) {
        console.log(
          '\nNote: --program required to fetch comments. Use --program <handle>'
        );
      } else if (comments.length > 0) {
        console.log('\n--- Comments ---');
        for (const comment of comments) {
          console.log(formatActivity(comment));
          console.log('');
        }
      } else {
        console.log('\nNo comments found.');
      }
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
