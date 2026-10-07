// 원격(운영) D1에 마이그레이션 적용. 적용 이력은 D1의 d1_migrations 테이블에 남는다.
// 사용법: npm run db:migrate:remote -- --id <D1 database_id> [--db login-db]
// 저장소에 wrangler.toml을 두지 않으므로(대시보드 바인딩 사용) 임시 설정 파일을 만들어 실행한다.
// wrangler 로그인(npx wrangler login) 또는 CLOUDFLARE_API_TOKEN이 필요하다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { COMPAT_DATE, ROOT, wrangler } from './local-d1.js';

const { values } = parseArgs({ options: { id: { type: 'string' }, db: { type: 'string', default: 'login-db' } } });
if (!values.id || !/^[0-9a-f-]{36}$/i.test(values.id) || !/^[\w-]+$/.test(values.db)) {
  console.error('사용법: npm run db:migrate:remote -- --id <D1 database_id> [--db login-db]');
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-migrate-'));
const config = path.join(dir, 'wrangler.toml');
fs.writeFileSync(config, [
  'name = "login-migrate"',
  `compatibility_date = "${COMPAT_DATE}"`,
  '[[d1_databases]]',
  'binding = "DB"',
  `database_name = "${values.db}"`,
  `database_id = "${values.id}"`,
  `migrations_dir = "${path.join(ROOT, 'migrations')}"`,
  '',
].join('\n'));
try {
  wrangler(['d1', 'migrations', 'apply', values.db, '--remote', '-c', config], { stdio: 'inherit' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
