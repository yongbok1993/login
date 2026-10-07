// 개발용 테스트 데이터(로컬 D1 전용). 원격(운영) DB에는 넣지 않는다.
// 이름·번호·일정은 모두 테스트 표시가 붙은 가짜 값이며 실제 운영 데이터가 아니다.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { get, run } from '../src/lib/db.js';
import { hashPin } from '../src/lib/pin.js';
import { nowIso } from '../src/lib/time.js';
import { createSession, getProgramByCode } from '../src/services/programs.js';
import { registerUser, setSelected } from '../src/services/users.js';
import { applyLocalMigrations, openLocalDb, ROOT } from './local-d1.js';

export const MOCK_COMO = {
  accounts: [
    { externalId: 'mock-a1', phone: '01000000001', name: '테스트참여자1', completed: 3, total: 10, nextAt: null },
    { externalId: 'mock-c1', phone: '01000000003', completed: 1, total: 8 },
    { externalId: 'mock-c2', phone: '01000000003', completed: 0, total: null },
  ],
};

// 개발용 PIN(로컬 개발 기본 SESSION_SECRET 기준). 운영에는 쓰지 않는다.
export const DEV_PIN = '135792';

export async function seed(db) {
  const secret = loadConfig({ APP_ENV: 'development' }).sessionSecret;
  const pinHash = await hashPin(secret, DEV_PIN);
  if ((await get(db, 'SELECT COUNT(*) n FROM users')).n > 0) throw new Error('이미 사용자가 있습니다. 로컬 DB(.wrangler/state)를 지우고 다시 실행해 주세요.');
  const consent = { version: 'dev-draft', items: [{ key: 'privacy', title: '개인정보 수집·이용 동의', required: true }] };
  const now = nowIso();
  await run(db, `INSERT INTO users (name, phone, phone_verified_at, role, pin_hash, created_at, updated_at)
    VALUES ('테스트관리자', '01000000000', ?, 'manager', ?, ?, ?)`, now, pinHash, now, now);
  const users = [];
  for (const i of [1, 2, 3, 4]) {
    users.push(await registerUser(db, { name: `테스트참여자${i}`, phone: `0100000000${i}`, address: '테스트 주소', birthDate: '1970-01-01', pinHash, consent, agreedKeys: ['privacy'] }));
  }
  const sessions = [
    ['link-cooking', { round_no: 1, date: '2027-02-10', start_time: '10:00', end_time: '12:00', place: '테스트 장소' }],
    ['link-cooking', { round_no: 2 }],
    ['link-seasonal', { round_no: 1 }],
    ['grow-career', { round_no: 1, date: '2027-02-17', start_time: '14:00', end_time: '16:00', place: '테스트 장소', capacity: 2 }],
    ['grow-career', { round_no: 2 }],
    ['grow-communication', { round_no: 1, date: '2027-03-03', capacity: 10 }],
    ['open-meetup', { round_no: 1, date: '2027-02-24' }],
  ];
  for (const [code, s] of sessions) {
    const p = await getProgramByCode(db, code);
    await createSession(db, null, p.id, {
      date: null, start_time: null, end_time: null, place: null, capacity: null, is_closed: 0, is_cancelled: 0, ...s,
    });
  }
  for (const id of users.slice(0, 3)) await setSelected(db, null, id, true);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyLocalMigrations();
  const { db, dispose } = await openLocalDb();
  try {
    await seed(db);
  } finally {
    await dispose();
  }
  const devVars = path.join(ROOT, '.dev.vars');
  if (!fs.existsSync(devVars)) {
    fs.writeFileSync(devVars, `APP_ENV=development\nCOMO_ADAPTER=mock\nCOMO_MOCK_JSON='${JSON.stringify(MOCK_COMO)}'\n`);
    console.log('.dev.vars 생성(개발용 설정·꼬모 모의 데이터)');
  }
  console.log(`개발용 데이터 생성 완료. PIN ${DEV_PIN} — 관리자 01000000000, 참여자 01000000001~4 (4번은 미선정)`);
}
