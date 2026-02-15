import { join } from 'node:path';
import type { HackerOneClient } from '../../lib/client.ts';
import { getReport, listAllReports } from '../../lib/reports.ts';
import { listActivities } from '../../lib/activities.ts';
import { downloadReportWithAttachments } from '../../lib/attachments.ts';
import type { ReportStateValue } from '../../lib/types.ts';
import { printError } from '../output.ts';

export interface DownloadOptions {
  outputDir?: string;
  program?: string;
  state?: ReportStateValue | ReportStateValue[];
}

export async function runDownloadReport(
  client: HackerOneClient,
  reportId: string,
  options: DownloadOptions
): Promise<void> {
  try {
    const outputDir = options.outputDir ?? './reports';

    console.log(`Fetching report ${reportId}...`);
    const report = await getReport(client, reportId);

    // Fetch activities if program is provided
    let activities: Awaited<ReturnType<typeof listActivities>>['data'] = [];
    if (options.program) {
      console.log('Fetching activities...');
      const activitiesResponse = await listActivities(client, options.program, {
        reportId,
      });
      activities = activitiesResponse.data;
    }

    const destDir = join(outputDir, reportId);
    console.log(`Downloading to ${destDir}...`);

    const result = await downloadReportWithAttachments(
      report,
      activities,
      destDir
    );

    console.log(`Report saved: ${result.reportPath}`);
    if (result.attachmentPaths.length > 0) {
      console.log(`Attachments downloaded: ${result.attachmentPaths.length}`);
      for (const path of result.attachmentPaths) {
        console.log(`  - ${path}`);
      }
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function runDownloadBulk(
  client: HackerOneClient,
  options: DownloadOptions & { program: string }
): Promise<void> {
  try {
    const outputDir = options.outputDir ?? './reports';

    console.log(`Fetching reports from ${options.program}...`);
    if (options.state) {
      const states = Array.isArray(options.state)
        ? options.state.join(', ')
        : options.state;
      console.log(`Filtering by state: ${states}`);
    }

    let count = 0;
    for await (const report of listAllReports(client, {
      program: options.program,
      state: options.state,
    })) {
      count++;
      console.log(`\n[${count}] Downloading report ${report.id}: ${report.attributes.title}`);

      // Fetch activities for this report
      const activitiesResponse = await listActivities(client, options.program, {
        reportId: report.id,
      });

      const destDir = join(outputDir, report.id);
      const result = await downloadReportWithAttachments(
        report,
        activitiesResponse.data,
        destDir
      );

      console.log(`  Saved: ${result.reportPath}`);
      if (result.attachmentPaths.length > 0) {
        console.log(`  Attachments: ${result.attachmentPaths.length}`);
      }
    }

    console.log(`\nDownloaded ${count} report(s) to ${outputDir}`);
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
