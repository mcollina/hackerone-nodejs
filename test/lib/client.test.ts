import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import { HackerOneClient } from '../../src/lib/client.ts';
import { isAppError } from '../../src/lib/errors.ts';

describe('HackerOneClient', () => {
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    setGlobalDispatcher(mockAgent);
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();
  });

  it('should make authenticated requests', async () => {
    const mockPool = mockAgent.get('https://api.hackerone.com');
    mockPool
      .intercept({
        path: '/v1/programs',
        method: 'GET',
        headers: {
          Authorization: 'Basic dGVzdDp0b2tlbg==', // base64 of 'test:token'
        },
      })
      .reply(200, {
        data: [],
        links: { self: '/programs' },
      });

    const client = new HackerOneClient({
      apiIdentifier: 'test',
      apiToken: 'token',
    });
    const result = await client.request<{ data: unknown[] }>(
      'GET',
      '/programs'
    );

    assert.deepStrictEqual(result.data, []);
  });

  it('should build URL with query parameters', async () => {
    const mockPool = mockAgent.get('https://api.hackerone.com');
    mockPool
      .intercept({
        path: '/v1/reports?page%5Bnumber%5D=2&page%5Bsize%5D=50',
        method: 'GET',
      })
      .reply(200, {
        data: [],
        links: { self: '/reports' },
      });

    const client = new HackerOneClient({
      apiIdentifier: 'test',
      apiToken: 'token',
    });
    const result = await client.request<{ data: unknown[] }>(
      'GET',
      '/reports',
      {
        'page[number]': '2',
        'page[size]': '50',
      }
    );

    assert.deepStrictEqual(result.data, []);
  });

  it('should handle array query parameters', async () => {
    const mockPool = mockAgent.get('https://api.hackerone.com');
    mockPool
      .intercept({
        path: '/v1/reports?filter%5Bstate%5D%5B%5D=new&filter%5Bstate%5D%5B%5D=triaged',
        method: 'GET',
      })
      .reply(200, {
        data: [],
        links: { self: '/reports' },
      });

    const client = new HackerOneClient({
      apiIdentifier: 'test',
      apiToken: 'token',
    });
    const result = await client.request<{ data: unknown[] }>(
      'GET',
      '/reports',
      {
        'filter[state][]': ['new', 'triaged'],
      }
    );

    assert.deepStrictEqual(result.data, []);
  });

  it('should throw authenticationError on 401', async () => {
    const mockPool = mockAgent.get('https://api.hackerone.com');
    mockPool
      .intercept({
        path: '/v1/programs',
        method: 'GET',
      })
      .reply(401, { error: 'Unauthorized' });

    const client = new HackerOneClient({
      apiIdentifier: 'wrong',
      apiToken: 'credentials',
    });

    await assert.rejects(
      async () => client.request('GET', '/programs'),
      (err: unknown) => {
        assert.ok(isAppError(err));
        assert.strictEqual(err.code, 'AUTHENTICATION_ERROR');
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );
  });

  it('should throw notFoundError on 404', async () => {
    const mockPool = mockAgent.get('https://api.hackerone.com');
    mockPool
      .intercept({
        path: '/v1/reports/99999',
        method: 'GET',
      })
      .reply(404, { error: 'Not found' });

    const client = new HackerOneClient({
      apiIdentifier: 'test',
      apiToken: 'token',
    });

    await assert.rejects(
      async () => client.request('GET', '/reports/99999'),
      (err: unknown) => {
        assert.ok(isAppError(err));
        assert.strictEqual(err.code, 'NOT_FOUND');
        assert.strictEqual(err.statusCode, 404);
        return true;
      }
    );
  });

  it('should throw rateLimitError on 429', async () => {
    const mockPool = mockAgent.get('https://api.hackerone.com');
    mockPool
      .intercept({
        path: '/v1/reports',
        method: 'GET',
      })
      .reply(429, { error: 'Rate limit exceeded' }, {
        headers: { 'retry-after': '60' },
      });

    const client = new HackerOneClient({
      apiIdentifier: 'test',
      apiToken: 'token',
    });

    await assert.rejects(
      async () => client.request('GET', '/reports'),
      (err: unknown) => {
        assert.ok(isAppError(err));
        assert.strictEqual(err.code, 'RATE_LIMIT');
        assert.strictEqual(err.statusCode, 429);
        assert.strictEqual(err.retryAfter, 60);
        return true;
      }
    );
  });

  it('should throw apiError on other 4xx/5xx errors', async () => {
    const mockPool = mockAgent.get('https://api.hackerone.com');
    mockPool
      .intercept({
        path: '/v1/reports',
        method: 'GET',
      })
      .reply(500, { error: 'Internal server error' });

    const client = new HackerOneClient({
      apiIdentifier: 'test',
      apiToken: 'token',
    });

    await assert.rejects(
      async () => client.request('GET', '/reports'),
      (err: unknown) => {
        assert.ok(isAppError(err));
        assert.strictEqual(err.code, 'API_ERROR');
        assert.strictEqual(err.statusCode, 500);
        return true;
      }
    );
  });

  it('should use custom base URL when provided', async () => {
    const mockPool = mockAgent.get('https://custom.api.example.com');
    mockPool
      .intercept({
        path: '/v1/programs',
        method: 'GET',
      })
      .reply(200, {
        data: [],
        links: { self: '/programs' },
      });

    const client = new HackerOneClient({
      apiIdentifier: 'test',
      apiToken: 'token',
      baseUrl: 'https://custom.api.example.com/v1',
    });
    const result = await client.request<{ data: unknown[] }>(
      'GET',
      '/programs'
    );

    assert.deepStrictEqual(result.data, []);
  });
});
