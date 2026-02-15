import type { HackerOneClient } from './client.ts';
import type { Activity, PaginatedResponse } from './types.ts';

export interface ActivityFilterOptions {
  reportId?: number | string;
  updatedAtAfter?: Date;
  page?: number;
  pageSize?: number;
}

export async function listActivities(
  client: HackerOneClient,
  programHandle: string,
  options?: ActivityFilterOptions
): Promise<PaginatedResponse<Activity>> {
  const params: Record<string, string> = {
    handle: programHandle,
  };

  if (options?.reportId) params['report_id'] = String(options.reportId);
  if (options?.updatedAtAfter)
    params['updated_at_after'] = options.updatedAtAfter.toISOString();
  if (options?.page) params['page[number]'] = String(options.page);
  if (options?.pageSize) params['page[size]'] = String(options.pageSize);

  return client.request<PaginatedResponse<Activity>>(
    'GET',
    '/incremental/activities',
    params
  );
}

export function filterComments(activities: Activity[]): Activity[] {
  return activities.filter(
    (a) => a.type === 'activity-comment' && a.attributes.message !== null
  );
}

export async function* listAllActivities(
  client: HackerOneClient,
  programHandle: string,
  options?: Omit<ActivityFilterOptions, 'page'>
): AsyncGenerator<Activity> {
  let page = 1;
  while (true) {
    const response = await listActivities(client, programHandle, {
      ...options,
      page,
      pageSize: options?.pageSize ?? 100,
    });
    for (const activity of response.data) {
      yield activity;
    }
    if (!response.links.next) break;
    page++;
  }
}
