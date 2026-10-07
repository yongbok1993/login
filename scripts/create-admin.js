// 관리자 계정 생성·권한 변경
// 사용법: npm run admin:create -- --phone 010XXXXXXXX --name 이름 [--role manager|staff]
// 전화번호는 운영자가 직접 확인한 번호를 입력한다. 로그인은 해당 번호의 인증번호로 한다.
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { normalizePhone } from '../src/lib/phone.js';
import { nowIso } from '../src/lib/time.js';
import { audit } from '../src/services/audit.js';

const { values } = parseArgs({ options: { phone: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'manager' } } });
const phone = normalizePhone(values.phone || '');
if (!phone || !values.name || !['manager', 'staff'].includes(values.role)) {
  console.error('사용법: npm run admin:create -- --phone 010XXXXXXXX --name 이름 [--role manager|staff]');
  process.exit(1);
}
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const now = nowIso();
const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
if (existing) {
  if (existing.role === 'participant') {
    console.error('참여자로 등록된 번호입니다. 관리자 계정은 별도 번호를 사용해 주세요.');
    process.exit(1);
  }
  db.prepare('UPDATE users SET role = ?, name = ?, updated_at = ? WHERE id = ?').run(values.role, values.name, now, existing.id);
  audit(db, null, 'admin.role', 'user', existing.id, { role: values.role, via: 'cli' });
  console.log(`권한 변경: ${values.name} (${values.role})`);
} else {
  const id = db.prepare(`INSERT INTO users (name, phone, phone_verified_at, region, role, created_at, updated_at)
    VALUES (?, ?, ?, '', ?, ?, ?)`).run(values.name, phone, now, values.role, now, now).lastInsertRowid;
  audit(db, null, 'admin.create', 'user', Number(id), { role: values.role, via: 'cli' });
  console.log(`관리자 생성: ${values.name} (${values.role})`);
}
