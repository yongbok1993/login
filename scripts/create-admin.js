// 관리자 지정: 사이트에서 참여 등록(휴대전화 번호 + PIN)을 먼저 한 뒤, 그 계정을 관리자로 바꾼다.
// 사용법:
//   npm run admin:create -- --phone 010XXXXXXXX [--role manager|staff]          SQL만 출력(대시보드 D1 콘솔에 붙여넣기)
//   npm run admin:create -- --phone 010XXXXXXXX --local                          로컬 개발 DB에 실행
// 관리자 계정에는 참여 등록 접수 기록이 필요 없으므로 지운다(동의 이력은 남긴다).
import { parseArgs } from 'node:util';
import { normalizePhone } from '../src/lib/phone.js';
import { applyLocalMigrations, LOCAL_DB_NAME, wrangler, writeLocalConfig } from './local-d1.js';

const { values } = parseArgs({ options: {
  phone: { type: 'string' }, role: { type: 'string', default: 'manager' }, local: { type: 'boolean' },
} });
const phone = normalizePhone(values.phone || '');
if (!phone || !['manager', 'staff'].includes(values.role)) {
  console.error('사용법: npm run admin:create -- --phone 010XXXXXXXX [--role manager|staff] [--local]');
  process.exit(1);
}
const sql = [
  `UPDATE users SET role = '${values.role}', is_selected = 0 WHERE phone = '${phone}';`,
  `DELETE FROM registrations WHERE user_id = (SELECT id FROM users WHERE phone = '${phone}');`,
  `SELECT id, name, phone, role FROM users WHERE phone = '${phone}';`,
].join('\n');

console.log(sql);
if (values.local) {
  applyLocalMigrations();
  wrangler(['d1', 'execute', LOCAL_DB_NAME, '--local', '-c', writeLocalConfig(), '--persist-to', '.wrangler/state', '--command', sql],
    { stdio: 'inherit' });
}
