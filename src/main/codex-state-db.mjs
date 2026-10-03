import fs from 'fs';
import os from 'os';
import path from 'path';

const STATE_DB_NAME = 'state_5.sqlite';
const MAX_RUNTIME_SESSIONS = 256;

function unquoteTomlPath(value) {
  const input = String(value || '').trim();
  if (input.length < 2) return '';
  const quote = input[0];
  if ((quote !== '"' && quote !== "'") || input.at(-1) !== quote) return '';
  const body = input.slice(1, -1);
  return quote === '"' ? body.replace(/\\(["\\])/g, '$1') : body;
}

function expandHome(value, homeDirectory = os.homedir()) {
  const input = String(value || '').trim();
  if (input === '~') return homeDirectory;
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(homeDirectory, input.slice(2));
  return input;
}

export function resolveCodexSqliteHome(codexHome, { env = process.env, configText = null } = {}) {
  let source = String(configText ?? '');
  if (configText === null) {
    try { source = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'); }
    catch { source = ''; }
  }
  // sqlite_home is a top-level Codex setting. Ignore section-local lookalikes.
  let currentSection = '';
  for (const line of source.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (section) {
      currentSection = section[1].trim();
      continue;
    }
    if (currentSection) continue;
    const setting = line.match(/^\s*sqlite_home\s*=\s*("(?:\\.|[^"])*"|'[^']*')\s*(?:#.*)?$/);
    if (!setting) continue;
    const configured = unquoteTomlPath(setting[1]);
    if (configured) return path.resolve(expandHome(configured));
  }
  const environmentHome = String(env.CODEX_SQLITE_HOME || '').trim();
  if (environmentHome) return path.resolve(expandHome(environmentHome));
  return path.resolve(codexHome);
}

export function getCodexStateDatabaseCandidates(codexHome, options = {}) {
  if (!codexHome) return [];
  const sqliteHome = resolveCodexSqliteHome(codexHome, options);
  const candidates = [
    path.join(sqliteHome, STATE_DB_NAME),
    path.join(codexHome, 'sqlite', STATE_DB_NAME),
    path.join(codexHome, STATE_DB_NAME),
  ];
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

export function normalizeCodexRuntimeSessionPath(input) {
  let candidate = String(input || '').trim();
  if (path.sep === '\\') {
    candidate = candidate.replace(/^\\\\\?\\UNC\\/i, '\\\\')
      .replace(/^\\\\\?\\/, '');
  }
  return candidate ? path.resolve(candidate) : '';
}

function hasReadOnlySqliteSupport(version = process.versions.node) {
  const [major = 0, minor = 0] = String(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  return major > 22 || (major === 22 && minor >= 18);
}

export function normalizeCodexRuntimeSessionRows(rows, { maximumRows = MAX_RUNTIME_SESSIONS } = {}) {
  const limit = Math.max(1, Math.min(MAX_RUNTIME_SESSIONS, Number(maximumRows) || MAX_RUNTIME_SESSIONS));
  const seen = new Set();
  const result = [];
  for (const row of rows || []) {
    const id = String(row?.id || '').trim();
    const rolloutPath = String(row?.rollout_path || '').trim();
    const updatedAtMs = Number(row?.recency_at_ms || row?.updated_at_ms || 0);
    if (!id || !rolloutPath || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, rolloutPath, updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0 });
    if (result.length >= limit) break;
  }
  return result;
}

function getThreadColumns(database) {
  try {
    return new Set(database.prepare('PRAGMA table_info(threads)').all().map((column) => String(column.name)));
  } catch {
    return new Set();
  }
}

function readRowsFromDatabase(database, { maximumRows, cutoffMs }) {
  const columns = getThreadColumns(database);
  if (!columns.has('id') || !columns.has('rollout_path')) return null;
  const timestampColumn = columns.has('recency_at_ms') ? 'recency_at_ms'
    : columns.has('updated_at_ms') ? 'updated_at_ms' : '';
  if (!timestampColumn) return null;

  const filters = [];
  if (columns.has('archived')) filters.push('archived = 0');
  if (cutoffMs > 0) filters.push(`${timestampColumn} >= ?`);
  const selectedColumns = ['id', 'rollout_path', timestampColumn];
  const sql = `SELECT ${selectedColumns.join(', ')} FROM threads${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY ${timestampColumn} DESC LIMIT ?`;
  try {
    const params = cutoffMs > 0 ? [cutoffMs, maximumRows] : [maximumRows];
    const rows = database.prepare(sql).all(...params);
    return normalizeCodexRuntimeSessionRows(rows, { maximumRows });
  } catch {
    return null;
  }
}

/**
 * Read only bounded thread metadata from Codex's local state DB.
 * The DB schema is internal and this is discovery/heartbeat evidence only;
 * callers must continue to use rollout lifecycle events for completion.
 */
export async function readCodexRuntimeSessions(codexHome, {
  env = process.env,
  maximumRows = MAX_RUNTIME_SESSIONS,
  cutoffMs = 0,
  databaseFactory = null,
  runtimeVersion = process.versions.node,
} = {}) {
  if (!codexHome || (!databaseFactory && !hasReadOnlySqliteSupport(runtimeVersion))) return [];
  const files = getCodexStateDatabaseCandidates(codexHome, { env })
    .filter((candidate) => {
      try { return fs.statSync(candidate).isFile(); }
      catch { return false; }
    });
  if (!files.length) return [];

  let DatabaseSync = databaseFactory;
  if (!DatabaseSync) {
    try { ({ DatabaseSync } = await import('node:sqlite')); }
    catch { return []; }
  }

  const rowLimit = Math.max(1, Math.min(MAX_RUNTIME_SESSIONS, Number(maximumRows) || MAX_RUNTIME_SESSIONS));
  for (const file of files) {
    let database;
    try {
      // Never open Codex's metadata database read/write. A short busy timeout
      // keeps the monitor responsive when Codex is committing a transaction.
      const options = { readOnly: true };
      const [major, minor] = String(runtimeVersion).split('.').map((part) => Number.parseInt(part, 10) || 0);
      if (major > 22 || (major === 22 && minor >= 16)) options.timeout = 75;
      database = new DatabaseSync(file, options);
      const rows = readRowsFromDatabase(database, { maximumRows: rowLimit, cutoffMs: Number(cutoffMs) || 0 });
      if (rows !== null) return rows;
    } catch {
      // Missing, locked, migrating, or newer DB schemas fall back to JSONL.
    } finally {
      try { database?.close(); } catch { /* Already closed or failed to open. */ }
    }
  }
  return [];
}

export function isCodexRuntimeSessionPathWithinHome(rolloutPath, sessionsRoot) {
  if (!rolloutPath || !sessionsRoot) return false;
  const root = normalizeCodexRuntimeSessionPath(sessionsRoot);
  const candidate = normalizeCodexRuntimeSessionPath(rolloutPath);
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
