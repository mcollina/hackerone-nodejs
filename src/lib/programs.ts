import type { HackerOneClient } from './client.ts';
import type {
  Program,
  PaginatedResponse,
  PaginationOptions,
  StructuredScope,
} from './types.ts';

export async function listPrograms(
  client: HackerOneClient,
  options?: PaginationOptions
): Promise<PaginatedResponse<Program>> {
  const params: Record<string, string> = {};
  if (options?.page) params['page[number]'] = String(options.page);
  if (options?.pageSize) params['page[size]'] = String(options.pageSize);

  return client.request<PaginatedResponse<Program>>('GET', '/me/programs', params);
}

export async function getProgram(
  client: HackerOneClient,
  programId: string
): Promise<Program> {
  const response = await client.request<{ data: Program }>(
    'GET',
    `/programs/${programId}`
  );
  return response.data;
}

export async function listStructuredScopes(
  client: HackerOneClient,
  programId: string,
  options?: PaginationOptions
): Promise<PaginatedResponse<StructuredScope>> {
  const params: Record<string, string> = {};
  if (options?.page) params['page[number]'] = String(options.page);
  if (options?.pageSize) params['page[size]'] = String(options.pageSize);

  return client.request<PaginatedResponse<StructuredScope>>(
    'GET',
    `/programs/${programId}/structured_scopes`,
    params
  );
}
