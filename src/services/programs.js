import { isValidDate, isValidTime, nowIso } from '../lib/time.js';
import { audit } from './audit.js';
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
  return db.prepare(`SELECT * FROM programs ${publicOnly ? 'WHERE is_public = 1' : ''}
    ORDER BY ${THEME_ORDER}, sort_order, id`).all();
}

export function getProgram(db, id) {
  return db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
}

export function getProgramByCode(db, code) {
  return db.prepare('SELECT * FROM programs WHERE code = ?').get(code);
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

export function createProgram(db, actorId, p) {
  const now = nowIso();
  const id = Number(db.prepare(`INSERT INTO programs (theme, name, detail, schedule_label, assign_mode, is_public, self_cancel,
    sort_order, created_at, updated_at) VALUES (@theme, @name, @detail, @schedule_label, @assign_mode, @is_public, @self_cancel,
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM programs), @now, @now)`).run({ ...p, now }).lastInsertRowid);
  audit(db, actorId, 'program.create', 'program', id, p);
  return id;
}

/** 배정 방식은 생성 후 바꾸지 않는다(기존 배정·신청 기록과 어긋나지 않도록). */
export function updateProgram(db, actorId, id, p) {
  db.prepare(`UPDATE programs SET theme = @theme, name = @name, detail = @detail, schedule_label = @schedule_label,
    is_public = @is_public, self_cancel = @self_cancel, updated_at = @now WHERE id = @id`).run({ ...p, id, now: nowIso() });
  audit(db, actorId, 'program.update', 'program', id, p);
}

// ── 회차 ───────────────────────────────────────────────

export function listSessions(db, programId) {
  return db.prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.session_id = s.id AND e.status = 'active') AS active_count
    FROM program_sessions s WHERE s.program_id = ?
    ORDER BY s.date IS NULL, s.date, s.start_time, s.round_no, s.id`).all(programId);
}

export function getSession(db, id) {
  return db.prepare(`SELECT s.*, p.name AS program_name, p.theme, p.assign_mode, p.detail AS program_detail, p.self_cancel,
      (SELECT COUNT(*) FROM enrollments e WHERE e.session_id = s.id AND e.status = 'active') AS active_count
    FROM program_sessions s JOIN programs p ON p.id = s.program_id WHERE s.id = ?`).get(id);
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

/** 회차 생성. Link(auto) 프로그램이면 선정된 참여자에게 바로 배정한다. */
export function createSession(db, actorId, programId, s) {
  const now = nowIso();
  return db.transaction(() => {
    const id = Number(db.prepare(`INSERT INTO program_sessions (program_id, round_no, date, start_time, end_time, place, capacity,
      is_closed, is_cancelled, created_at, updated_at) VALUES (@program_id, @round_no, @date, @start_time, @end_time, @place,
      @capacity, @is_closed, @is_cancelled, @now, @now)`).run({ ...s, program_id: programId, now }).lastInsertRowid);
    const program = getProgram(db, programId);
    const assigned = program.assign_mode === 'auto' ? autoAssignLink(db, { sessionId: id }) : null;
    audit(db, actorId, 'session.create', 'session', id, { programId, ...s, assigned });
    return id;
  })();
}

export function updateSession(db, actorId, id, s) {
  db.transaction(() => {
    db.prepare(`UPDATE program_sessions SET round_no = @round_no, date = @date, start_time = @start_time, end_time = @end_time,
      place = @place, capacity = @capacity, is_closed = @is_closed, is_cancelled = @is_cancelled, updated_at = @now
      WHERE id = @id`).run({ ...s, id, now: nowIso() });
    const session = getSession(db, id);
    if (session.assign_mode === 'auto' && !session.is_cancelled) autoAssignLink(db, { sessionId: id });
    audit(db, actorId, 'session.update', 'session', id, s);
  })();
}

export function sessionRoster(db, sessionId) {
  return db.prepare(`SELECT e.*, u.name, u.phone, u.is_selected, a.status AS attendance
    FROM enrollments e JOIN users u ON u.id = e.user_id LEFT JOIN attendance a ON a.enrollment_id = e.id
    WHERE e.session_id = ? ORDER BY e.status, u.name`).all(sessionId);
}
