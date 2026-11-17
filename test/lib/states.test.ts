import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import {
  reportStates,
  changeableReportStates,
  getReportStateInfo,
  isChangeableReportState,
  validateStateChange,
} from '../../src/lib/states.ts';
import { isAppError } from '../../src/lib/errors.ts';
import { ReportState } from '../../src/lib/types.ts';

function assertValidationError(fn: () => void, pattern: RegExp): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(isAppError(err));
    assert.strictEqual(err.code, 'VALIDATION_ERROR');
    assert.strictEqual(err.statusCode, 400);
    assert.match(err.message, pattern);
    return true;
  });
}

describe('Report states', () => {
  describe('reportStates', () => {
    it('defines every ReportState exactly once, in lifecycle order', () => {
      assert.deepStrictEqual(
        reportStates.map((info) => info.state),
        Object.values(ReportState)
      );
    });

    it('gives every state a status and a definition', () => {
      for (const info of reportStates) {
        assert.ok(['open', 'closed'].includes(info.status), info.state);
        assert.ok(info.definition.length > 20, info.state);
      }
    });

    it('records the closed states and the states that need a message', () => {
      assert.deepStrictEqual(
        reportStates.filter((info) => info.status === 'closed').map((info) => info.state),
        ['resolved', 'not-applicable', 'informative', 'duplicate', 'spam']
      );
      assert.deepStrictEqual(
        reportStates.filter((info) => info.requiresMessage).map((info) => info.state),
        ['needs-more-info', 'informative', 'duplicate']
      );
    });

    it('describes reputation effects for closed states', () => {
      assert.match(getReportStateInfo('resolved')!.definition, /gains 7 reputation/);
      assert.match(getReportStateInfo('informative')!.definition, /reputation does not change/);
      assert.match(getReportStateInfo('not-applicable')!.definition, /loses 5 reputation/);
      assert.match(getReportStateInfo('spam')!.definition, /loses 10 reputation/);
    });

    it('is frozen', () => {
      assert.ok(Object.isFrozen(reportStates));
      assert.ok(reportStates.every((info) => Object.isFrozen(info)));
      assert.ok(Object.isFrozen(changeableReportStates));
    });

    it('matches the README state table', async () => {
      const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
      for (const info of reportStates) {
        const status = info.status === 'open' ? 'Open' : 'Closed';
        const message = info.requiresMessage ? 'Yes' : 'No';
        const row = `| \`${info.state}\` | ${status} | ${message} | ${info.definition} |`;
        assert.ok(readme.includes(row), `README row for ${info.state} is missing or stale`);
      }
    });
  });

  describe('changeableReportStates', () => {
    it('contains every state except retesting', () => {
      assert.deepStrictEqual(
        changeableReportStates,
        Object.values(ReportState).filter((state) => state !== 'retesting')
      );
    });
  });

  describe('getReportStateInfo', () => {
    it('returns the info for a known state', () => {
      const info = getReportStateInfo('duplicate');
      assert.strictEqual(info?.status, 'closed');
      assert.strictEqual(info?.requiresMessage, true);
      assert.strictEqual(info?.changeable, true);
    });

    it('returns undefined for an unknown state', () => {
      assert.strictEqual(getReportStateInfo('closed'), undefined);
    });
  });

  describe('isChangeableReportState', () => {
    it('accepts changeable states only', () => {
      assert.strictEqual(isChangeableReportState('informative'), true);
      assert.strictEqual(isChangeableReportState('pending-program-review'), true);
      assert.strictEqual(isChangeableReportState('retesting'), false);
      assert.strictEqual(isChangeableReportState('bogus'), false);
      assert.strictEqual(isChangeableReportState(undefined), false);
    });
  });

  describe('validateStateChange', () => {
    it('accepts valid changes', () => {
      validateStateChange('triaged');
      validateStateChange('resolved', { attachmentIds: [1, 2] });
      validateStateChange('informative', { message: 'Accepted risk' });
      validateStateChange('duplicate', { message: 'Dupe', originalReportId: 11111 });
    });

    it('rejects an unknown state', () => {
      assertValidationError(
        () => validateStateChange('closed'),
        /Unknown report state "closed"\. Valid states: new, pending-program-review, triaged/
      );
    });

    it('rejects retesting', () => {
      assertValidationError(
        () => validateStateChange('retesting'),
        /cannot be moved to retesting with a state change/
      );
    });

    for (const state of ['needs-more-info', 'informative', 'duplicate']) {
      it(`requires a message for ${state}`, () => {
        assertValidationError(
          () => validateStateChange(state),
          new RegExp(`message is required to move a report to ${state}`)
        );
        assertValidationError(
          () => validateStateChange(state, { message: '  \n' }),
          /message is required/
        );
      });
    }

    it('only accepts originalReportId for duplicate', () => {
      assertValidationError(
        () => validateStateChange('spam', { originalReportId: 11111 }),
        /only be set when moving a report to duplicate/
      );
    });

    it('rejects an invalid originalReportId', () => {
      assertValidationError(
        () => validateStateChange('duplicate', { message: 'Dupe', originalReportId: 1.5 }),
        /originalReportId must be a positive integer/
      );
    });

    it('rejects invalid attachment IDs', () => {
      assertValidationError(
        () => validateStateChange('triaged', { attachmentIds: [1, 0] }),
        /attachmentIds must be positive integers/
      );
    });
  });
});
