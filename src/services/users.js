import { all, batch, get, isUniqueError, run, stmt } from '../lib/db.js';
import { nowIso } from '../lib/time.js';
import { auditStmt } from './audit.js';
import { autoAssignStmts, cancelUpcomingStmt } from './enrollments.js';

export function getUser(db, id) {
  return get(db, 'SELECT * FROM users WHERE id = ?', id);
}

export function findUserByPhone(db, phone) {
  return get(db, 'SELECT * FROM users WHERE phone = ?', phone);
}

/** 신청서 이름 검증(신청·내 신청정보 수정 공통) */
export function parseName(body) {
  const name = String(Array.isArray(body.name) ? body.name[0] ?? '' : body.name ?? '').trim().replace(/\s+/g, ' ');
  return { name, error: !name ? '이름을 입력해 주세요.' : name.length > 40 ? '이름은 40자 이하로 입력해 주세요.' : null };
}

/**
 * 참여 신청: 계정·접수·동의 이력을 한 번에(원자적으로) 만든다.
 * 최초 신청 시각(registered_at)은 서버 DB 시각으로 접수 저장 시점에 기록하고 이후 바꾸지 않는다.
 * D1은 쓰기를 순서대로 처리하므로 접수번호(registrations.id)와 신청 시각의 순서가 일치한다.
 * 같은 번호로 이미 계정이 있으면(중복 제출 포함) 새로 만들지 않고 null을 돌려준다.
 */
export async function registerUser(db, { name, phone, passwordHash, consent, agreedKeys }) {
  const now = nowIso();
  try {
    await batch(db, [
      stmt(db, `INSERT INTO users (name, phone, phone_verified_at, password_hash, password_updated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, name, phone, now, passwordHash, now, now, now),
      stmt(db, `INSERT INTO registrations (user_id, registered_at, updated_at)
        SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM users WHERE phone = ?`, phone),
      ...consent.items.map((item) => stmt(db, `INSERT INTO consents (user_id, purpose, agreed, doc_version, agreed_at)
        SELECT id, ?, ?, ?, ? FROM users WHERE phone = ?`, item.key, agreedKeys.includes(item.key) ? 1 : 0, consent.version, now, phone)),
    ]);
  } catch (err) {
    if (isUniqueError(err)) return null;
    throw err;
  }
  return (await findUserByPhone(db, phone)).id;
}

/** 이름 수정. 최초 신청 시각·전화번호는 바꾸지 않는다. */
export async function updateName(db, userId, name) {
  await batch(db, [
    stmt(db, 'UPDATE users SET name = ?, updated_at = ? WHERE id = ?', name, nowIso(), userId),
    auditStmt(db, userId, 'user.name_change', 'user', userId),
  ]);
}

/** 본인 신청정보(신청 시각·접수번호·상태) */
export function getApplication(db, userId) {
  return get(db, `SELECT u.id, u.name, u.phone, u.role, u.is_selected, u.account_status, r.id AS receipt_no, r.registered_at,
      r.internal_status FROM users u LEFT JOIN registrations r ON r.user_id = u.id WHERE u.id = ?`, userId);
}

// ── 이용 상태 ──
// 비로그인 방문자 / 승인 대기 신청자 / 승인된 참여자 / 관리자 / 승인 해제·이용 중지

export const PARTICIPANT_CAP = 10;

export const APPLICATION_STATUS = {
  pending: '승인 대기',
  reviewing: '검토 중',
  approved: '승인',
  not_selected: '미승인',
  released: '승인 해제',
  suspended: '이용 중지',
};

/** 화면에 보여 줄 신청 상태 키 */
export function applicationStatus(user, internalStatus) {
  if (user.account_status === 'suspended') return 'suspended';
  if (user.is_selected) return 'approved';
  if (internalStatus === 'released') return 'released';
  if (internalStatus === 'not_selected') return 'not_selected';
  if (internalStatus === 'reviewing') return 'reviewing';
  return 'pending';
}

/** 승인된(이용 중인) 참여자 */
export function isApprovedParticipant(user) {
  return !!user && user.role === 'participant' && !!user.is_selected && user.account_status === 'active';
}

/** 내부 서비스(프로그램 안내·게시판 등) 이용 가능: 승인된 참여자와 관리자 */
export function canUseInternal(user) {
  return isApprovedParticipant(user) || isAdminRole(user);
}

export function approvedCount(db) {
  return get(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'participant' AND is_selected = 1 AND account_status = 'active'")
    .then((r) => r.n);
}

export function isCapError(err) {
  return /participant_cap/.test(String(err && err.message));
}

/** 이용 중지·재개. 재개할 때 승인 상태면 10명 제한을 다시 확인한다(DB 트리거). */
export async function setAccountStatus(db, actorId, userId, status) {
  if (!['active', 'suspended'].includes(status)) return 'invalid';
  const user = await getUser(db, userId);
  if (!user || user.role !== 'participant') return 'not_found';
  try {
    await batch(db, [
      stmt(db, 'UPDATE users SET account_status = ?, updated_at = ? WHERE id = ?', status, nowIso(), userId),
      auditStmt(db, actorId, status === 'suspended' ? 'participant.suspend' : 'participant.resume', 'user', userId),
    ]);
  } catch (err) {
    if (isCapError(err)) return 'cap';
    throw err;
  }
  return 'ok';
}

/**
 * 전화번호(로그인 아이디) 변경. 본인(현재 비밀번호 재확인 후) 또는 담당자가 바꾼다.
 * 계정 ID·비밀번호·승인 상태·신청기록(최초 신청 시각·접수번호)·게시물은 그대로 두고 번호만 바꾼다(새 신청을 만들지 않음).
 * 담당자가 본인 확인 후 바꾸면 연락처 확인으로 기록하고, 본인이 바꾸면 미확인으로 돌린다(문자 인증이 없으므로).
 * 꼬모 연결은 재확인 대상으로 돌리고 가져온 상담 현황을 지운다. 다른 로그인 세션은 종료한다(keepTokenHash 제외).
 * 변경 전·후 번호는 담당자용 변경 기록(audit_log)에 남긴다. 같은 번호가 이미 있으면 false.
 */
export async function changePhone(db, actorId, userId, newPhone, { keepTokenHash = '', confirmed = false } = {}) {
  const now = nowIso();
  const user = await getUser(db, userId);
  if (!user) return false;
  try {
    await batch(db, [
      stmt(db, 'UPDATE users SET phone = ?, phone_verified_at = ?, phone_confirmed_at = ?, updated_at = ? WHERE id = ?',
        newPhone, now, confirmed ? now : null, now, userId),
      stmt(db, `UPDATE como_links SET status = 'needs_recheck', external_id = NULL, phone_at_link = NULL, candidates = NULL,
        detail = 'phone_changed', checked_at = ?, linked_at = NULL WHERE user_id = ?`, now, userId),
      stmt(db, 'DELETE FROM como_status WHERE user_id = ?', userId),
      stmt(db, 'DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', userId, keepTokenHash || ''),
      auditStmt(db, actorId, 'user.phone_change', 'user', userId, { from: user.phone, to: newPhone, by: actorId === userId ? 'self' : 'staff' }),
    ]);
  } catch (err) {
    if (isUniqueError(err)) return false;
    throw err;
  }
  return true;
}

/**
 * 본인 비밀번호 설정·변경. 기존 PIN은 더 이상 쓰지 않으므로 지운다. 다른 기기의 로그인은 종료한다.
 */
export async function setPassword(db, userId, passwordHash, keepTokenHash) {
  const now = nowIso();
  await batch(db, [
    stmt(db, `UPDATE users SET password_hash = ?, password_must_change = 0, password_updated_at = ?, pin_hash = NULL, pin_must_change = 0,
      updated_at = ? WHERE id = ?`, passwordHash, now, now, userId),
    stmt(db, 'DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', userId, keepTokenHash || ''),
    auditStmt(db, userId, 'user.password_set', 'user', userId),
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
  received: '승인 대기',
  reviewing: '검토 중',
  selected: '승인',
  not_selected: '미승인',
  released: '승인 해제',
};

/** 신청자 목록: 최초 신청 시각 오름차순, 같은 시각은 접수번호 순. 접수순서(order_no)를 함께 돌려준다. */
export function listRegistrants(db, { status = '' } = {}) {
  const filter = status && INTERNAL_STATUS[status] ? status : null;
  return all(db, `SELECT * FROM (
      SELECT u.*, r.id AS receipt_no, r.registered_at, r.internal_status, l.status AS como_status,
        ROW_NUMBER() OVER (ORDER BY r.registered_at, r.id) AS order_no
      FROM users u JOIN registrations r ON r.user_id = u.id LEFT JOIN como_links l ON l.user_id = u.id
      WHERE u.role = 'participant')
    WHERE (?1 IS NULL OR internal_status = ?1) ORDER BY registered_at, receipt_no`, filter);
}

export function listSelectedParticipants(db) {
  return all(db, "SELECT * FROM users WHERE role = 'participant' AND is_selected = 1 AND account_status = 'active' ORDER BY name");
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

/** 승인·승인 해제. 승인 시 O 관계망 형성(전체 참여) 프로그램 회차 자동 배정, 해제 시 예정 배정 취소. 하나의 batch로 원자적으로 처리한다. */
export async function setSelected(db, actorId, userId, selected) {
  const user = await getUser(db, userId);
  if (!user || user.role !== 'participant') return null;
  const now = nowIso();
  if (selected) {
    if (user.is_selected) return { created: 0, restored: 0 };
    let res;
    try {
      res = await batch(db, [
        // 승인은 담당자 확인 후 이뤄지므로 연락처 확인도 함께 기록한다.
        stmt(db, `UPDATE users SET is_selected = 1, selected_at = ?, phone_confirmed_at = COALESCE(phone_confirmed_at, ?),
          updated_at = ? WHERE id = ?`, now, now, now, userId),
        stmt(db, "UPDATE registrations SET internal_status = 'selected', updated_at = ? WHERE user_id = ?", now, userId),
        ...autoAssignStmts(db, { userId }),
        auditStmt(db, actorId, 'participant.select', 'user', userId),
      ]);
    } catch (err) {
      // 승인 인원 10명 초과: DB 트리거가 거부하고 batch 전체가 되돌려진다.
      if (isCapError(err)) return { cap: true };
      throw err;
    }
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
 * 첫 전체 관리자 지정(전체 관리자가 없을 때만). 번호가 이미 등록돼 있으면 그 계정을 관리자로 바꾸고 비밀번호를 새로 정한다.
 * 조건 확인과 저장을 한 batch로 처리해 동시에 두 명이 지정되지 않게 한다. 성공하면 사용자 id, 아니면 null.
 */
export async function claimFirstManager(db, { name, phone, passwordHash }) {
  const now = nowIso();
  await batch(db, [
    stmt(db, `INSERT INTO users (name, phone, phone_verified_at, role, password_hash, password_updated_at, created_at, updated_at)
      SELECT ?, ?, ?, 'manager', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'manager')
      ON CONFLICT(phone) DO UPDATE SET role = 'manager', is_selected = 0, password_hash = excluded.password_hash, password_must_change = 0,
        password_updated_at = excluded.password_updated_at, pin_hash = NULL, pin_must_change = 0, updated_at = excluded.updated_at`,
    name, phone, now, passwordHash, now, now, now),
    stmt(db, "DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE phone = ? AND role = 'manager' AND password_hash = ?)",
      phone, passwordHash),
    stmt(db, `INSERT INTO audit_log (actor_id, action, target_type, target_id, created_at)
      SELECT id, 'user.setup_manager', 'user', id, ? FROM users WHERE phone = ? AND role = 'manager' AND password_hash = ?`, now, phone, passwordHash),
    // 관리자가 생기면 1회용 설정 코드는 폐기
    stmt(db, "DELETE FROM app_settings WHERE key = 'setup_code_hash' AND EXISTS (SELECT 1 FROM users WHERE role = 'manager')"),
  ]);
  const user = await get(db, "SELECT id FROM users WHERE phone = ? AND role = 'manager' AND password_hash = ?", phone, passwordHash);
  return user ? user.id : null;
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

// ── 관리자 아이디·비밀번호 ──

export function isAdminRole(user) {
  return !!user && (user.role === 'staff' || user.role === 'manager');
}

export function findAdminByLoginId(db, loginId) {
  return get(db, "SELECT * FROM users WHERE login_id = ? AND role IN ('staff', 'manager')", loginId);
}

/** 본인 아이디·비밀번호 설정. 아이디가 이미 쓰이면 false. 다른 로그인 세션은 종료한다. */
export async function setAdminCredentials(db, userId, { loginId, passwordHash }, keepTokenHash) {
  const now = nowIso();
  try {
    await batch(db, [
      stmt(db, `UPDATE users SET login_id = ?, password_hash = ?, password_must_change = 0, password_updated_at = ?, updated_at = ?
        WHERE id = ?`, loginId, passwordHash, now, now, userId),
      stmt(db, 'DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', userId, keepTokenHash),
      auditStmt(db, userId, 'user.password_set', 'user', userId),
    ]);
  } catch (err) {
    if (isUniqueError(err)) return false;
    throw err;
  }
  return true;
}
