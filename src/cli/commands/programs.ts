import type { HackerOneClient } from '../../lib/client.ts';
import { listPrograms, getProgram, listStructuredScopes } from '../../lib/programs.ts';
import {
  formatProgram,
  formatProgramDetailed,
  formatTable,
  printJson,
  printError,
} from '../output.ts';

export interface ProgramsListOptions {
  page?: number;
  limit?: number;
  json?: boolean;
}

export async function runProgramsList(
  client: HackerOneClient,
  options: ProgramsListOptions
): Promise<void> {
  try {
    const response = await listPrograms(client, {
      page: options.page,
      pageSize: options.limit,
    });

    if (options.json) {
      printJson(response);
      return;
    }

    if (response.data.length === 0) {
      console.log('No programs found.');
      return;
    }

    const headers = ['ID', 'Handle', 'Created', 'Updated'];
    const rows = response.data.map((p) => [
      p.id,
      p.attributes.handle,
      new Date(p.attributes.created_at).toLocaleDateString(),
      new Date(p.attributes.updated_at).toLocaleDateString(),
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

export interface ProgramsShowOptions {
  json?: boolean;
  scopes?: boolean;
}

export async function runProgramsShow(
  client: HackerOneClient,
  programId: string,
  options: ProgramsShowOptions
): Promise<void> {
  try {
    const program = await getProgram(client, programId);

    if (options.json) {
      const data: { program: typeof program; scopes?: unknown } = { program };

      if (options.scopes) {
        const scopesResponse = await listStructuredScopes(client, programId);
        data.scopes = scopesResponse.data;
      }

      printJson(data);
      return;
    }

    console.log(formatProgramDetailed(program));

    if (options.scopes) {
      const scopesResponse = await listStructuredScopes(client, programId);

      if (scopesResponse.data.length > 0) {
        console.log('\n--- Scopes ---');
        const headers = ['Asset', 'Type', 'Bounty', 'Max Severity'];
        const rows = scopesResponse.data.map((s) => [
          s.attributes.asset_identifier,
          s.attributes.asset_type,
          s.attributes.eligible_for_bounty ? 'Yes' : 'No',
          s.attributes.max_severity,
        ]);
        console.log(formatTable(headers, rows));
      }
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
