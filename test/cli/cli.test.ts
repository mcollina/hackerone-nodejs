import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';

const execFileAsync = promisify(execFile);
const cliPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/cli/index.ts'
);

/**
 * CLI harness.
 *
 * Spawns the real CLI as a subprocess against a local HTTP server that mocks
 * the HackerOne API. The `HACKERONE_BASE_URL` env override points the client
 * at the in-process server, so we exercise argv parsing, validation, dispatch
 * and output formatting end-to-end.
 */
describe('CLI', () => {
  let server: Server;
  let baseUrl: string;
  let requestBodies: string[] = [];

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        requestBodies.push(body);
        handleRequest(req, res, body);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  beforeEach(() => {
    requestBodies = [];
  });

  function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    body: string
  ): void {
    const path = req.url ?? '';
    if (
      req.method === 'POST' &&
      /^\/v1\/reports\/[^/]+\/activities$/.test(path)
    ) {
      // Echo the posted data back as the created activity so the CLI output
      // reflects exactly what was sent.
      const parsed = body ? JSON.parse(body) : {};
      const attributes: Record<string, unknown> =
        parsed.data?.attributes ?? {};
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: {
            id: 'act-new',
            type: 'activity-comment',
            attributes: {
              ...attributes,
              created_at: '2024-01-18T09:00:00.000Z',
              updated_at: '2024-01-18T09:00:00.000Z',
            },
          },
        })
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ errors: [{ detail: `Not found: ${req.method} ${path}` }] })
    );
  }

  async function runCli(
    args: string[],
    env: Record<string, string> = {}
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      const { stdout, stderr } = await execFileAsync('node', [cliPath, ...args], {
        env: {
          ...process.env,
          HACKERONE_API_IDENTIFIER: 'test',
          HACKERONE_API_TOKEN: 'test-token',
          HACKERONE_BASE_URL: baseUrl,
          ...env,
        },
      });
      return { stdout: String(stdout), stderr: String(stderr), code: 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: String(e.stdout ?? ''),
        stderr: String(e.stderr ?? ''),
        code: e.code ?? 1,
      };
    }
  }

  describe('reports comment', () => {
    it('posts a public comment', async () => {
      const message = 'A fix has been deployed. Can you retest?';
      const { stdout, stderr, code } = await runCli([
        'reports',
        'comment',
        '12345',
        '--message',
        message,
      ]);

      assert.strictEqual(code, 0, stderr);
      assert.match(stdout, /Comment posted to report 12345:/);
      assert.match(stdout, new RegExp(message.replace(/\./g, '\\.')));

      assert.strictEqual(requestBodies.length, 1);
      const sent = JSON.parse(requestBodies[0]);
      assert.strictEqual(sent.data.type, 'activity-comment');
      assert.strictEqual(sent.data.attributes.message, message);
      assert.strictEqual(sent.data.attributes.internal, false);
      assert.ok(!('attachment_ids' in sent.data.attributes));
    });

    it('posts an internal comment', async () => {
      const { code } = await runCli([
        'reports',
        'comment',
        '12345',
        '--message',
        'Internal note',
        '--internal',
      ]);

      assert.strictEqual(code, 0);
      const sent = JSON.parse(requestBodies[0]);
      assert.strictEqual(sent.data.attributes.internal, true);
    });

    it('includes attachment ids', async () => {
      const { code } = await runCli([
        'reports',
        'comment',
        '12345',
        '--message',
        'POC attached',
        '--attachment-id',
        '42',
        '--attachment-id',
        '43',
      ]);

      assert.strictEqual(code, 0);
      const sent = JSON.parse(requestBodies[0]);
      assert.deepStrictEqual(sent.data.attributes.attachment_ids, [42, 43]);
    });

    it('outputs JSON with --json', async () => {
      const { stdout, code } = await runCli([
        'reports',
        'comment',
        '12345',
        '--message',
        'hello',
        '--json',
      ]);

      assert.strictEqual(code, 0);
      const parsed = JSON.parse(stdout);
      assert.strictEqual(parsed.type, 'activity-comment');
      assert.strictEqual(parsed.attributes.message, 'hello');
    });

    it('errors without --message', async () => {
      const { stderr, code } = await runCli([
        'reports',
        'comment',
        '12345',
      ]);

      assert.strictEqual(code, 1);
      assert.match(stderr, /--message <text> is required to post a comment/);
      assert.strictEqual(requestBodies.length, 0);
    });

    it('errors without a report id', async () => {
      const { stderr, code } = await runCli([
        'reports',
        'comment',
        '--message',
        'hello',
      ]);

      assert.strictEqual(code, 1);
      assert.match(stderr, /Report ID required/);
      assert.strictEqual(requestBodies.length, 0);
    });

    it('errors on an invalid attachment id', async () => {
      const { stderr, code } = await runCli([
        'reports',
        'comment',
        '12345',
        '--message',
        'x',
        '--attachment-id',
        'abc',
      ]);

      assert.strictEqual(code, 1);
      assert.match(stderr, /Invalid attachment ID: abc/);
      assert.strictEqual(requestBodies.length, 0);
    });
  });
});
