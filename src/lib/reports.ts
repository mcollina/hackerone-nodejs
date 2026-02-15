import type { HackerOneClient } from './client.ts';
import type { Report, PaginatedResponse, ReportFilterOptions } from './types.ts';

export async function listReports(
  client: HackerOneClient,
  options?: ReportFilterOptions
): Promise<PaginatedResponse<Report>> {
  const params: Record<string, string | string[]> = {};

  if (options?.page) params['page[number]'] = String(options.page);
  if (options?.pageSize) params['page[size]'] = String(options.pageSize);

  // State filter - supports multiple values
  if (options?.state) {
    const states = Array.isArray(options.state) ? options.state : [options.state];
    params['filter[state][]'] = states;
  }

  // Program filter - supports multiple values
  if (options?.program) {
    const programs = Array.isArray(options.program)
      ? options.program
      : [options.program];
    params['filter[program][]'] = programs;
  }

  // Severity filter - supports multiple values
  if (options?.severity) {
    params['filter[severity][]'] = options.severity;
  }

  return client.request<PaginatedResponse<Report>>('GET', '/reports', params);
}

export async function getReport(
  client: HackerOneClient,
  id: number | string
): Promise<Report> {
  const response = await client.request<{ data: Report }>(
    'GET',
    `/reports/${id}`
  );
  return response.data;
}

// Helper to fetch all reports (handles pagination)
export async function* listAllReports(
  client: HackerOneClient,
  options?: Omit<ReportFilterOptions, 'page'>
): AsyncGenerator<Report> {
  let page = 1;
  while (true) {
    const response = await listReports(client, {
      ...options,
      page,
      pageSize: options?.pageSize ?? 100,
    });
    for (const report of response.data) {
      yield report;
    }
    if (!response.links.next) break;
    page++;
  }
}
