// 로컬 개발용 D1 도우미. 저장소에는 wrangler.toml을 두지 않는다
// (Pages 프로젝트에 wrangler.toml이 있으면 대시보드 바인딩을 쓸 수 없기 때문).
// 로컬 전용 설정을 .wrangler/dev/wrangler.toml에 만들어 마이그레이션·시드에 쓴다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const COMPAT_DATE = '2025-09-01';
export const LOCAL_DB_NAME = 'login-db';
export const LOCAL_DB_ID = 'local-login-db';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function writeLocalConfig(dir = path.join(ROOT, '.wrangler', 'dev')) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'wrangler.toml');
  fs.writeFileSync(file, [
    'name = "login-local"',
    `compatibility_date = "${COMPAT_DATE}"`,
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = "${LOCAL_DB_NAME}"`,
    `database_id = "${LOCAL_DB_ID}"`,
    `migrations_dir = "${path.join(ROOT, 'migrations')}"`,
    '',
  ].join('\n'));
  return file;
}

function wrangler(args, opts = {}) {
  return execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args],
    { cwd: ROOT, env: { ...process.env, CI: '1' }, stdio: opts.stdio || 'pipe' });
}

export function applyLocalMigrations(persistTo = path.join(ROOT, '.wrangler', 'state')) {
  const config = writeLocalConfig();
  wrangler(['d1', 'migrations', 'apply', LOCAL_DB_NAME, '--local', '-c', config, '--persist-to', persistTo]);
}

/** 로컬 D1 바인딩을 Node에서 연다(서비스 코드로 시드할 때 사용). */
export async function openLocalDb(persistTo = path.join(ROOT, '.wrangler', 'state')) {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy({ configPath: writeLocalConfig(), persist: { path: path.join(persistTo, 'v3') } });
  return { db: proxy.env.DB, dispose: () => proxy.dispose() };
}

export function pagesDevArgs({ port = 8788, persistTo = path.join(ROOT, '.wrangler', 'state'), bindings = [] } = {}) {
  return [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'pages', 'dev', 'public',
    '--d1', `DB=${LOCAL_DB_ID}`, '--persist-to', persistTo, '--compatibility-date', COMPAT_DATE, '--port', String(port),
    ...bindings.flatMap((b) => ['-b', b])];
}

export { ROOT, wrangler };
