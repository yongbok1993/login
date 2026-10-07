// 관리자 계정 생성·권한 변경
// 사용법:
//   npm run admin:create -- --phone 010XXXXXXXX --name 이름 [--role manager|staff] --remote [--db login-db]
//   npm run admin:create -- --phone 010XXXXXXXX --name 이름 --local
// 전화번호는 운영자가 직접 확인한 번호를 입력한다. 로그인은 해당 번호의 인증번호로 한다.
// 원격 실행에는 wrangler 로그인(npx wrangler login)이 필요하다. 출력되는 SQL을 대시보드 D1 콘솔에서 실행해도 된다.
import { parseArgs } from 'node:util';
import { normalizePhone } from '../src/lib/phone.js';
import { applyLocalMigrations, LOCAL_DB_NAME, wrangler, writeLocalConfig } from './local-d1.js';

const { values } = parseArgs({ options: {
  phone: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'manager' },
  remote: { type: 'boolean' }, local: { type: 'boolean' }, db: { type: 'string', default: 'login-db' },
} });
const phone = normalizePhone(values.phone || '');
const name = (values.name || '').trim();
if (!phone || !name || name.length > 40 || !['manager', 'staff'].includes(values.role) || values.remote === values.local) {
  console.error('사용법: npm run admin:create -- --phone 010XXXXXXXX --name 이름 [--role manager|staff] (--remote | --local)');
  process.exit(1);
}
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
// 참여자로 등록된 번호는 관리자로 바꾸지 않는다(WHERE role != 'participant').
const sql = `INSERT INTO users (name, phone, phone_verified_at, region, role, created_at, updated_at)
VALUES (${q(name)}, ${q(phone)}, ${now}, '', ${q(values.role)}, ${now}, ${now})
ON CONFLICT(phone) DO UPDATE SET name = excluded.name, role = excluded.role, updated_at = excluded.updated_at
WHERE users.role != 'participant';`.replace(/\n/g, ' ');

console.log(sql);
if (values.local) {
  applyLocalMigrations();
  wrangler(['d1', 'execute', LOCAL_DB_NAME, '--local', '-c', writeLocalConfig(), '--persist-to', '.wrangler/state', '--command', sql], { stdio: 'inherit' });
} else {
  wrangler(['d1', 'execute', values.db, '--remote', '--command', sql], { stdio: 'inherit' });
}
