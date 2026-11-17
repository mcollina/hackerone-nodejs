import { validationError } from './errors.ts';
import {
  ReportState,
  type ChangeableReportState,
  type ChangeStateOptions,
  type ReportStateInfo,
} from './types.ts';

/**
 * Every report state, in lifecycle order, with its definition.
 *
 * Definitions follow https://docs.hackerone.com/en/articles/8475030-report-states
 * and the message rules follow
 * https://api.hackerone.com/customer-resources/#reports-change-state.
 */
const definitions: ReportStateInfo[] = [
  {
    state: ReportState.New,
    status: 'open',
    definition:
      'The report is pending validation. Moving a closed report here reopens it for a fresh review.',
    changeable: true,
    requiresMessage: false,
  },
  {
    state: ReportState.PendingProgramReview,
    status: 'open',
    definition:
      "HackerOne triage has initially validated the report, and it awaits review and severity validation by the program team. Only applies to programs that use HackerOne's triage services.",
    changeable: true,
    requiresMessage: false,
  },
  {
    state: ReportState.Triaged,
    status: 'open',
    definition:
      'The report is validated and escalated for remediation. The vulnerability is treated as live and reproducible until it is fixed.',
    changeable: true,
    requiresMessage: false,
  },
  {
    state: ReportState.NeedsMoreInfo,
    status: 'open',
    definition:
      'The reporter must provide more information to reproduce the issue or demonstrate impact. HackerOne closes the report as informative, with no reputation change, after 30 days without a reply.',
    changeable: true,
    requiresMessage: true,
  },
  {
    state: ReportState.Retesting,
    status: 'open',
    definition:
      'A fix is deployed and the reporter is verifying it. The report returns to triaged if the fix fails, or moves to resolved once confirmed. HackerOne sets this state through its retest flow, not through a state change.',
    changeable: false,
    requiresMessage: false,
  },
  {
    state: ReportState.Resolved,
    status: 'closed',
    definition:
      "The vulnerability is fixed and no longer reproducible; no further action is needed. The reporter gains 7 reputation and is credited in the program's hall of fame.",
    changeable: true,
    requiresMessage: false,
  },
  {
    state: ReportState.NotApplicable,
    status: 'closed',
    definition:
      'The report has no valid, reproducible issue and no demonstrated security impact; explain why so the reporter can improve. The reporter loses 5 reputation and their signal drops.',
    changeable: true,
    requiresMessage: false,
  },
  {
    state: ReportState.Informative,
    status: 'closed',
    definition:
      "The report contains valid information that needs no action, such as an out-of-scope finding, a known issue, or an accepted risk. The reporter's reputation does not change.",
    changeable: true,
    requiresMessage: true,
  },
  {
    state: ReportState.Duplicate,
    status: 'closed',
    definition:
      "The issue was already reported or is otherwise known, or one fix resolves several reports. The reporter's reputation change depends on how the original report is closed.",
    changeable: true,
    requiresMessage: true,
  },
  {
    state: ReportState.Spam,
    status: 'closed',
    definition:
      'The report does not describe a legitimate security vulnerability, or it is incomprehensible, abusive, harassing, or selling a product or service. The reporter loses 10 reputation.',
    changeable: true,
    requiresMessage: false,
  },
];

export const reportStates: readonly Readonly<ReportStateInfo>[] = Object.freeze(
  definitions.map((info) => Object.freeze(info))
);

/** The states changeReportState() accepts, in lifecycle order. */
export const changeableReportStates: readonly ChangeableReportState[] =
  Object.freeze(
    reportStates
      .filter((info) => info.changeable)
      .map((info) => info.state as ChangeableReportState)
  );

/** Returns the definition of a report state, or undefined for an unknown state. */
export function getReportStateInfo(
  state: string
): Readonly<ReportStateInfo> | undefined {
  return reportStates.find((info) => info.state === state);
}

/** Whether a value is a state changeReportState() accepts. */
export function isChangeableReportState(
  value: unknown
): value is ChangeableReportState {
  return (
    typeof value === 'string' &&
    (changeableReportStates as readonly string[]).includes(value)
  );
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Checks a state change before it is sent, and throws a VALIDATION_ERROR
 * AppError when HackerOne would reject it: an unknown or unchangeable state,
 * a missing required message, or an original report on a non-duplicate.
 * It does not check the transition from the report's current state.
 */
export function validateStateChange(
  state: string,
  options?: ChangeStateOptions
): asserts state is ChangeableReportState {
  const info = getReportStateInfo(state);
  const valid = changeableReportStates.join(', ');

  if (!info) {
    throw validationError(
      `Unknown report state "${state}". Valid states: ${valid}`
    );
  }

  if (!info.changeable) {
    throw validationError(
      `Reports cannot be moved to ${state} with a state change. Valid states: ${valid}`
    );
  }

  if (info.requiresMessage && !options?.message?.trim()) {
    throw validationError(
      `A message is required to move a report to ${state}. It is visible to the reporter.`
    );
  }

  if (options?.originalReportId !== undefined) {
    if (state !== ReportState.Duplicate) {
      throw validationError(
        'originalReportId can only be set when moving a report to duplicate'
      );
    }
    if (!isPositiveInteger(options.originalReportId)) {
      throw validationError('originalReportId must be a positive integer');
    }
  }

  if (options?.attachmentIds && !options.attachmentIds.every(isPositiveInteger)) {
    throw validationError('attachmentIds must be positive integers');
  }
}

