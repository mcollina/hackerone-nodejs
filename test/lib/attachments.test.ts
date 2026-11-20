import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import {
  attachmentFileName,
  downloadAttachment,
  downloadAttachments,
  downloadReportWithAttachments,
  collectAllAttachments,
  listReportAttachments,
} from '../../src/lib/attachments.ts';
import { HackerOneClient } from '../../src/lib/client.ts';
import { isAppError } from '../../src/lib/errors.ts';
import type { Attachment, Report, Activity } from '../../src/lib/types.ts';
import reportFixture from '../fixtures/report.json' with { type: 'json' };
import activitiesFixture from '../fixtures/activities.json' with { type: 'json' };

const FILES_ORIGIN = 'https://hackerone-attachments.s3.amazonaws.com';

function makeAttachment(id: string, fileName: string, fileSize = 5): Attachment {
  return {
    id,
    type: 'attachment',
    attributes: {
      file_name: fileName,
      content_type: 'text/plain',
      file_size: fileSize,
      expiring_url: `${FILES_ORIGIN}/${id}?token=abc`,
      created_at: '2024-01-15T10:30:00.000Z',
    },
  };
}

async function assertAppError(promise: Promise<unknown>, code: string, pattern: RegExp) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(isAppError(err));
    assert.strictEqual(err.code, code);
    assert.match(err.message, pattern);
    return true;
  });
}

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

    it('should list an attachment once when it appears more than once', () => {
      const report = reportFixture.data as unknown as Report;
      const activity = {
        ...activitiesFixture.data[0],
        relationships: { attachments: { data: [reportFixture.data.relationships.attachments.data[0]] } },
      } as unknown as Activity;

      const attachments = collectAllAttachments(report, [activity]);

      assert.deepStrictEqual(attachments.map((a) => a.id), ['att-1']);
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

    it('should throw when the download link fails, leaving no file behind', async () => {
      mockAgent
        .get(FILES_ORIGIN)
        .intercept({ path: '/att-1?token=abc', method: 'GET' })
        .reply(403, '<Error><Code>AccessDenied</Code></Error>');

      const dir = join(testDir, 'failed');
      await assertAppError(
        downloadAttachment(makeAttachment('att-1', 'poc.txt'), join(dir, 'poc.txt')),
        'API_ERROR',
        /^Could not download attachment att-1-poc\.txt: HTTP 403\. Download links expire/
      );
      assert.deepStrictEqual(await readdir(dir), []);
    });

    it('should keep an existing file when the download fails', async () => {
      mockAgent
        .get(FILES_ORIGIN)
        .intercept({ path: '/att-1?token=abc', method: 'GET' })
        .reply(500, 'Internal error');

      const destPath = join(testDir, 'poc.txt');
      await writeFile(destPath, 'old');
      await assertAppError(
        downloadAttachment(makeAttachment('att-1', 'poc.txt'), destPath),
        'API_ERROR',
        /HTTP 500$/
      );
      assert.strictEqual(await readFile(destPath, 'utf-8'), 'old');
    });

    it('should refuse an attachment whose reported size exceeds maxBytes without requesting it', async () => {
      // No interceptor: a request would fail with a different error.
      await assertAppError(
        downloadAttachment(makeAttachment('att-1', 'big.mp4', 11), join(testDir, 'big.mp4'), {
          maxBytes: 10,
        }),
        'ATTACHMENT_TOO_LARGE',
        /larger than 10 bytes/
      );
    });

    it('should refuse a download whose content-length exceeds maxBytes', async () => {
      mockAgent
        .get(FILES_ORIGIN)
        .intercept({ path: '/att-1?token=abc', method: 'GET' })
        .reply(200, Buffer.alloc(100), { headers: { 'content-length': '100' } });

      await assertAppError(
        downloadAttachment(makeAttachment('att-1', 'big.mp4', 5), join(testDir, 'big.mp4'), {
          maxBytes: 10,
        }),
        'ATTACHMENT_TOO_LARGE',
        /larger than 10 bytes/
      );
      assert.deepStrictEqual(await readdir(testDir), []);
    });

    it('should stop a download that grows past maxBytes and remove the partial file', async () => {
      mockAgent
        .get(FILES_ORIGIN)
        .intercept({ path: '/att-1?token=abc', method: 'GET' })
        .reply(200, Buffer.alloc(100));

      await assertAppError(
        downloadAttachment(makeAttachment('att-1', 'big.mp4', 5), join(testDir, 'big.mp4'), {
          maxBytes: 10,
        }),
        'ATTACHMENT_TOO_LARGE',
        /larger than 10 bytes/
      );
      assert.deepStrictEqual(await readdir(testDir), []);
    });

    it('should keep an existing file when a download stops partway', async () => {
      mockAgent
        .get(FILES_ORIGIN)
        .intercept({ path: '/att-1?token=abc', method: 'GET' })
        .reply(200, Buffer.alloc(100));

      const destPath = join(testDir, 'big.mp4');
      await writeFile(destPath, 'old');
      await assertAppError(
        downloadAttachment(makeAttachment('att-1', 'big.mp4', 5), destPath, { maxBytes: 10 }),
        'ATTACHMENT_TOO_LARGE',
        /larger than 10 bytes/
      );
      assert.strictEqual(await readFile(destPath, 'utf-8'), 'old');
      assert.deepStrictEqual(await readdir(testDir), ['big.mp4']);
    });

    it('should reject an invalid maxBytes', async () => {
      await assertAppError(
        downloadAttachment(makeAttachment('att-1', 'poc.txt'), join(testDir, 'poc.txt'), {
          maxBytes: 0,
        }),
        'VALIDATION_ERROR',
        /maxBytes must be a positive integer/
      );
    });
  });

  describe('attachmentFileName', () => {
    it('should prefix the file name with the attachment ID', () => {
      assert.strictEqual(attachmentFileName(makeAttachment('123', 'poc.txt')), '123-poc.txt');
    });

    it('should drop folder parts from the file name', () => {
      assert.strictEqual(attachmentFileName(makeAttachment('4', '../../escaped.txt')), '4-escaped.txt');
      assert.strictEqual(attachmentFileName(makeAttachment('4', '..\\..\\evil.bat')), '4-evil.bat');
      assert.strictEqual(attachmentFileName(makeAttachment('4', '/etc/passwd')), '4-passwd');
    });

    it('should replace unsafe characters', () => {
      assert.strictEqual(
        attachmentFileName(makeAttachment('4', 'a<b>c:d"e|f?g*h\u0000i.txt')),
        '4-a_b_c_d_e_f_g_h_i.txt'
      );
      // A right-to-left override would display "invoice\u202Egnp.exe" as "invoiceexe.png".
      assert.strictEqual(
        attachmentFileName(makeAttachment('4', 'invoice\u202Egnp.exe')),
        '4-invoice_gnp.exe'
      );
      assert.strictEqual(attachmentFileName(makeAttachment('../x', 'poc.txt')), '___x-poc.txt');
    });

    it('should fall back when nothing usable is left', () => {
      for (const name of ['', '.', '..', 'folder/', ' . ']) {
        assert.strictEqual(attachmentFileName(makeAttachment('4', name)), '4-attachment', name);
      }
      assert.strictEqual(attachmentFileName(makeAttachment('4', 'poc.txt. ')), '4-poc.txt');
    });

    it('should keep names within 200 bytes', () => {
      const name = attachmentFileName(makeAttachment('4', `${'\u00e9'.repeat(300)}.txt`));
      assert.ok(name.startsWith('4-\u00e9'));
      assert.ok(Buffer.byteLength(name) <= 200, String(Buffer.byteLength(name)));
    });
  });

  describe('downloadAttachments', () => {
    it('should keep files with the same name apart and inside the folder', async () => {
      const mockPool = mockAgent.get(FILES_ORIGIN);
      mockPool.intercept({ path: '/2?token=abc', method: 'GET' }).reply(200, 'first');
      mockPool.intercept({ path: '/3?token=abc', method: 'GET' }).reply(200, 'second');
      mockPool.intercept({ path: '/4?token=abc', method: 'GET' }).reply(200, 'third');

      const dir = join(testDir, 'report', 'attachments');
      const downloaded = await downloadAttachments(
        [
          makeAttachment('2', 'poc.txt'),
          makeAttachment('3', 'poc.txt'),
          makeAttachment('4', '../../escaped.txt'),
        ],
        dir
      );

      assert.deepStrictEqual(
        downloaded.map((item) => [item.attachment.id, item.path]),
        [
          ['2', join(dir, '2-poc.txt')],
          ['3', join(dir, '3-poc.txt')],
          ['4', join(dir, '4-escaped.txt')],
        ]
      );
      assert.strictEqual(await readFile(join(dir, '2-poc.txt'), 'utf-8'), 'first');
      assert.strictEqual(await readFile(join(dir, '3-poc.txt'), 'utf-8'), 'second');
      assert.deepStrictEqual((await readdir(dir)).sort(), ['2-poc.txt', '3-poc.txt', '4-escaped.txt']);
      assert.deepStrictEqual(await readdir(testDir), ['report']);
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
      assert.deepStrictEqual(files.sort(), ['att-1-screenshot.png', 'att-2-poc.mp4']);

      const markdown = await readFile(join(destDir, 'report.md'), 'utf-8');
      assert.ok(markdown.includes('- [att-1-screenshot.png](attachments/att-1-screenshot.png)'));
      assert.ok(markdown.includes('- [att-2-poc.mp4](attachments/att-2-poc.mp4)'));
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

  describe('listReportAttachments', () => {
    const client = new HackerOneClient({ apiIdentifier: 'test', apiToken: 'token' });
    const commentAttachment = activitiesFixture.data.find(
      (activity) => activity.relationships?.attachments
    )!;

    function reportWith(program: object) {
      return {
        data: {
          ...reportFixture.data,
          relationships: {
            ...reportFixture.data.relationships,
            program: { data: program },
            activities: { data: [commentAttachment] },
          },
        },
      };
    }

    it('should list report and activity attachments once each', async () => {
      const mockPool = mockAgent.get('https://api.hackerone.com');
      mockPool
        .intercept({ path: '/v1/reports/12345', method: 'GET' })
        .reply(200, reportWith({ id: '1', type: 'program', attributes: { handle: 'security' } }));
      mockPool
        .intercept({
          path: '/v1/incremental/activities?handle=security&report_id=12345&page%5Bnumber%5D=1&page%5Bsize%5D=100',
          method: 'GET',
        })
        .reply(200, activitiesFixture);

      const attachments = await listReportAttachments(client, 12345);

      assert.deepStrictEqual(attachments.map((a) => a.id), ['att-1', 'att-2']);
      mockAgent.assertNoPendingInterceptors();
    });

    it('should use the activities on the report when there is no program handle', async () => {
      mockAgent
        .get('https://api.hackerone.com')
        .intercept({ path: '/v1/reports/12345', method: 'GET' })
        .reply(200, reportWith({ id: '1', type: 'program' }));

      const attachments = await listReportAttachments(client, '12345');

      assert.deepStrictEqual(attachments.map((a) => a.id), ['att-1', 'att-2']);
    });
  });
});
