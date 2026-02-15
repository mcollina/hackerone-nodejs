import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import {
  downloadAttachment,
  downloadReportWithAttachments,
  collectAllAttachments,
} from '../../src/lib/attachments.ts';
import type { Attachment, Report, Activity } from '../../src/lib/types.ts';
import reportFixture from '../fixtures/report.json' with { type: 'json' };
import activitiesFixture from '../fixtures/activities.json' with { type: 'json' };

describe('Attachments', () => {
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;
  let testDir: string;

  beforeEach(async () => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    setGlobalDispatcher(mockAgent);
    mockAgent.disableNetConnect();

    // Create temporary test directory
    testDir = join(tmpdir(), `hackerone-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher);
    await mockAgent.close();

    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('collectAllAttachments', () => {
    it('should collect attachments from report', () => {
      const report = reportFixture.data as unknown as Report;
      const attachments = collectAllAttachments(report, []);

      assert.strictEqual(attachments.length, 1);
      assert.strictEqual(attachments[0].attributes.file_name, 'screenshot.png');
    });

    it('should collect attachments from activities', () => {
      const report = {
        ...reportFixture.data,
        relationships: { program: { data: { id: '1', type: 'program' } } },
      } as unknown as Report;
      const activities = activitiesFixture.data as unknown as Activity[];

      const attachments = collectAllAttachments(report, activities);

      assert.strictEqual(attachments.length, 1);
      assert.strictEqual(attachments[0].attributes.file_name, 'poc.mp4');
    });

    it('should collect attachments from both report and activities', () => {
      const report = reportFixture.data as unknown as Report;
      const activities = activitiesFixture.data as unknown as Activity[];

      const attachments = collectAllAttachments(report, activities);

      assert.strictEqual(attachments.length, 2);
      assert.strictEqual(attachments[0].attributes.file_name, 'screenshot.png');
      assert.strictEqual(attachments[1].attributes.file_name, 'poc.mp4');
    });

    it('should handle empty attachments', () => {
      const report = {
        id: '1',
        type: 'report',
        attributes: {},
        relationships: { program: { data: { id: '1', type: 'program' } } },
      } as unknown as Report;

      const attachments = collectAllAttachments(report, []);

      assert.strictEqual(attachments.length, 0);
    });
  });

  describe('downloadAttachment', () => {
    it('should download attachment to file', async () => {
      const mockPool = mockAgent.get('https://hackerone-attachments.s3.amazonaws.com');
      mockPool
        .intercept({
          path: '/screenshot.png?token=abc',
          method: 'GET',
        })
        .reply(200, Buffer.from('fake image data'));

      const attachment: Attachment = {
        id: 'att-1',
        type: 'attachment',
        attributes: {
          file_name: 'screenshot.png',
          content_type: 'image/png',
          file_size: 15,
          expiring_url:
            'https://hackerone-attachments.s3.amazonaws.com/screenshot.png?token=abc',
          created_at: '2024-01-15T10:30:00.000Z',
        },
      };

      const destPath = join(testDir, 'downloads', 'screenshot.png');
      await downloadAttachment(attachment, destPath);

      const content = await readFile(destPath, 'utf-8');
      assert.strictEqual(content, 'fake image data');
    });

    it('should create parent directories', async () => {
      const mockPool = mockAgent.get('https://hackerone-attachments.s3.amazonaws.com');
      mockPool
        .intercept({
          path: '/nested/file.txt?token=xyz',
          method: 'GET',
        })
        .reply(200, Buffer.from('content'));

      const attachment: Attachment = {
        id: 'att-1',
        type: 'attachment',
        attributes: {
          file_name: 'file.txt',
          content_type: 'text/plain',
          file_size: 7,
          expiring_url:
            'https://hackerone-attachments.s3.amazonaws.com/nested/file.txt?token=xyz',
          created_at: '2024-01-15T10:30:00.000Z',
        },
      };

      const destPath = join(testDir, 'deep', 'nested', 'path', 'file.txt');
      await downloadAttachment(attachment, destPath);

      const content = await readFile(destPath, 'utf-8');
      assert.strictEqual(content, 'content');
    });
  });

  describe('downloadReportWithAttachments', () => {
    it('should save report JSON', async () => {
      const report = reportFixture.data as unknown as Report;

      // Mock attachment download
      const mockPool = mockAgent.get('https://hackerone-attachments.s3.amazonaws.com');
      mockPool
        .intercept({
          path: '/screenshot.png?token=abc',
          method: 'GET',
        })
        .reply(200, Buffer.from('image'));

      const destDir = join(testDir, 'report-12345');
      const result = await downloadReportWithAttachments(report, [], destDir);

      assert.strictEqual(result.reportPath, join(destDir, 'report.json'));

      const savedReport = JSON.parse(await readFile(result.reportPath, 'utf-8'));
      assert.strictEqual(savedReport.id, '12345');
      assert.strictEqual(savedReport.attributes.title, 'XSS in search functionality');
    });

    it('should save activities JSON when present', async () => {
      const report = {
        ...reportFixture.data,
        relationships: { program: { data: { id: '1', type: 'program' } } },
      } as unknown as Report;
      const activities = [activitiesFixture.data[0]] as unknown as Activity[];

      const destDir = join(testDir, 'report-with-activities');
      await downloadReportWithAttachments(report, activities, destDir);

      const activitiesPath = join(destDir, 'activities.json');
      const savedActivities = JSON.parse(await readFile(activitiesPath, 'utf-8'));
      assert.strictEqual(savedActivities.length, 1);
    });

    it('should download all attachments', async () => {
      const report = reportFixture.data as unknown as Report;
      const activities = activitiesFixture.data as unknown as Activity[];

      const mockPool = mockAgent.get('https://hackerone-attachments.s3.amazonaws.com');
      mockPool
        .intercept({
          path: '/screenshot.png?token=abc',
          method: 'GET',
        })
        .reply(200, Buffer.from('image data'));
      mockPool
        .intercept({
          path: '/poc.mp4?token=xyz',
          method: 'GET',
        })
        .reply(200, Buffer.from('video data'));

      const destDir = join(testDir, 'report-full');
      const result = await downloadReportWithAttachments(
        report,
        activities,
        destDir
      );

      assert.strictEqual(result.attachmentPaths.length, 2);

      const attachmentsDir = join(destDir, 'attachments');
      const files = await readdir(attachmentsDir);
      assert.ok(files.includes('screenshot.png'));
      assert.ok(files.includes('poc.mp4'));
    });

    it('should handle reports without attachments', async () => {
      const report = {
        id: '1',
        type: 'report',
        attributes: { title: 'Test' },
        relationships: { program: { data: { id: '1', type: 'program' } } },
      } as unknown as Report;

      const destDir = join(testDir, 'no-attachments');
      const result = await downloadReportWithAttachments(report, [], destDir);

      assert.strictEqual(result.attachmentPaths.length, 0);
      assert.ok(result.reportPath.endsWith('report.json'));
    });
  });
});
