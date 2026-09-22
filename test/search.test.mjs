import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
test('built CLI sends authenticated, encoded search and preserves pagination JSON', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'cloudbtl-search-test-'));
  const requests = [];
  const response = { ok: true, matching: 'all_keywords', order: 'descriptor_id', results: [], nextCursor: 'next-cursor' };
  const server = createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, XDG_CONFIG_HOME: temp, CLOUDBTL_TOKEN: 'cbtl_test_only' };
  const cli = (...args) => exec(process.execPath, ['dist/cli.js', ...args], { env });
  try {
    await cli('config', '--api-base', `http://127.0.0.1:${server.address().port}`);
    const { stdout } = await cli('--json', 'search', '임대료 50%_VAT', '--tree', '팀/자료', '--node', 'node_1', '--cursor', 'opaque+/=', '--limit', '2');
    assert.deepEqual(JSON.parse(stdout), response);
    assert.equal(requests[0].auth, 'Bearer cbtl_test_only');
    const url = new URL(requests[0].url, 'http://test');
    assert.equal(url.pathname, '/api/trees/%ED%8C%80%2F%EC%9E%90%EB%A3%8C/nodes/node_1/search');
    assert.equal(url.searchParams.get('q'), '임대료 50%_VAT');
    assert.equal(url.searchParams.get('cursor'), 'opaque+/=');
    assert.equal(url.searchParams.get('limit'), '2');
    await assert.rejects(cli('search', '임대료', '--node', 'node_1'), /--node requires --tree/);
    assert.equal(requests.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
