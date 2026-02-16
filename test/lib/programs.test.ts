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
  listPrograms,
  getProgram,
  listStructuredScopes,
} from '../../src/lib/programs.ts';
import programsFixture from '../fixtures/programs.json' with { type: 'json' };
import programFixture from '../fixtures/program.json' with { type: 'json' };

describe('Programs API', () => {
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

  describe('listPrograms', () => {
    it('should list programs', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/me/programs',
          method: 'GET',
        })
        .reply(200, programsFixture);

      const result = await listPrograms(client);

      assert.strictEqual(result.data.length, 2);
      assert.strictEqual(result.data[0].attributes.handle, 'security');
      assert.strictEqual(result.data[1].attributes.handle, 'bounty-program');
    });

    it('should list programs with pagination', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/me/programs?page%5Bnumber%5D=2&page%5Bsize%5D=10',
          method: 'GET',
        })
        .reply(200, {
          data: [],
          links: { self: '/programs?page[number]=2' },
        });

      const result = await listPrograms(client, { page: 2, pageSize: 10 });

      assert.strictEqual(result.data.length, 0);
    });

    it('should include pagination links in response', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/me/programs',
          method: 'GET',
        })
        .reply(200, programsFixture);

      const result = await listPrograms(client);

      assert.ok(result.links.self);
      assert.ok(result.links.next);
      assert.ok(result.links.last);
    });
  });

  describe('getProgram', () => {
    it('should get a single program by ID', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/programs/1',
          method: 'GET',
        })
        .reply(200, programFixture);

      const result = await getProgram(client, '1');

      assert.strictEqual(result.id, '1');
      assert.strictEqual(result.type, 'program');
      assert.strictEqual(result.attributes.handle, 'security');
    });
  });

  describe('listStructuredScopes', () => {
    it('should list structured scopes for a program', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/programs/1/structured_scopes',
          method: 'GET',
        })
        .reply(200, {
          data: [
            {
              id: 'scope-1',
              type: 'structured-scope',
              attributes: {
                asset_identifier: '*.example.com',
                asset_type: 'URL',
                eligible_for_bounty: true,
                eligible_for_submission: true,
                instruction: null,
                max_severity: 'critical',
                created_at: '2024-01-01T00:00:00.000Z',
                updated_at: '2024-01-01T00:00:00.000Z',
              },
            },
          ],
          links: { self: '/programs/1/structured_scopes' },
        });

      const result = await listStructuredScopes(client, '1');

      assert.strictEqual(result.data.length, 1);
      assert.strictEqual(
        result.data[0].attributes.asset_identifier,
        '*.example.com'
      );
      assert.strictEqual(result.data[0].attributes.eligible_for_bounty, true);
    });

    it('should list structured scopes with pagination', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/programs/1/structured_scopes?page%5Bnumber%5D=1&page%5Bsize%5D=50',
          method: 'GET',
        })
        .reply(200, {
          data: [],
          links: { self: '/programs/1/structured_scopes' },
        });

      const result = await listStructuredScopes(client, '1', {
        page: 1,
        pageSize: 50,
      });

      assert.strictEqual(result.data.length, 0);
    });
  });
});
