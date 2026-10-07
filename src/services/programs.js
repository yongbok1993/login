import { all, batch, get, run, stmt } from '../lib/db.js';
import { isValidDate, isValidTime, nowIso } from '../lib/time.js';
import { audit, auditStmt } from './audit.js';
import { autoAssignLink } from './enrollments.js';

export const ASSIGN_MODES = {
  auto: '전체 자동 배정',
  select: '선택 신청',
  manual: '관리자 배정',
  internal: '기관 내부 운영',
  external: '꼬모 접수',
};

const THEME_ORDER = "CASE theme WHEN 'L' THEN 1 WHEN 'O' THEN 2 WHEN 'G' THEN 3 ELSE 4 END";

export function listPrograms(db, { publicOnly = false } = {}) {
  return all(db, `SELECT p.*, (SELECT COUNT(*) FROM program_sessions s WHERE s.program_id = p.id) AS session_count
    FROM programs p ${publicOnly ? 'WHERE is_public = 1' : ''} ORDER BY ${THEME_ORDER}, sort_order, id`);
}

export function getProgram(db, id) {
  return get(db, 'SELECT * FROM programs WHERE id = ?', id);
}

export function getProgramByCode(db, code) {
  return get(db, 'SELECT * FROM programs WHERE code = ?', code);
}

export function groupByTheme(programs) {
  const out = { L: [], O: [], G: [], IN: [] };
  for (const p of programs) out[p.theme].push(p);
  return out;
}

function str(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function parseProgramForm(body) {
  const errors = {};
  const p = {
    theme: str(body.theme),
    name: str(body.name, 80),
    detail: str(body.detail),
    schedule_label: str(body.schedule_label),
    assign_mode: str(body.assign_mode),
    is_public: body.is_public === '1' ? 1 : 0,
    self_cancel: body.self_cancel === '1' ? 1 : 0,
  };
  if (!['L', 'O', 'G', 'IN'].includes(p.theme)) errors.theme = '테마를 선택해 주세요.';
  if (!p.name) errors.name = '프로그램명을 입력해 주세요.';
  if (!ASSIGN_MODES[p.assign_mode]) errors.assign_mode = '배정 방식을 선택해 주세요.';
  return { value: p, errors };
}

export async function createProgram(db, actorId, p) {
  const now = nowIso();
  const meta = await run(db, `INSERT INTO programs (theme, name, detail, schedule_label, assign_mode, is_public, self_cancel,
    sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM programs), ?, ?)`,
  p.theme, p.name, p.detail, p.schedule_label, p.assign_mode, p.is_public, p.self_cancel, now, now);
  await audit(db, actorId, 'program.create', 'program', meta.last_row_id, p);
  return meta.last_row_id;
}

/** 배정 방식은 생성 후 바꾸지 않는다(기존 배정·신청 기록과 어긋나지 않도록). */
export async function updateProgram(db, actorId, id, p) {
  await batch(db, [
    stmt(db, `UPDATE programs SET theme = ?, name = ?, detail = ?, schedule_label = ?, is_public = ?, self_cancel = ?, updated_at = ?
      WHERE id = ?`, p.theme, p.name, p.detail, p.schedule_label, p.is_public, p.self_cancel, nowIso(), id),
    auditStmt(db, actorId, 'program.update', 'program', id, p),
  ]);
}

// ── 회차 ───────────────────────────────────────────────

export function listSessions(db, programId) {
  return all(db, `SELECT s.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.session_id = s.id AND e.status = 'active') AS active_count
    FROM program_sessions s WHERE s.program_id = ?
    ORDER BY s.date IS NULL, s.date, s.start_time, s.round_no, s.id`, programId);
}

export function getSession(db, id) {
  return get(db, `SELECT s.*, p.name AS program_name, p.theme, p.assign_mode, p.detail AS program_detail, p.self_cancel,
      (SELECT COUNT(*) FROM enrollments e WHERE e.session_id = s.id AND e.status = 'active') AS active_count
    FROM program_sessions s JOIN programs p ON p.id = s.program_id WHERE s.id = ?`, id);
}

/** 회차 입력값 검증. 비어 있는 날짜·시간·장소·정원은 NULL(미정)로 둔다. */
export function parseSessionForm(body) {
  const errors = {};
  const blank = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const s = {
    round_no: blank(body.round_no),
    date: blank(body.date),
    start_time: blank(body.start_time),
    end_time: blank(body.end_time),
    place: blank(body.place) ? body.place.trim().slice(0, 120) : null,
    capacity: blank(body.capacity),
    is_closed: body.is_closed === '1' ? 1 : 0,
    is_cancelled: body.is_cancelled === '1' ? 1 : 0,
  };
  if (s.round_no !== null) {
    if (!/^\d{1,3}$/.test(s.round_no)) errors.round_no = '숫자로 입력해 주세요.';
    else s.round_no = Number(s.round_no);
  }
  if (s.date !== null && !isValidDate(s.date)) errors.date = '날짜 형식이 올바르지 않습니다.';
  if (s.start_time !== null && !isValidTime(s.start_time)) errors.start_time = '시간 형식이 올바르지 않습니다.';
  if (s.end_time !== null && !isValidTime(s.end_time)) errors.end_time = '시간 형식이 올바르지 않습니다.';
  if (s.end_time && !s.start_time) errors.start_time = '시작 시간을 입력해 주세요.';
  if (s.start_time && s.end_time && s.end_time <= s.start_time) errors.end_time = '종료 시간이 시작 시간보다 늦어야 합니다.';
  if (s.capacity !== null) {
    if (!/^\d{1,4}$/.test(s.capacity)) errors.capacity = '숫자로 입력해 주세요.';
    else s.capacity = Number(s.capacity);
  }
  return { value: s, errors };
}

/**
 * 회차 생성. Link(auto) 프로그램이면 선정된 참여자에게 바로 배정한다.
 * 배정은 재실행해도 중복되지 않으므로, 중간에 실패하면 'Link 배정'에서 다시 실행하면 된다.
 */
export async function createSession(db, actorId, programId, s) {
  const now = nowIso();
  const meta = await run(db, `INSERT INTO program_sessions (program_id, round_no, date, start_time, end_time, place, capacity,
    is_closed, is_cancelled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  programId, s.round_no, s.date, s.start_time, s.end_time, s.place, s.capacity, s.is_closed, s.is_cancelled, now, now);
  const id = meta.last_row_id;
  const program = await getProgram(db, programId);
  const assigned = program.assign_mode === 'auto' ? await autoAssignLink(db, { sessionId: id }) : null;
  await audit(db, actorId, 'session.create', 'session', id, { programId, ...s, assigned });
  return id;
}

export async function updateSession(db, actorId, id, s) {
  await batch(db, [
    stmt(db, `UPDATE program_sessions SET round_no = ?, date = ?, start_time = ?, end_time = ?, place = ?, capacity = ?,
      is_closed = ?, is_cancelled = ?, updated_at = ? WHERE id = ?`,
    s.round_no, s.date, s.start_time, s.end_time, s.place, s.capacity, s.is_closed, s.is_cancelled, nowIso(), id),
    auditStmt(db, actorId, 'session.update', 'session', id, s),
  ]);
  const session = await getSession(db, id);
  if (session.assign_mode === 'auto' && !session.is_cancelled) await autoAssignLink(db, { sessionId: id });
}

export function sessionRoster(db, sessionId) {
  return all(db, `SELECT e.*, u.name, u.phone, u.is_selected, a.status AS attendance
    FROM enrollments e JOIN users u ON u.id = e.user_id LEFT JOIN attendance a ON a.enrollment_id = e.id
    WHERE e.session_id = ? ORDER BY e.status, u.name`, sessionId);
}

export function linkProgramStats(db) {
  return all(db, `SELECT p.id, p.name,
      (SELECT COUNT(*) FROM program_sessions s WHERE s.program_id = p.id AND s.is_cancelled = 0) AS session_count,
      (SELECT COUNT(*) FROM enrollments e JOIN program_sessions s ON s.id = e.session_id
        WHERE s.program_id = p.id AND e.status = 'active') AS enrollment_count
    FROM programs p WHERE p.assign_mode = 'auto' ORDER BY p.sort_order`);
}
