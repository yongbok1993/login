import { all } from '../lib/db.js';
import { todaySeoul } from '../lib/time.js';

// 참여자 본인 일정. 모든 조회는 로그인 세션의 사용자 ID로만 한다.
// internal(기관 내부 운영)·external(꼬모) 프로그램은 개인 일정에 포함하지 않는다.
const PERSONAL = "p.assign_mode IN ('auto', 'select', 'manual')";

/** 참여할 프로그램: 활성 배정·신청 중 아직 지나지 않았고 출석 기록이 없는 회차 */
export function upcomingFor(db, userId, today = todaySeoul()) {
  return all(db, `SELECT e.id AS enrollment_id, e.source, s.id AS session_id, s.round_no, s.date, s.start_time, s.end_time,
      s.place, p.id AS program_id, p.name AS program_name, p.theme, p.assign_mode, p.self_cancel
    FROM enrollments e JOIN program_sessions s ON s.id = e.session_id JOIN programs p ON p.id = s.program_id
    LEFT JOIN attendance a ON a.enrollment_id = e.id
    WHERE e.user_id = ? AND e.status = 'active' AND s.is_cancelled = 0 AND ${PERSONAL}
      AND a.enrollment_id IS NULL AND (s.date IS NULL OR s.date >= ?)
    ORDER BY s.date IS NULL, s.date, s.start_time IS NULL, s.start_time, p.sort_order, s.round_no`, userId, today);
}

/** 지금 해야 할 것: 날짜가 확정된 가장 가까운 일정, 없으면 미정 일정 중 첫 번째 */
export function nextAction(upcoming) {
  return upcoming.find((u) => u.date) || upcoming[0] || null;
}

/** 참여한 프로그램: 출석(참여 완료) 기록만. 신청·자동 배정은 포함하지 않는다. */
export function attendedFor(db, userId) {
  return all(db, `SELECT s.date, s.round_no, p.id AS program_id, p.name AS program_name, p.theme
    FROM attendance a JOIN enrollments e ON e.id = a.enrollment_id JOIN program_sessions s ON s.id = e.session_id
    JOIN programs p ON p.id = s.program_id
    WHERE e.user_id = ? AND a.status = 'attended' AND ${PERSONAL}
    ORDER BY s.date DESC`, userId);
}

export function groupAttended(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.program_id)) map.set(r.program_id, { program_name: r.program_name, theme: r.theme, count: 0, dates: [] });
    const g = map.get(r.program_id);
    g.count += 1;
    if (r.date) g.dates.push(r.date);
  }
  return [...map.values()];
}

/** Grow 신청 목록: 신청 가능한 회차와 본인 신청 여부 */
export function growSessionsFor(db, userId, today = todaySeoul()) {
  return all(db, `SELECT s.*, p.id AS program_id, p.name AS program_name, p.self_cancel,
      (SELECT COUNT(*) FROM enrollments x WHERE x.session_id = s.id AND x.status = 'active') AS active_count,
      e.id AS my_enrollment_id, e.status AS my_status
    FROM program_sessions s JOIN programs p ON p.id = s.program_id
    LEFT JOIN enrollments e ON e.session_id = s.id AND e.user_id = ?
    WHERE p.assign_mode = 'select' AND s.is_cancelled = 0 AND (s.date IS NULL OR s.date >= ?)
    ORDER BY p.sort_order, s.date IS NULL, s.date, s.start_time, s.round_no`, userId, today);
}
