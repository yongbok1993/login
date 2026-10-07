import { immediate } from '../db/index.js';
import { nowIso, todaySeoul } from '../lib/time.js';
import { audit } from './audit.js';

export class EnrollError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Link 자동 배정: 선정된 참여자 × Link(auto) 프로그램의 모든 회차.
 * UNIQUE(user_id, session_id)로 재실행해도 중복이 생기지 않는다.
 * 선정 해제로 취소된 배정만 다시 활성화하고, 관리자가 개별 취소한 배정은 되살리지 않는다.
 * 자동 배정은 출석 처리가 아니다.
 */
export function autoAssignLink(db, { userId = null, sessionId = null } = {}) {
  const now = nowIso();
  const where = ['u.is_selected = 1', "u.role = 'participant'", "p.assign_mode = 'auto'", 's.is_cancelled = 0'];
  const params = [];
  if (userId) { where.push('u.id = ?'); params.push(userId); }
  if (sessionId) { where.push('s.id = ?'); params.push(sessionId); }
  const pairs = db.prepare(`SELECT u.id AS user_id, s.id AS session_id FROM users u
    CROSS JOIN program_sessions s JOIN programs p ON p.id = s.program_id
    WHERE ${where.join(' AND ')}`).all(...params);
  const insert = db.prepare(`INSERT INTO enrollments (user_id, session_id, source, status, created_at)
    VALUES (?, ?, 'auto', 'active', ?) ON CONFLICT(user_id, session_id) DO NOTHING`);
  const reactivate = db.prepare(`UPDATE enrollments SET status = 'active', cancel_reason = NULL, cancelled_at = NULL
    WHERE user_id = ? AND session_id = ? AND status = 'cancelled' AND cancel_reason = 'deselected'`);
  let created = 0;
  let restored = 0;
  db.transaction(() => {
    for (const { user_id, session_id } of pairs) {
      created += insert.run(user_id, session_id, now).changes;
      restored += reactivate.run(user_id, session_id).changes;
    }
  })();
  return { created, restored };
}

/** 선정 해제 시: 아직 출석 기록이 없는 예정 배정을 취소한다. 지난 기록은 보존한다. */
export function cancelUpcomingOnDeselect(db, userId) {
  const today = todaySeoul();
  return db.prepare(`UPDATE enrollments SET status = 'cancelled', cancel_reason = 'deselected', cancelled_at = ?
    WHERE user_id = ? AND status = 'active'
      AND id NOT IN (SELECT enrollment_id FROM attendance)
      AND session_id IN (SELECT id FROM program_sessions WHERE date IS NULL OR date >= ?)`)
    .run(nowIso(), userId, today).changes;
}

function activeCount(db, sessionId) {
  return db.prepare("SELECT COUNT(*) n FROM enrollments WHERE session_id = ? AND status = 'active'").get(sessionId).n;
}

function sessionWithProgram(db, sessionId) {
  return db.prepare(`SELECT s.*, p.assign_mode, p.theme, p.name AS program_name, p.self_cancel
    FROM program_sessions s JOIN programs p ON p.id = s.program_id WHERE s.id = ?`).get(sessionId);
}

/** Grow 회차 신청 가능 여부(확인 화면용). 사유 코드 또는 null */
export function growApplyBlocker(db, user, sessionId) {
  const s = sessionWithProgram(db, sessionId);
  if (!s || s.assign_mode !== 'select') return 'not_found';
  if (!user.is_selected || user.role !== 'participant') return 'forbidden';
  if (s.is_cancelled) return 'cancelled';
  if (s.is_closed) return 'closed';
  if (s.date && s.date < todaySeoul()) return 'past';
  const mine = db.prepare('SELECT status FROM enrollments WHERE user_id = ? AND session_id = ?').get(user.id, sessionId);
  if (mine && mine.status === 'active') return 'duplicate';
  if (s.capacity !== null && activeCount(db, sessionId) >= s.capacity) return 'full';
  return null;
}

/**
 * Grow 선택 신청. 로그인된 사용자 정보만 사용하며 개인정보를 다시 받지 않는다.
 * 정원 확인과 저장을 하나의 IMMEDIATE 트랜잭션으로 처리해 동시 신청으로 정원을 넘지 않게 한다.
 */
export function applyGrow(db, user, sessionId) {
  return immediate(db, () => {
    const blocker = growApplyBlocker(db, user, sessionId);
    if (blocker) throw new EnrollError(blocker);
    const now = nowIso();
    const existing = db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND session_id = ?').get(user.id, sessionId);
    if (existing) {
      db.prepare(`UPDATE enrollments SET status = 'active', source = 'select', cancel_reason = NULL, cancelled_at = NULL, created_at = ?
        WHERE id = ?`).run(now, existing.id);
      return existing.id;
    }
    return Number(db.prepare(`INSERT INTO enrollments (user_id, session_id, source, status, created_at)
      VALUES (?, ?, 'select', 'active', ?)`).run(user.id, sessionId, now).lastInsertRowid);
  });
}

/** 참여자 본인 취소: 프로그램 설정(self_cancel)이 켜져 있고 아직 지나지 않은 회차만 */
export function cancelOwnGrow(db, user, enrollmentId) {
  const e = db.prepare(`SELECT e.*, s.date, p.assign_mode, p.self_cancel FROM enrollments e
    JOIN program_sessions s ON s.id = e.session_id JOIN programs p ON p.id = s.program_id
    WHERE e.id = ? AND e.user_id = ?`).get(enrollmentId, user.id);
  if (!e || e.assign_mode !== 'select' || e.status !== 'active') throw new EnrollError('not_found');
  if (!e.self_cancel) throw new EnrollError('forbidden');
  if (e.date && e.date < todaySeoul()) throw new EnrollError('past');
  const attended = db.prepare('SELECT 1 FROM attendance WHERE enrollment_id = ?').get(e.id);
  if (attended) throw new EnrollError('forbidden');
  db.prepare("UPDATE enrollments SET status = 'cancelled', cancel_reason = 'self', cancelled_at = ? WHERE id = ?")
    .run(nowIso(), e.id);
}

/** 관리자 배정(O 마음·캠페인 등 manual 프로그램) */
export function assignManual(db, actorId, sessionId, userIds) {
  const s = sessionWithProgram(db, sessionId);
  if (!s || s.assign_mode !== 'manual') throw new EnrollError('not_found');
  const now = nowIso();
  const eligible = db.prepare("SELECT 1 FROM users WHERE id = ? AND is_selected = 1 AND role = 'participant'");
  const insert = db.prepare(`INSERT INTO enrollments (user_id, session_id, source, status, created_at)
    VALUES (?, ?, 'manual', 'active', ?) ON CONFLICT(user_id, session_id)
    DO UPDATE SET status = 'active', cancel_reason = NULL, cancelled_at = NULL WHERE status = 'cancelled'`);
  let n = 0;
  db.transaction(() => {
    for (const uid of userIds) {
      if (!eligible.get(uid)) continue;
      n += insert.run(uid, sessionId, now).changes;
    }
    audit(db, actorId, 'enrollment.assign', 'session', sessionId, { userIds, assigned: n });
  })();
  return n;
}

export function adminCancelEnrollment(db, actorId, enrollmentId) {
  const changes = db.prepare(`UPDATE enrollments SET status = 'cancelled', cancel_reason = 'admin', cancelled_at = ?
    WHERE id = ? AND status = 'active'`).run(nowIso(), enrollmentId).changes;
  if (changes) audit(db, actorId, 'enrollment.cancel', 'enrollment', enrollmentId);
  return changes;
}

/** 출석 기록: attended | absent | '' (기록 삭제) */
export function recordAttendance(db, actorId, enrollmentId, status) {
  const e = db.prepare(`SELECT e.id, e.status FROM enrollments e WHERE e.id = ?`).get(enrollmentId);
  if (!e || e.status !== 'active') throw new EnrollError('not_found');
  if (status === '') {
    db.prepare('DELETE FROM attendance WHERE enrollment_id = ?').run(enrollmentId);
  } else if (status === 'attended' || status === 'absent') {
    db.prepare(`INSERT INTO attendance (enrollment_id, status, recorded_by, recorded_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(enrollment_id) DO UPDATE SET status = excluded.status, recorded_by = excluded.recorded_by,
      recorded_at = excluded.recorded_at`).run(enrollmentId, status, actorId, nowIso());
  } else {
    throw new EnrollError('invalid');
  }
  audit(db, actorId, 'attendance.record', 'enrollment', enrollmentId, { status: status || null });
}
