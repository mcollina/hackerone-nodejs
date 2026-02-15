import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import { HackerOneClient } from '../../src/lib/client.ts';
import {
  listActivities,
  filterComments,
  listAllActivities,
} from '../../src/lib/activities.ts';
import activitiesFixture from '../fixtures/activities.json' with { type: 'json' };

describe('Activities API', () => {
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;
  let client: HackerOneClient;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    setGlobalDispatcher(mockAgent);
    mockAgent.disableNetConnect();
    client = new HackerOneClient({
      apiIdentifier: 'test',
      apiToken: 'token',
    });
  });

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
  });

  describe('listActivities', () => {
    it('should list activities for a program', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/incremental/activities?handle=security',
          method: 'GET',
        })
        .reply(200, activitiesFixture);

      const result = await listActivities(client, 'security');

      assert.strictEqual(result.data.length, 3);
      assert.strictEqual(result.data[0].type, 'activity-comment');
      assert.strictEqual(result.data[1].type, 'activity-bug-triaged');
    });

    it('should filter activities by report ID', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/incremental/activities?handle=security&report_id=12345',
          method: 'GET',
        })
        .reply(200, activitiesFixture);

      const result = await listActivities(client, 'security', {
        reportId: 12345,
      });

      assert.strictEqual(result.data.length, 3);
    });

    it('should filter activities by updated_at_after', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      const date = new Date('2024-01-16T00:00:00.000Z');
      mockPool
        .intercept({
          path: '/v1/incremental/activities?handle=security&updated_at_after=2024-01-16T00%3A00%3A00.000Z',
          method: 'GET',
        })
        .reply(200, {
          data: [activitiesFixture.data[1], activitiesFixture.data[2]],
          links: { self: '/incremental/activities' },
        });

      const result = await listActivities(client, 'security', {
        updatedAtAfter: date,
      });

      assert.strictEqual(result.data.length, 2);
    });

    it('should support pagination', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/incremental/activities?handle=security&page%5Bnumber%5D=2&page%5Bsize%5D=50',
          method: 'GET',
        })
        .reply(200, {
          data: [],
          links: { self: '/incremental/activities' },
        });

      const result = await listActivities(client, 'security', {
        page: 2,
        pageSize: 50,
      });

      assert.strictEqual(result.data.length, 0);
    });
  });

  describe('filterComments', () => {
    it('should filter only comment activities with messages', () => {
      const comments = filterComments(activitiesFixture.data as any);

      assert.strictEqual(comments.length, 2);
      assert.strictEqual(comments[0].type, 'activity-comment');
      assert.strictEqual(
        comments[0].attributes.message,
        "Thanks for the report! We're investigating this issue."
      );
      assert.strictEqual(comments[1].type, 'activity-comment');
      assert.strictEqual(
        comments[1].attributes.message,
        "Here's additional context with an attachment."
      );
    });

    it('should exclude non-comment activities', () => {
      const activities = [
        {
          id: 'act-1',
          type: 'activity-bug-triaged',
          attributes: {
            message: null,
            created_at: '2024-01-16T08:00:00.000Z',
            updated_at: '2024-01-16T08:00:00.000Z',
            internal: false,
          },
        },
        {
          id: 'act-2',
          type: 'activity-state-change',
          attributes: {
            message: null,
            created_at: '2024-01-16T09:00:00.000Z',
            updated_at: '2024-01-16T09:00:00.000Z',
            internal: false,
          },
        },
      ];

      const comments = filterComments(activities as any);

      assert.strictEqual(comments.length, 0);
    });

    it('should exclude comments with null messages', () => {
      const activities = [
        {
          id: 'act-1',
          type: 'activity-comment',
          attributes: {
            message: null,
            created_at: '2024-01-16T08:00:00.000Z',
            updated_at: '2024-01-16T08:00:00.000Z',
            internal: false,
          },
        },
      ];

      const comments = filterComments(activities as any);

      assert.strictEqual(comments.length, 0);
    });
  });

  describe('listAllActivities', () => {
    it('should iterate through all pages', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');

      // First page
      mockPool
        .intercept({
          path: '/v1/incremental/activities?handle=security&page%5Bnumber%5D=1&page%5Bsize%5D=100',
          method: 'GET',
        })
        .reply(200, {
          data: [activitiesFixture.data[0]],
          links: {
            self: '/incremental/activities?page[number]=1',
            next: '/incremental/activities?page[number]=2',
          },
        });

      // Second page
      mockPool
        .intercept({
          path: '/v1/incremental/activities?handle=security&page%5Bnumber%5D=2&page%5Bsize%5D=100',
          method: 'GET',
        })
        .reply(200, {
          data: [activitiesFixture.data[1]],
          links: {
            self: '/incremental/activities?page[number]=2',
          },
        });

      const activities = [];
      for await (const activity of listAllActivities(client, 'security')) {
        activities.push(activity);
      }

      assert.strictEqual(activities.length, 2);
    });
  });
});
