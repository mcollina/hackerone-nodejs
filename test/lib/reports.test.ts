import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import { HackerOneClient } from '../../src/lib/client.ts';
import { listReports, getReport, listAllReports } from '../../src/lib/reports.ts';
import { ReportState } from '../../src/lib/types.ts';
import reportsFixture from '../fixtures/reports.json' with { type: 'json' };
import reportFixture from '../fixtures/report.json' with { type: 'json' };

describe('Reports API', () => {
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

  describe('listReports', () => {
    it('should list reports', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports',
          method: 'GET',
        })
        .reply(200, reportsFixture);

      const result = await listReports(client);

      assert.strictEqual(result.data.length, 2);
      assert.strictEqual(result.data[0].attributes.title, 'XSS in search functionality');
      assert.strictEqual(result.data[1].attributes.title, 'SSRF in webhook handler');
    });

    it('should filter reports by state', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports?filter%5Bstate%5D%5B%5D=triaged',
          method: 'GET',
        })
        .reply(200, {
          data: [reportsFixture.data[0]],
          links: { self: '/reports' },
        });

      const result = await listReports(client, { state: ReportState.Triaged });

      assert.strictEqual(result.data.length, 1);
      assert.strictEqual(result.data[0].attributes.state, 'triaged');
    });

    it('should filter reports by multiple states', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports?filter%5Bstate%5D%5B%5D=new&filter%5Bstate%5D%5B%5D=triaged',
          method: 'GET',
        })
        .reply(200, reportsFixture);

      const result = await listReports(client, {
        state: [ReportState.New, ReportState.Triaged],
      });

      assert.strictEqual(result.data.length, 2);
    });

    it('should filter reports by program', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports?filter%5Bprogram%5D%5B%5D=myprogram',
          method: 'GET',
        })
        .reply(200, {
          data: [reportsFixture.data[0]],
          links: { self: '/reports' },
        });

      const result = await listReports(client, { program: 'myprogram' });

      assert.strictEqual(result.data.length, 1);
    });

    it('should filter reports by multiple programs', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports?filter%5Bprogram%5D%5B%5D=program1&filter%5Bprogram%5D%5B%5D=program2',
          method: 'GET',
        })
        .reply(200, reportsFixture);

      const result = await listReports(client, {
        program: ['program1', 'program2'],
      });

      assert.strictEqual(result.data.length, 2);
    });

    it('should filter reports by severity', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports?filter%5Bseverity%5D%5B%5D=high&filter%5Bseverity%5D%5B%5D=critical',
          method: 'GET',
        })
        .reply(200, {
          data: [reportsFixture.data[1]],
          links: { self: '/reports' },
        });

      const result = await listReports(client, {
        severity: ['high', 'critical'],
      });

      assert.strictEqual(result.data.length, 1);
    });

    it('should combine multiple filters', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports?filter%5Bstate%5D%5B%5D=triaged&filter%5Bprogram%5D%5B%5D=myprogram',
          method: 'GET',
        })
        .reply(200, {
          data: [reportsFixture.data[0]],
          links: { self: '/reports' },
        });

      const result = await listReports(client, {
        state: ReportState.Triaged,
        program: 'myprogram',
      });

      assert.strictEqual(result.data.length, 1);
    });

    it('should list reports with pagination', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports?page%5Bnumber%5D=2&page%5Bsize%5D=50',
          method: 'GET',
        })
        .reply(200, {
          data: [],
          links: { self: '/reports?page[number]=2' },
        });

      const result = await listReports(client, { page: 2, pageSize: 50 });

      assert.strictEqual(result.data.length, 0);
    });
  });

  describe('getReport', () => {
    it('should get a single report by ID', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports/12345',
          method: 'GET',
        })
        .reply(200, reportFixture);

      const result = await getReport(client, 12345);

      assert.strictEqual(result.id, '12345');
      assert.strictEqual(result.type, 'report');
      assert.strictEqual(result.attributes.title, 'XSS in search functionality');
      assert.strictEqual(result.attributes.state, 'triaged');
    });

    it('should get report with string ID', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports/12345',
          method: 'GET',
        })
        .reply(200, reportFixture);

      const result = await getReport(client, '12345');

      assert.strictEqual(result.id, '12345');
    });

    it('should include attachments in response', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({
          path: '/v1/reports/12345',
          method: 'GET',
        })
        .reply(200, reportFixture);

      const result = await getReport(client, '12345');

      assert.ok(result.relationships.attachments);
      assert.strictEqual(result.relationships.attachments.data.length, 1);
      assert.strictEqual(
        result.relationships.attachments.data[0].attributes.file_name,
        'screenshot.png'
      );
    });
  });

  describe('listAllReports', () => {
    it('should iterate through all pages', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');

      // First page
      mockPool
        .intercept({
          path: '/v1/reports?page%5Bnumber%5D=1&page%5Bsize%5D=100',
          method: 'GET',
        })
        .reply(200, {
          data: [reportsFixture.data[0]],
          links: {
            self: '/reports?page[number]=1',
            next: '/reports?page[number]=2',
          },
        });

      // Second page
      mockPool
        .intercept({
          path: '/v1/reports?page%5Bnumber%5D=2&page%5Bsize%5D=100',
          method: 'GET',
        })
        .reply(200, {
          data: [reportsFixture.data[1]],
          links: {
            self: '/reports?page[number]=2',
          },
        });

      const reports = [];
      for await (const report of listAllReports(client)) {
        reports.push(report);
      }

      assert.strictEqual(reports.length, 2);
      assert.strictEqual(reports[0].id, '12345');
      assert.strictEqual(reports[1].id, '12346');
    });

    it('should respect filters when iterating', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');

      mockPool
        .intercept({
          path: '/v1/reports?page%5Bnumber%5D=1&page%5Bsize%5D=100&filter%5Bstate%5D%5B%5D=triaged',
          method: 'GET',
        })
        .reply(200, {
          data: [reportsFixture.data[0]],
          links: { self: '/reports' },
        });

      const reports = [];
      for await (const report of listAllReports(client, {
        state: ReportState.Triaged,
      })) {
        reports.push(report);
      }

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].attributes.state, 'triaged');
    });

    it('should use custom page size', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');

      mockPool
        .intercept({
          path: '/v1/reports?page%5Bnumber%5D=1&page%5Bsize%5D=25',
          method: 'GET',
        })
        .reply(200, {
          data: [reportsFixture.data[0]],
          links: { self: '/reports' },
        });

      const reports = [];
      for await (const report of listAllReports(client, { pageSize: 25 })) {
        reports.push(report);
      }

      assert.strictEqual(reports.length, 1);
    });
  });
});
