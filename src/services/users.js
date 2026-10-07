import { all, batch, get, isUniqueError, run, stmt } from '../lib/db.js';
import { nowIso, parseBirthDate } from '../lib/time.js';
import { auditStmt } from './audit.js';
import { autoAssignStmts, cancelUpcomingStmt } from './enrollments.js';

export function getUser(db, id) {
  return get(db, 'SELECT * FROM users WHERE id = ?', id);
}

export function findUserByPhone(db, phone) {
  return get(db, 'SELECT * FROM users WHERE phone = ?', phone);
}

/** 이름·주소·생년월일 입력 검증(최초 등록·내 정보 공통) */
export function parsePersonForm(body) {
  const str = (k) => String(Array.isArray(body[k]) ? body[k][0] ?? '' : body[k] ?? '').trim();
  const value = { name: str('name'), address: str('address'), birth_date_input: str('birth_date') };
  value.birth_date = parseBirthDate(value.birth_date_input);
  const errors = {};
  if (!value.name || value.name.length > 40) errors.name = '이름을 입력해 주세요.';
  if (!value.address || value.address.length > 200) errors.address = '주소를 입력해 주세요.';
  if (!value.birth_date) errors.birth_date = value.birth_date_input ? '생년월일을 확인해 주세요.' : '생년월일을 입력해 주세요.';
  return { value, errors };
}

/**
 * 최초 등록: 사용자·접수·동의 이력을 한 번에(원자적으로) 만든다.
 * 같은 번호로 이미 계정이 있으면 새로 만들지 않고 null을 돌려준다.
 */
export async function registerUser(db, { name, phone, address, birthDate, consent, agreedKeys }) {
  const now = nowIso();
  try {
    await batch(db, [
      stmt(db, `INSERT INTO users (name, phone, phone_verified_at, address, birth_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, name, phone, now, address, birthDate, now, now),
      stmt(db, `INSERT INTO registrations (user_id, registered_at, updated_at) SELECT id, ?, ? FROM users WHERE phone = ?`, now, now, phone),
      ...consent.items.map((item) => stmt(db, `INSERT INTO consents (user_id, purpose, agreed, doc_version, agreed_at)
        SELECT id, ?, ?, ?, ? FROM users WHERE phone = ?`, item.key, agreedKeys.includes(item.key) ? 1 : 0, consent.version, now, phone)),
    ]);
  } catch (err) {
    if (isUniqueError(err)) return null;
    throw err;
  }
  return (await findUserByPhone(db, phone)).id;
}

export async function updateProfile(db, userId, { name, address, birthDate }) {
  await run(db, 'UPDATE users SET name = ?, address = ?, birth_date = ?, updated_at = ? WHERE id = ?',
    name, address, birthDate, nowIso(), userId);
}

/**
 * 전화번호 변경(새 번호 인증 후 호출).
 * 꼬모 연결은 해제하고 재확인 대상으로 돌리며, 가져온 상담 현황도 지운다.
 * 현재 세션을 제외한 다른 로그인 세션은 모두 종료한다.
 */
export async function changePhone(db, userId, newPhone, keepTokenHash) {
  const now = nowIso();
  try {
    await batch(db, [
      stmt(db, 'UPDATE users SET phone = ?, phone_verified_at = ?, updated_at = ? WHERE id = ?', newPhone, now, now, userId),
      stmt(db, `UPDATE como_links SET status = 'needs_recheck', external_id = NULL, phone_at_link = NULL, candidates = NULL,
        detail = 'phone_changed', checked_at = ?, linked_at = NULL WHERE user_id = ?`, now, userId),
      stmt(db, 'DELETE FROM como_status WHERE user_id = ?', userId),
      stmt(db, 'DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', userId, keepTokenHash),
      auditStmt(db, userId, 'user.phone_change', 'user', userId),
    ]);
  } catch (err) {
    if (isUniqueError(err)) return false;
    throw err;
  }
  return true;
}

export function listConsents(db, userId) {
  return all(db, 'SELECT * FROM consents WHERE user_id = ? ORDER BY id', userId);
}

// ── 관리자 ─────────────────────────────────────────────

export const INTERNAL_STATUS = {
  received: '접수',
  reviewing: '검토',
  selected: '선정',
  not_selected: '미선정',
  released: '선정 해제',
};

export function listRegistrants(db, { status = '' } = {}) {
  const filter = status && INTERNAL_STATUS[status] ? status : null;
  return all(db, `SELECT u.*, r.registered_at, r.internal_status, l.status AS como_status
    FROM users u JOIN registrations r ON r.user_id = u.id LEFT JOIN como_links l ON l.user_id = u.id
    WHERE u.role = 'participant' AND (?1 IS NULL OR r.internal_status = ?1) ORDER BY r.registered_at DESC`, filter);
}

export function listSelectedParticipants(db) {
  return all(db, "SELECT * FROM users WHERE role = 'participant' AND is_selected = 1 ORDER BY name");
}

export function getRegistration(db, userId) {
  return get(db, 'SELECT * FROM registrations WHERE user_id = ?', userId);
}

export async function setInternalStatus(db, actorId, userId, status) {
  if (!INTERNAL_STATUS[status] || status === 'selected' || status === 'released') return false;
  const user = await getUser(db, userId);
  if (!user || user.role !== 'participant' || user.is_selected) return false;
  await batch(db, [
    stmt(db, 'UPDATE registrations SET internal_status = ?, updated_at = ? WHERE user_id = ?', status, nowIso(), userId),
    auditStmt(db, actorId, 'registration.status', 'user', userId, { status }),
  ]);
  return true;
}

/** 선정·해제. 선정 시 Link 전체 자동 배정, 해제 시 예정 배정 취소. 하나의 batch로 원자적으로 처리한다. */
export async function setSelected(db, actorId, userId, selected) {
  const user = await getUser(db, userId);
  if (!user || user.role !== 'participant') return null;
  const now = nowIso();
  if (selected) {
    const res = await batch(db, [
      stmt(db, 'UPDATE users SET is_selected = 1, selected_at = ?, updated_at = ? WHERE id = ?', now, now, userId),
      stmt(db, "UPDATE registrations SET internal_status = 'selected', updated_at = ? WHERE user_id = ?", now, userId),
      ...autoAssignStmts(db, { userId }),
      auditStmt(db, actorId, 'participant.select', 'user', userId),
    ]);
    return { created: res[2].meta.changes, restored: res[3].meta.changes };
  }
  const res = await batch(db, [
    stmt(db, 'UPDATE users SET is_selected = 0, updated_at = ? WHERE id = ?', now, userId),
    stmt(db, "UPDATE registrations SET internal_status = 'released', updated_at = ? WHERE user_id = ?", now, userId),
    cancelUpcomingStmt(db, userId),
    auditStmt(db, actorId, 'participant.release', 'user', userId),
  ]);
  return { cancelled: res[2].meta.changes };
}

