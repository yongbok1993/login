// 개발용 테스트 데이터(로컬 D1 전용). 원격(운영) DB에는 넣지 않는다.
// 이름·번호·일정은 모두 테스트 표시가 붙은 가짜 값이며 실제 운영 데이터가 아니다.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { get, run } from '../src/lib/db.js';
import { hashPin } from '../src/lib/pin.js';
import { hashPassword } from '../src/lib/password.js';
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

// 개발용 비밀번호·PIN(로컬 개발 기본 SESSION_SECRET 기준). 운영에는 쓰지 않는다.
export const DEV_PASSWORD = 'devuser2026';
export const DEV_PIN = '135792';
// 개발용 관리자 아이디·비밀번호(로컬 전용)
export const DEV_ADMIN = { loginId: 'admin', password: 'devpass2026' };

export async function seed(db) {
  const secret = loadConfig({ APP_ENV: 'development' }).sessionSecret;
  const pinHash = await hashPin(secret, DEV_PIN);
  const userHash = await hashPassword(secret, DEV_PASSWORD);
  if ((await get(db, 'SELECT COUNT(*) n FROM users')).n > 0) throw new Error('이미 사용자가 있습니다. 로컬 DB(.wrangler/state)를 지우고 다시 실행해 주세요.');
  const consent = { version: 'dev-draft', items: [{ key: 'privacy', title: '개인정보 수집·이용 동의', required: true }] };
  const now = nowIso();
  await run(db, `INSERT INTO users (name, phone, phone_verified_at, role, pin_hash, login_id, password_hash, password_updated_at, created_at, updated_at)
    VALUES ('테스트관리자', '01000000000', ?, 'manager', ?, ?, ?, ?, ?, ?)`, now, pinHash, DEV_ADMIN.loginId,
  await hashPassword(secret, DEV_ADMIN.password), now, now, now);
  const users = [];
  for (const i of [1, 2, 3, 4]) {
    users.push(await registerUser(db, { name: `테스트참여자${i}`, phone: `0100000000${i}`, passwordHash: userHash, consent, agreedKeys: ['privacy'] }));
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
  // Grow 희망 신청(선정 대기)과 공지
  const grow = await get(db, "SELECT s.id FROM program_sessions s JOIN programs p ON p.id = s.program_id WHERE p.code = 'grow-career' ORDER BY s.id LIMIT 1");
  await run(db, `INSERT INTO enrollments (user_id, session_id, source, status, selection, created_at) VALUES (?, ?, 'select', 'active', 'pending', ?)`,
    users[1], grow.id, now);
  // 개편 전 방식(PIN만) 참여자 1명: 로그인 후 새 비밀번호로 전환하는 흐름 확인용
  await run(db, `INSERT INTO users (name, phone, phone_verified_at, pin_hash, created_at, updated_at)
    VALUES ('테스트기존참여자', '01000000005', ?, ?, ?, ?)`, now, pinHash, now, now);
  await run(db, "INSERT INTO registrations (user_id, registered_at, updated_at) SELECT id, ?, ? FROM users WHERE phone = '01000000005'", now, now);
  // 게시판 예시(개발용)
  const admin = (await get(db, "SELECT id FROM users WHERE phone = '01000000000'")).id;
  await run(db, `INSERT INTO posts (board, title, body, author_id, is_pinned, visibility, created_at, updated_at) VALUES
    ('notice', '테스트 공지(중요)', '개발용 테스트 공지입니다.', ?1, 1, 'members', ?2, ?2),
    ('notice', '테스트 공지', '개발용 테스트 공지입니다.', ?1, 0, 'members', ?2, ?2),
    ('free', '테스트 자유글', '개발용 자유게시판 글입니다.', ?3, 0, 'members', ?2, ?2),
    ('qna', '테스트 공개 질문', '개발용 공개 질문입니다.', ?3, 0, 'members', ?2, ?2),
    ('qna', '테스트 비밀 질문', '개발용 담당자만 보기 질문입니다.', ?4, 0, 'private', ?2, ?2)`, admin, now, users[0], users[1]);
  await run(db, 'INSERT INTO post_comments (post_id, author_id, body, created_at, updated_at) SELECT id, ?, ?, ?, ? FROM posts WHERE board = \'free\' LIMIT 1',
    users[1], '개발용 댓글입니다.', now, now);
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
  console.log(`개발용 데이터 생성 완료. 관리자 ${DEV_ADMIN.loginId}/${DEV_ADMIN.password}, 참여자 01000000001~4 비밀번호 ${DEV_PASSWORD}`
    + ` (1~3 승인, 4 승인 대기), 01000000005는 기존 PIN ${DEV_PIN} 계정`);
}
