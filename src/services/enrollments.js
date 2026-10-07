import { all, batch, get, run, stmt } from '../lib/db.js';
import { nowIso, todaySeoul } from '../lib/time.js';
import { audit, auditStmt } from './audit.js';

/** 참여 인원으로 세는 배정: 활성이고, 선택 신청이면 관리자가 선정한 건만 */
export const counted = (a) => `${a}.status = 'active' AND COALESCE(${a}.selection, 'selected') = 'selected'`;

export const SELECTION = { pending: '선정 대기', selected: '선정', not_selected: '미선정' };

export class EnrollError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const LINK_PAIRS = `u.is_selected = 1 AND u.role = 'participant' AND p.assign_mode = 'auto' AND s.is_cancelled = 0
  AND (?2 IS NULL OR u.id = ?2) AND (?3 IS NULL OR s.id = ?3)`;

/**
 * Link 자동 배정 문장(batch용): 선정된 참여자 × Link(auto) 프로그램의 모든 회차.
 * UNIQUE(user_id, session_id)로 재실행해도 중복이 생기지 않는다.
 * 선정 해제로 취소된 배정만 다시 활성화하고, 관리자가 개별 취소한 배정은 되살리지 않는다.
 * 자동 배정은 출석 처리가 아니다.
 */
export function autoAssignStmts(db, { userId = null, sessionId = null } = {}) {
  return [
    stmt(db, `INSERT INTO enrollments (user_id, session_id, source, status, created_at)
      SELECT u.id, s.id, 'auto', 'active', ?1 FROM users u CROSS JOIN program_sessions s JOIN programs p ON p.id = s.program_id
      WHERE ${LINK_PAIRS}
      ON CONFLICT(user_id, session_id) DO NOTHING`, nowIso(), userId, sessionId),
    stmt(db, `UPDATE enrollments SET status = 'active', cancel_reason = NULL, cancelled_at = NULL
      WHERE status = 'cancelled' AND cancel_reason = 'deselected' AND id IN (
        SELECT e.id FROM enrollments e JOIN users u ON u.id = e.user_id JOIN program_sessions s ON s.id = e.session_id
        JOIN programs p ON p.id = s.program_id WHERE ?1 IS NOT NULL AND ${LINK_PAIRS})`, 1, userId, sessionId),
  ];
}

export async function autoAssignLink(db, opts = {}) {
  const [ins, re] = await batch(db, autoAssignStmts(db, opts));
  return { created: ins.meta.changes, restored: re.meta.changes };
}

/** 선정 해제 시(batch용): 아직 출석 기록이 없는 예정 배정을 취소한다. 지난 기록은 보존한다. */
export function cancelUpcomingStmt(db, userId) {
  return stmt(db, `UPDATE enrollments SET status = 'cancelled', cancel_reason = 'deselected', cancelled_at = ?
    WHERE user_id = ? AND status = 'active'
      AND id NOT IN (SELECT enrollment_id FROM attendance)
      AND session_id IN (SELECT id FROM program_sessions WHERE date IS NULL OR date >= ?)`, nowIso(), userId, todaySeoul());
}

/** Grow 회차 신청 가능 여부(확인 화면·실패 사유용). 사유 코드 또는 null */
export async function growApplyBlocker(db, user, sessionId) {
  const s = await get(db, `SELECT s.*, p.assign_mode,
      (SELECT COUNT(*) FROM enrollments e WHERE e.session_id = s.id AND ${counted('e')}) AS active_count
    FROM program_sessions s JOIN programs p ON p.id = s.program_id WHERE s.id = ?`, sessionId);
  if (!s || s.assign_mode !== 'select') return 'not_found';
  if (!user.is_selected || user.role !== 'participant') return 'forbidden';
  if (s.is_cancelled) return 'cancelled';
  if (s.is_closed) return 'closed';
  if (s.date && s.date < todaySeoul()) return 'past';
  const mine = await get(db, 'SELECT status FROM enrollments WHERE user_id = ? AND session_id = ?', user.id, sessionId);
  if (mine && mine.status === 'active') return 'duplicate';
  if (s.capacity !== null && s.active_count >= s.capacity) return 'full';
  return null;
}

/**
 * Grow 희망 신청. 로그인된 사용자 정보만 사용하며 개인정보를 다시 받지 않는다.
 * 신청은 '선정 대기'로 저장되고, 관리자가 선정해야 일정에 들어간다.
 * 선정 여부·마감·정원(선정 인원 기준)·중복 확인과 저장을 하나의 SQL 문으로 처리한다.
 */
export async function applyGrow(db, user, sessionId) {
  const meta = await run(db, `INSERT INTO enrollments (user_id, session_id, source, status, selection, created_at)
    SELECT ?1, s.id, 'select', 'active', 'pending', ?2 FROM program_sessions s JOIN programs p ON p.id = s.program_id
    WHERE s.id = ?3 AND p.assign_mode = 'select' AND s.is_cancelled = 0 AND s.is_closed = 0
      AND (s.date IS NULL OR s.date >= ?4)
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = ?1 AND u.is_selected = 1 AND u.role = 'participant')
      AND (s.capacity IS NULL OR (SELECT COUNT(*) FROM enrollments e WHERE e.session_id = s.id AND ${counted('e')}) < s.capacity)
    ON CONFLICT(user_id, session_id) DO UPDATE SET status = 'active', source = 'select', selection = 'pending', decided_at = NULL,
      cancel_reason = NULL, cancelled_at = NULL, created_at = excluded.created_at
    WHERE enrollments.status = 'cancelled'`, user.id, nowIso(), sessionId, todaySeoul());
  if (meta.changes !== 1) throw new EnrollError((await growApplyBlocker(db, user, sessionId)) || 'unavailable');
}

/**
 * 참여자 본인 취소: 선정 대기 중인 희망 신청은 언제든 취소할 수 있다.
 * 선정된 건은 프로그램 설정(self_cancel)이 켜져 있고 아직 지나지 않았으며 출석 기록이 없을 때만.
 */
export async function cancelOwnGrow(db, user, enrollmentId) {
  const e = await get(db, `SELECT e.*, s.date, p.assign_mode, p.self_cancel FROM enrollments e
    JOIN program_sessions s ON s.id = e.session_id JOIN programs p ON p.id = s.program_id
    WHERE e.id = ? AND e.user_id = ?`, enrollmentId, user.id);
  if (!e || e.assign_mode !== 'select' || e.status !== 'active' || e.selection === 'not_selected') throw new EnrollError('not_found');
  if (e.selection !== 'pending') {
    if (!e.self_cancel) throw new EnrollError('forbidden');
    if (e.date && e.date < todaySeoul()) throw new EnrollError('past');
  }
  const meta = await run(db, `UPDATE enrollments SET status = 'cancelled', cancel_reason = 'self', cancelled_at = ?
    WHERE id = ? AND user_id = ? AND status = 'active' AND id NOT IN (SELECT enrollment_id FROM attendance)`,
  nowIso(), e.id, user.id);
  if (meta.changes !== 1) throw new EnrollError('forbidden');
}

/**
 * 관리자 Grow 선정: selected(선정) | not_selected(미선정) | pending(대기로 되돌림).
 * 선정은 정원(선정 인원 기준) 안에서만 되도록 조건부 UPDATE로 처리한다. 출석 기록이 있으면 바꾸지 않는다.
 */
export async function setGrowSelection(db, actorId, enrollmentId, decision) {
  if (!SELECTION[decision]) throw new EnrollError('invalid');
  const e = await get(db, `SELECT e.*, p.assign_mode FROM enrollments e JOIN program_sessions s ON s.id = e.session_id
    JOIN programs p ON p.id = s.program_id WHERE e.id = ?`, enrollmentId);
  if (!e || e.assign_mode !== 'select' || e.status !== 'active') throw new EnrollError('not_found');
  if (e.selection === decision) return;
  const withinCapacity = decision !== 'selected' ? '' : `AND (
      (SELECT capacity FROM program_sessions WHERE id = enrollments.session_id) IS NULL
      OR (SELECT COUNT(*) FROM enrollments x WHERE x.session_id = enrollments.session_id AND ${counted('x')})
         < (SELECT capacity FROM program_sessions WHERE id = enrollments.session_id))`;
  const [res] = await batch(db, [
    stmt(db, `UPDATE enrollments SET selection = ?, decided_at = ?
      WHERE id = ? AND status = 'active' AND id NOT IN (SELECT enrollment_id FROM attendance) ${withinCapacity}`,
    decision, decision === 'pending' ? null : nowIso(), enrollmentId),
    auditStmt(db, actorId, 'grow.selection', 'enrollment', enrollmentId, { decision }),
  ]);
  if (res.meta.changes !== 1) throw new EnrollError(decision === 'selected' ? 'full' : 'forbidden');
}

/** 관리자 Grow 선정 화면: 희망 신청 목록(선정 대기 우선) */
export function growApplications(db, { status = 'pending' } = {}) {
  return all(db, `SELECT e.id, e.selection, e.created_at, e.decided_at, u.id AS user_id, u.name, u.phone,
      s.id AS session_id, s.round_no, s.date, s.start_time, s.end_time, s.capacity, p.name AS program_name,
      (SELECT COUNT(*) FROM enrollments x WHERE x.session_id = s.id AND ${counted('x')}) AS selected_count
    FROM enrollments e JOIN users u ON u.id = e.user_id JOIN program_sessions s ON s.id = e.session_id
    JOIN programs p ON p.id = s.program_id
    WHERE p.assign_mode = 'select' AND e.status = 'active' AND (?1 = 'all' OR e.selection = ?1)
    ORDER BY p.sort_order, s.date IS NULL, s.date, s.round_no, e.created_at`, status);
}

/** 관리자 배정(O 마음·캠페인 등 manual 프로그램). 선정된 참여자만 배정된다. */
export async function assignManual(db, actorId, sessionId, userIds) {
  const s = await get(db, `SELECT p.assign_mode FROM program_sessions s JOIN programs p ON p.id = s.program_id WHERE s.id = ?`, sessionId);
  if (!s || s.assign_mode !== 'manual') throw new EnrollError('not_found');
  const [res] = await batch(db, [
    stmt(db, `INSERT INTO enrollments (user_id, session_id, source, status, created_at)
      SELECT u.id, ?1, 'manual', 'active', ?2 FROM users u
      WHERE u.id IN (SELECT value FROM json_each(?3)) AND u.is_selected = 1 AND u.role = 'participant'
      ON CONFLICT(user_id, session_id) DO UPDATE SET status = 'active', cancel_reason = NULL, cancelled_at = NULL
      WHERE enrollments.status = 'cancelled'`, sessionId, nowIso(), JSON.stringify(userIds)),
    auditStmt(db, actorId, 'enrollment.assign', 'session', sessionId, { userIds }),
  ]);
  return res.meta.changes;
}

export async function adminCancelEnrollment(db, actorId, enrollmentId) {
  const meta = await run(db, `UPDATE enrollments SET status = 'cancelled', cancel_reason = 'admin', cancelled_at = ?
    WHERE id = ? AND status = 'active' AND id NOT IN (SELECT enrollment_id FROM attendance)`, nowIso(), enrollmentId);
  if (meta.changes) await audit(db, actorId, 'enrollment.cancel', 'enrollment', enrollmentId);
  return meta.changes;
}

/** 출석 기록: attended | absent | '' (기록 삭제) */
export async function recordAttendance(db, actorId, enrollmentId, status) {
  const e = await get(db, 'SELECT id, status, selection FROM enrollments WHERE id = ?', enrollmentId);
  // 선정되지 않은 희망 신청에는 출석을 기록하지 않는다.
  if (!e || e.status !== 'active' || (e.selection && e.selection !== 'selected')) throw new EnrollError('not_found');
  let write;
  if (status === '') {
    write = stmt(db, 'DELETE FROM attendance WHERE enrollment_id = ?', enrollmentId);
  } else if (status === 'attended' || status === 'absent') {
    write = stmt(db, `INSERT INTO attendance (enrollment_id, status, recorded_by, recorded_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(enrollment_id) DO UPDATE SET status = excluded.status, recorded_by = excluded.recorded_by,
      recorded_at = excluded.recorded_at`, enrollmentId, status, actorId, nowIso());
  } else {
    throw new EnrollError('invalid');
  }
  await batch(db, [write, auditStmt(db, actorId, 'attendance.record', 'enrollment', enrollmentId, { status: status || null })]);
}

export function enrollmentsOf(db, userId) {
  return all(db, `SELECT e.*, s.round_no, s.date, s.start_time, s.end_time, p.name AS program_name, a.status AS attendance
    FROM enrollments e JOIN program_sessions s ON s.id = e.session_id JOIN programs p ON p.id = s.program_id
    LEFT JOIN attendance a ON a.enrollment_id = e.id WHERE e.user_id = ?
    ORDER BY s.date IS NULL, s.date`, userId);
}
