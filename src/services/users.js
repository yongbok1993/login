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
  const value = { name: str('name'), address: str('address'), address_detail: str('address_detail'), postcode: str('postcode'),
    birth_date_input: str('birth_date') };
  value.birth_date = parseBirthDate(value.birth_date_input);
  const errors = {};
  if (!value.name || value.name.length > 40) errors.name = '이름을 입력해 주세요.';
  if (!value.address || value.address.length > 200) errors.address = '주소를 입력해 주세요.';
  if (value.address_detail.length > 100) errors.address_detail = '상세 주소가 너무 깁니다.';
  if (value.postcode && !/^\d{5}$/.test(value.postcode)) value.postcode = '';
  value.postcode = value.postcode || null;
  if (!value.birth_date) errors.birth_date = value.birth_date_input ? '생년월일을 확인해 주세요.' : '생년월일을 입력해 주세요.';
  return { value, errors };
}

/**
 * 최초 등록: 사용자·접수·동의 이력을 한 번에(원자적으로) 만든다.
 * 같은 번호로 이미 계정이 있으면 새로 만들지 않고 null을 돌려준다.
 */
export async function registerUser(db, { name, phone, address, addressDetail = '', postcode = null, birthDate, pinHash, consent, agreedKeys }) {
  const now = nowIso();
  try {
    await batch(db, [
      stmt(db, `INSERT INTO users (name, phone, phone_verified_at, address, address_detail, postcode, birth_date, pin_hash,
        pin_updated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name, phone, now, address, addressDetail, postcode, birthDate, pinHash, now, now, now),
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

export async function updateProfile(db, userId, { name, address, addressDetail = '', postcode = null, birthDate }) {
  await run(db, 'UPDATE users SET name = ?, address = ?, address_detail = ?, postcode = ?, birth_date = ?, updated_at = ? WHERE id = ?',
    name, address, addressDetail, postcode, birthDate, nowIso(), userId);
}

/**
 * 전화번호 변경(현재 PIN 확인 후 호출).
 * 새 번호는 관리자가 다시 확인할 때까지 미확인 상태다. 꼬모 연결은 해제하고 재확인 대상으로 돌리며,
 * 가져온 상담 현황도 지운다. 현재 세션을 제외한 다른 로그인 세션은 모두 종료한다.
 */
export async function changePhone(db, userId, newPhone, keepTokenHash) {
  const now = nowIso();
  try {
    await batch(db, [
      stmt(db, 'UPDATE users SET phone = ?, phone_verified_at = ?, phone_confirmed_at = NULL, updated_at = ? WHERE id = ?',
        newPhone, now, now, userId),
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

/** 본인 PIN 변경. 다른 기기의 로그인은 종료한다. */
export async function setPin(db, userId, pinHash, keepTokenHash) {
  const now = nowIso();
  await batch(db, [
    stmt(db, 'UPDATE users SET pin_hash = ?, pin_must_change = 0, pin_updated_at = ?, updated_at = ? WHERE id = ?', pinHash, now, now, userId),
    stmt(db, 'DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', userId, keepTokenHash),
    auditStmt(db, userId, 'user.pin_change', 'user', userId),
  ]);
}

/** 관리자 PIN 초기화: 임시 PIN 저장, 첫 로그인 때 변경 요구, 모든 로그인 세션 종료 */
export async function resetPin(db, actorId, userId, pinHash) {
  const now = nowIso();
  await batch(db, [
    stmt(db, 'UPDATE users SET pin_hash = ?, pin_must_change = 1, pin_updated_at = ?, updated_at = ? WHERE id = ?', pinHash, now, now, userId),
    stmt(db, 'DELETE FROM auth_sessions WHERE user_id = ?', userId),
    auditStmt(db, actorId, 'user.pin_reset', 'user', userId),
  ]);
}

/** 관리자가 본인·연락처를 확인했음을 기록(꼬모 매핑 전제 조건) */
export async function confirmPhone(db, actorId, userId) {
  await batch(db, [
    stmt(db, 'UPDATE users SET phone_confirmed_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), userId),
    auditStmt(db, actorId, 'user.phone_confirm', 'user', userId),
  ]);
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
      // 선정은 초기상담 등 대면 확인 후 이뤄지므로 연락처 확인도 함께 기록한다.
      stmt(db, `UPDATE users SET is_selected = 1, selected_at = ?, phone_confirmed_at = COALESCE(phone_confirmed_at, ?),
        updated_at = ? WHERE id = ?`, now, now, now, userId),
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


// ── 관리자 권한 ─────────────────────────────────────────

export const ROLES = { participant: '참여자', staff: '운영 담당', manager: '전체 관리자' };

export async function hasManager(db) {
  return !!(await get(db, "SELECT 1 AS ok FROM users WHERE role = 'manager' LIMIT 1"));
}

/**
 * 권한 변경. 관리자로 지정하면 참여자 선정을 해제한다(참여자 기능과 관리자 기능을 한 계정에 섞지 않음).
 * 마지막 전체 관리자는 해제할 수 없다.
 */
export async function setRole(db, actorId, userId, role) {
  if (!ROLES[role]) return 'invalid';
  const user = await getUser(db, userId);
  if (!user) return 'not_found';
  if (user.role === role) return 'ok';
  if (user.role === 'manager') {
    const n = (await get(db, "SELECT COUNT(*) n FROM users WHERE role = 'manager'")).n;
    if (n <= 1) return 'last_manager';
  }
  await batch(db, [
    stmt(db, `UPDATE users SET role = ?, is_selected = CASE WHEN ? = 'participant' THEN is_selected ELSE 0 END, updated_at = ?
      WHERE id = ?`, role, role, nowIso(), userId),
    auditStmt(db, actorId, 'user.role', 'user', userId, { from: user.role, to: role }),
  ]);
  return 'ok';
}

export function listStaff(db) {
  return all(db, "SELECT * FROM users WHERE role IN ('staff', 'manager') ORDER BY role DESC, name");
}
