import type { HackerOneClient } from './client.ts';
import type {
  Activity,
  PaginatedResponse,
  CreateCommentOptions,
} from './types.ts';

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

/**
 * Post a comment on a report.
 *
 * Public comments notify everyone subscribed to the report. Internal comments
 * are only visible to the program's managers and require no extra permission.
 * See https://api.hackerone.com/customer-resources/#reports-create-comment
 */
export async function createComment(
  client: HackerOneClient,
  reportId: number | string,
  options: CreateCommentOptions
): Promise<Activity> {
  const payload = {
    data: {
      type: 'activity-comment',
      attributes: {
        message: options.message,
        internal: options.internal ?? false,
        ...(options.attachmentIds && options.attachmentIds.length > 0
          ? { attachment_ids: options.attachmentIds }
          : {}),
      },
    },
  };

  const response = await client.request<{ data: Activity }>(
    'POST',
    `/reports/${reportId}/activities`,
    undefined,
    payload
  );
  return response.data;
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
