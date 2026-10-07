// 개발용 테스트 데이터. 운영 환경에서는 실행되지 않는다.
// 이름·번호·일정은 모두 테스트 표시가 붙은 가짜 값이며 실제 운영 데이터가 아니다.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { nowIso } from '../src/lib/time.js';
import { createSession, getProgramByCode } from '../src/services/programs.js';
import { registerUser, setSelected } from '../src/services/users.js';

const cfg = loadConfig();
if (cfg.isProd) {
  console.error('운영 환경에서는 개발용 데이터를 넣을 수 없습니다.');
  process.exit(1);
}
const db = openDb(cfg.dbPath);
if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
  console.error('이미 사용자가 있습니다. 새 DB에서 실행해 주세요.');
  process.exit(1);
}
const consent = { version: 'dev-draft', items: [{ key: 'privacy', title: '개인정보 수집·이용 동의', required: true }] };
const now = nowIso();
db.prepare(`INSERT INTO users (name, phone, phone_verified_at, region, role, created_at, updated_at)
  VALUES ('테스트관리자', '01000000000', ?, '', 'manager', ?, ?)`).run(now, now, now);
const users = [1, 2, 3, 4].map((i) => registerUser(db, {
  name: `테스트참여자${i}`, phone: `0100000000${i}`, region: '테스트 지역', consent, agreedKeys: ['privacy'],
}));

const sessions = [
  ['link-cooking', { round_no: 1, date: '2027-02-10', start_time: '10:00', end_time: '12:00', place: '테스트 장소' }],
  ['link-cooking', { round_no: 2, date: null, start_time: null, end_time: null, place: null }],
  ['link-seasonal', { round_no: 1, date: null, start_time: null, end_time: null, place: null }],
  ['grow-career', { round_no: 1, date: '2027-02-17', start_time: '14:00', end_time: '16:00', place: '테스트 장소', capacity: 2 }],
  ['grow-career', { round_no: 2, date: null, start_time: null, end_time: null, place: null, capacity: null }],
  ['grow-communication', { round_no: 1, date: '2027-03-03', start_time: null, end_time: null, place: null, capacity: 10 }],
  ['open-meetup', { round_no: 1, date: '2027-02-24', start_time: null, end_time: null, place: null }],
];
for (const [code, s] of sessions) {
  const p = getProgramByCode(db, code);
  createSession(db, null, p.id, { capacity: null, is_closed: 0, is_cancelled: 0, ...s });
}
setSelected(db, null, users[0], true);
setSelected(db, null, users[1], true);
setSelected(db, null, users[2], true);

// 꼬모 모의 데이터: 참여자1은 1:1 매칭, 참여자3은 같은 번호에 계정 2개(충돌 확인용)
const mockFile = cfg.comoMockFile;
fs.mkdirSync(path.dirname(mockFile), { recursive: true });
fs.writeFileSync(mockFile, JSON.stringify({
  accounts: [
    { externalId: 'mock-a1', phone: '01000000001', name: '테스트참여자1', completed: 3, total: 10, nextAt: null },
    { externalId: 'mock-c1', phone: '01000000003', completed: 1, total: 8 },
    { externalId: 'mock-c2', phone: '01000000003', completed: 0, total: null },
  ],
}, null, 2));
console.log('개발용 데이터 생성 완료. 관리자 01000000000, 참여자 01000000001~4 (4번은 미선정)');
console.log(`꼬모 모의 데이터: ${mockFile} (COMO_ADAPTER=mock 으로 실행 시 사용)`);
