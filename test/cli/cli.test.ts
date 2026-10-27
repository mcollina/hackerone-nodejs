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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  let tmp: string;

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
    tmp = await mkdtemp(join(tmpdir(), 'hackerone-cli-'));
  });

  after(async () => {
    await rm(tmp, { recursive: true, force: true });
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

    const stateChange = /^\/v1\/reports\/([^/]+)\/state_changes$/.exec(path);
    if (req.method === 'POST' && stateChange) {
      if (stateChange[1] === 'locked') {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ errors: [{ title: 'Invalid state transition' }] })
        );
        return;
      }
      const parsed = body ? JSON.parse(body) : {};
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: {
            id: stateChange[1],
            type: 'report',
            attributes: { state: parsed.data?.attributes?.state },
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
    env: Record<string, string> = {},
    stdin?: string
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      const pending = execFileAsync('node', [cliPath, ...args], {
        env: {
          ...process.env,
          HACKERONE_API_IDENTIFIER: 'test',
          HACKERONE_API_TOKEN: 'test-token',
          HACKERONE_BASE_URL: baseUrl,
          ...env,
        },
      });
      pending.child.stdin?.end(stdin ?? '');
      const { stdout, stderr } = await pending;
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
      assert.match(
        stderr,
        /--message <text> or --message-file <path> is required to post a comment/
      );
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
    it('reads the message from --message-file', async () => {
      const file = join(tmp, 'note.md');
      await writeFile(file, 'Line one\n\nLine two\n');

      const { code, stderr } = await runCli([
        'reports',
        'comment',
        '12345',
        '--internal',
        '--message-file',
        file,
      ]);

      assert.strictEqual(code, 0, stderr);
      const sent = JSON.parse(requestBodies[0]);
      assert.strictEqual(sent.data.attributes.message, 'Line one\n\nLine two');
      assert.strictEqual(sent.data.attributes.internal, true);
    });

    it('reads the message from stdin with --message-file -', async () => {
      const { code, stderr } = await runCli(
        ['reports', 'comment', '12345', '--message-file', '-'],
        {},
        'From stdin\n'
      );

      assert.strictEqual(code, 0, stderr);
      const sent = JSON.parse(requestBodies[0]);
      assert.strictEqual(sent.data.attributes.message, 'From stdin');
    });

    it('errors when both --message and --message-file are given', async () => {
      const { stderr, code } = await runCli([
        'reports',
        'comment',
        '12345',
        '--message',
        'a',
        '--message-file',
        join(tmp, 'unused.md'),
      ]);

      assert.strictEqual(code, 1);
      assert.match(stderr, /either --message or --message-file/);
      assert.strictEqual(requestBodies.length, 0);
    });
  });

  describe('reports state', () => {
    it('changes the state with a message', async () => {
      const { stdout, stderr, code } = await runCli([
        'reports',
        'state',
        '12345',
        'triaged',
        '--message',
        'Thanks, we reproduced it.',
      ]);

      assert.strictEqual(code, 0, stderr);
      assert.match(stdout, /Report 12345 is now triaged/);
      assert.strictEqual(requestBodies.length, 1);
      assert.deepStrictEqual(JSON.parse(requestBodies[0]), {
        data: {
          type: 'state-change',
          attributes: { state: 'triaged', message: 'Thanks, we reproduced it.' },
        },
      });
    });

    it('reads the message from --message-file', async () => {
      const file = join(tmp, 'reply.md');
      await writeFile(file, 'Closing as informative.\n');

      const { code, stderr } = await runCli([
        'reports',
        'state',
        '12345',
        'informative',
        '--message-file',
        file,
      ]);

      assert.strictEqual(code, 0, stderr);
      const sent = JSON.parse(requestBodies[0]);
      assert.strictEqual(sent.data.attributes.state, 'informative');
      assert.strictEqual(sent.data.attributes.message, 'Closing as informative.');
    });

    it('omits the message when none is given', async () => {
      const { code, stderr } = await runCli([
        'reports',
        'state',
        '12345',
        'resolved',
      ]);

      assert.strictEqual(code, 0, stderr);
      assert.deepStrictEqual(JSON.parse(requestBodies[0]), {
        data: { type: 'state-change', attributes: { state: 'resolved' } },
      });
    });

    it('outputs JSON with --json', async () => {
      const { stdout, code } = await runCli([
        'reports',
        'state',
        '12345',
        'triaged',
        '--json',
      ]);

      assert.strictEqual(code, 0);
      const report = JSON.parse(stdout);
      assert.strictEqual(report.id, '12345');
      assert.strictEqual(report.attributes.state, 'triaged');
    });

    it('errors on an invalid state', async () => {
      const { stderr, code } = await runCli([
        'reports',
        'state',
        '12345',
        'bogus',
      ]);

      assert.strictEqual(code, 1);
      assert.match(stderr, /Invalid state: bogus/);
      assert.strictEqual(requestBodies.length, 0);
    });

    it('errors without a state', async () => {
      const { stderr, code } = await runCli(['reports', 'state', '12345']);

      assert.strictEqual(code, 1);
      assert.match(stderr, /Report ID and state required/);
      assert.strictEqual(requestBodies.length, 0);
    });

    it('shows the API error body when the change is rejected', async () => {
      const { stderr, code } = await runCli([
        'reports',
        'state',
        'locked',
        'spam',
      ]);

      assert.strictEqual(code, 1);
      assert.match(stderr, /422/);
      assert.match(stderr, /Invalid state transition/);
    });
  });
});
