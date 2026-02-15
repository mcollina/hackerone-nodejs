// Report states as const object (not enum)
export const ReportState = {
  New: 'new',
  Triaged: 'triaged',
  NeedsMoreInfo: 'needs-more-info',
  Resolved: 'resolved',
  NotApplicable: 'not-applicable',
  Informative: 'informative',
  Duplicate: 'duplicate',
  Spam: 'spam',
} as const;

export type ReportStateValue = (typeof ReportState)[keyof typeof ReportState];

// Configuration
export interface HackerOneConfig {
  apiIdentifier: string;
  apiToken: string;
  baseUrl?: string;
}

// Pagination
export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

export interface ReportFilterOptions extends PaginationOptions {
  state?: ReportStateValue | ReportStateValue[];
  program?: string | string[];
  severity?: string[];
}

export interface PaginatedResponse<T> {
  data: T[];
  links: {
    self: string;
    next?: string;
    prev?: string;
    last?: string;
  };
}

// Program
export interface Program {
  id: string;
  type: 'program';
  attributes: {
    handle: string;
    policy?: string;
    created_at: string;
    updated_at: string;
  };
}

// Attachment
export interface Attachment {
  id: string;
  type: 'attachment';
  attributes: {
    file_name: string;
    content_type: string;
    file_size: number;
    expiring_url: string;
    created_at: string;
  };
}

// Activity
export interface Activity {
  id: string;
  type: string; // 'activity-comment', 'activity-state-change', etc.
  attributes: {
    message: string | null;
    created_at: string;
    updated_at: string;
    internal: boolean;
  };
  relationships?: {
    actor?: { data: { id: string; type: string } };
    attachments?: { data: Attachment[] };
  };
}

// Report
export interface Report {
  id: string;
  type: 'report';
  attributes: {
    title: string;
    state: ReportStateValue;
    created_at: string;
    submitted_at: string;
    vulnerability_information: string;
    triaged_at: string | null;
    closed_at: string | null;
    last_activity_at: string | null;
    first_program_activity_at: string | null;
    severity_rating: string | null;
  };
  relationships: {
    program: { data: { id: string; type: string } };
    reporter?: { data: { id: string; type: string } };
    activities?: { data: Activity[] };
    attachments?: { data: Attachment[] };
  };
}

// Structured Scope
export interface StructuredScope {
  id: string;
  type: 'structured-scope';
  attributes: {
    asset_identifier: string;
    asset_type: string;
    eligible_for_bounty: boolean;
    eligible_for_submission: boolean;
    instruction: string | null;
    max_severity: string;
    created_at: string;
    updated_at: string;
  };
}
