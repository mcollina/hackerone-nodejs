// Client
export { HackerOneClient } from './client.ts';

// Types
export type {
  HackerOneConfig,
  PaginationOptions,
  ReportFilterOptions,
  PaginatedResponse,
  Program,
  Report,
  Activity,
  Attachment,
  StructuredScope,
  ReportStateValue,
} from './types.ts';

export { ReportState } from './types.ts';

// Errors
export {
  authenticationError,
  notFoundError,
  rateLimitError,
  apiError,
  isAppError,
  type AppError,
} from './errors.ts';

// Programs API
export { listPrograms, getProgram, listStructuredScopes } from './programs.ts';

// Reports API
export { listReports, getReport, listAllReports } from './reports.ts';

// Activities API
export {
  listActivities,
  filterComments,
  listAllActivities,
  type ActivityFilterOptions,
} from './activities.ts';

// Attachments
export {
  downloadAttachment,
  downloadReportWithAttachments,
  collectAllAttachments,
  type DownloadOptions,
} from './attachments.ts';
