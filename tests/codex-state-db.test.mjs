import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getCodexStateDatabaseCandidates,
  isCodexRuntimeSessionPathWithinHome,
  readCodexRuntimeSessions,
  resolveCodexSqliteHome,
} from '../src/main/codex-state-db.mjs';

test('sqlite_home config takes precedence over the environment and locates Codex state_5.sqlite', () => {
  const home = path.resolve('codex-home');
  const configured = path.resolve('configured-state');
  assert.equal(resolveCodexSqliteHome(home, {
    env: { CODEX_SQLITE_HOME: path.resolve('environment-state') },
    configText: `sqlite_home = "${configured.replaceAll('\\', '\\\\')}"\n[features]\nsqlite_home = "ignored"`,
  }), configured);
  assert.equal(getCodexStateDatabaseCandidates(home, {
    env: { CODEX_SQLITE_HOME: path.resolve('environment-state') },
    configText: '',
  })[0], path.join(path.resolve('environment-state'), 'state_5.sqlite'));
});

test('runtime session reads are bounded, close the database and request read-only mode', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-state-db-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const databasePath = path.join(root, 'sqlite', 'state_5.sqlite');
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  await fs.writeFile(databasePath, 'fixture');
  const rolloutPath = path.join(root, 'sessions', '2026', '10', '02', 'thread.jsonl');
  let openedOptions;
  let closed = false;
  const columns = ['id', 'rollout_path', 'updated_at_ms', 'recency_at_ms', 'archived', 'thread_source']
    .map((name) => ({ name }));
  class FakeDatabase {
    constructor(file, options) {
      assert.equal(file, databasePath);
      openedOptions = options;
    }
    prepare(sql) {
      if (sql === 'PRAGMA table_info(threads)') return { all: () => columns };
      return { all: () => [
        { id: 'thread-one', rollout_path: rolloutPath, updated_at_ms: 1_790_897_000_000, recency_at_ms: 1_790_898_000_000 },
        { id: 'thread-two', rollout_path: rolloutPath, updated_at_ms: 1_790_896_000_000, recency_at_ms: 1_790_897_000_000 },
      ] };
    }
    close() { closed = true; }
  }

  const rows = await readCodexRuntimeSessions(root, {
    databaseFactory: FakeDatabase,
    runtimeVersion: '22.18.0',
    cutoffMs: 1_790_000_000_000,
    maximumRows: 1,
  });
  assert.deepEqual(rows, [{ id: 'thread-one', rolloutPath, updatedAtMs: 1_790_898_000_000 }]);
  assert.deepEqual(openedOptions, { readOnly: true, timeout: 75 });
  assert.equal(closed, true);
});

test('runtime rollout paths must remain inside Codex sessions directory', () => {
  const root = path.resolve('codex-home', 'sessions');
  assert.equal(isCodexRuntimeSessionPathWithinHome(path.join(root, '2026', 'thread.jsonl'), root), true);
  const extendedPath = process.platform === 'win32'
    ? `\\\\?\\${path.join(root, '2026', 'thread.jsonl')}`
    : path.join(root, '2026', 'thread.jsonl');
  assert.equal(isCodexRuntimeSessionPathWithinHome(extendedPath, root), true);
  assert.equal(isCodexRuntimeSessionPathWithinHome(path.resolve('other', 'thread.jsonl'), root), false);
  assert.equal(isCodexRuntimeSessionPathWithinHome(path.join(root, '..', 'hooks.json'), root), false);
});
