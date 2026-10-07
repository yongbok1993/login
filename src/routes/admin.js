import express from 'express';
import { checkLink, confirmLink, counselingView, getLink, syncStatus, unlink } from '../como/mapping.js';
import { listAudit } from '../services/audit.js';
import { adminCancelEnrollment, assignManual, autoAssignLink, EnrollError, recordAttendance } from '../services/enrollments.js';
import {
  createProgram, createSession, getProgram, getSession, listPrograms, listSessions, parseProgramForm, parseSessionForm,
  sessionRoster, updateProgram, updateSession,
} from '../services/programs.js';
import {
  getRegistration, getUser, listConsents, listRegistrants, listSelectedParticipants, setInternalStatus, setSelected,
} from '../services/users.js';
import { audit } from '../services/audit.js';
import * as views from '../views/admin.js';
import { deny, intParam, render, requireManager, requireStaff } from './helpers.js';

export function adminRoutes({ db, como }) {
  const r = express.Router();
  r.use('/admin', requireStaff);

  r.get('/admin', (req, res) => {
    const count = (sql, ...p) => db.prepare(sql).get(...p).n;
    render(req, res, views.dashboardPage, {
      received: count("SELECT COUNT(*) n FROM registrations WHERE internal_status IN ('received', 'reviewing')"),
      selected: count("SELECT COUNT(*) n FROM users WHERE role = 'participant' AND is_selected = 1"),
      programs: count('SELECT COUNT(*) n FROM programs'),
      comoAttention: count("SELECT COUNT(*) n FROM como_links WHERE status IN ('conflict', 'error', 'needs_recheck')"),
    });
  });

  // ── 접수·선정 (전체 관리자) ──
  r.get('/admin/participants', requireManager, (req, res) => {
    const status = String(req.query.status || '');
    render(req, res, views.participantsPage, { rows: listRegistrants(db, { status }), status });
  });

  function participant(req, res) {
    const id = intParam(req.params.id);
    const user = id && getUser(db, id);
    if (!user || user.role !== 'participant') {
      deny(req, res, 404);
      return null;
    }
    return user;
  }

  r.get('/admin/participants/:id', requireManager, (req, res) => {
    const user = participant(req, res);
    if (!user) return;
    render(req, res, views.participantPage, {
      user,
      registration: getRegistration(db, user.id),
      consents: listConsents(db, user.id),
      enrollments: db.prepare(`SELECT e.*, s.round_no, s.date, s.start_time, s.end_time, p.name AS program_name, a.status AS attendance
        FROM enrollments e JOIN program_sessions s ON s.id = e.session_id JOIN programs p ON p.id = s.program_id
        LEFT JOIN attendance a ON a.enrollment_id = e.id WHERE e.user_id = ?
        ORDER BY s.date IS NULL, s.date`).all(user.id),
      link: getLink(db, user.id),
      comoConfigured: como.configured,
      counseling: counselingView(db, como, user),
    });
  });

  r.post('/admin/participants/:id/select', requireManager, async (req, res) => {
    const user = participant(req, res);
    if (!user) return;
    const selected = req.body.selected === '1';
    const result = setSelected(db, req.user.id, user.id, selected);
    if (selected && como.configured) await checkLink(db, como, getUser(db, user.id), req.user.id);
    req.session.flash('ok', selected ? `선정했습니다. Link 배정 ${result.created + result.restored}건` : '선정을 해제했습니다.');
    res.redirect(303, `/admin/participants/${user.id}`);
  });

  r.post('/admin/participants/:id/status', requireManager, (req, res) => {
    const user = participant(req, res);
    if (!user) return;
    const ok = setInternalStatus(db, req.user.id, user.id, String(req.body.status || ''));
    req.session.flash(ok ? 'ok' : 'error', ok ? '저장되었습니다.' : '변경할 수 없는 상태입니다.');
    res.redirect(303, `/admin/participants/${user.id}`);
  });

  // ── 프로그램·회차 ──
  function programList() {
    return db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM program_sessions s WHERE s.program_id = p.id) AS session_count
      FROM programs p ORDER BY CASE theme WHEN 'L' THEN 1 WHEN 'O' THEN 2 WHEN 'G' THEN 3 ELSE 4 END, sort_order, id`).all();
  }

  r.get('/admin/programs', (req, res) => render(req, res, views.programsPage, programList()));

  r.get('/admin/programs/new', (req, res) => {
    render(req, res, views.programNewPage, { values: { theme: 'G', assign_mode: 'select', is_public: 1 } });
  });

  r.post('/admin/programs/new', (req, res) => {
    const { value, errors } = parseProgramForm(req.body);
    if (Object.keys(errors).length) return render(req, res, views.programNewPage, { values: value, errors }, 422);
    const id = createProgram(db, req.user.id, value);
    req.session.flash('ok', '추가되었습니다.');
    res.redirect(303, `/admin/programs/${id}`);
  });

  function program(req, res) {
    const id = intParam(req.params.id);
    const p = id && getProgram(db, id);
    if (!p) deny(req, res, 404);
    return p || null;
  }

  r.get('/admin/programs/:id', (req, res) => {
    const p = program(req, res);
    if (!p) return;
    render(req, res, views.programPage, { program: p, sessions: listSessions(db, p.id) });
  });

  r.post('/admin/programs/:id', (req, res) => {
    const p = program(req, res);
    if (!p) return;
    const { value, errors } = parseProgramForm({ ...req.body, assign_mode: p.assign_mode });
    if (Object.keys(errors).length) {
      return render(req, res, views.programPage, { program: p, sessions: listSessions(db, p.id), values: { ...value, assign_mode: p.assign_mode }, errors }, 422);
    }
    updateProgram(db, req.user.id, p.id, value);
    req.session.flash('ok', '저장되었습니다.');
    res.redirect(303, `/admin/programs/${p.id}`);
  });

  r.post('/admin/programs/:id/sessions', (req, res) => {
    const p = program(req, res);
    if (!p) return;
    if (p.assign_mode === 'external') return deny(req, res, 400, '꼬모에서 관리하는 프로그램입니다.');
    const { value, errors } = parseSessionForm(req.body);
    if (Object.keys(errors).length) {
      return render(req, res, views.programPage, { program: p, sessions: listSessions(db, p.id), sessionValues: value, sessionErrors: errors }, 422);
    }
    createSession(db, req.user.id, p.id, value);
    req.session.flash('ok', '회차가 추가되었습니다.');
    res.redirect(303, `/admin/programs/${p.id}`);
  });

  function session(req, res) {
    const id = intParam(req.params.id);
    const s = id && getSession(db, id);
    if (!s) deny(req, res, 404);
    return s || null;
  }

  function sessionProps(s) {
    const roster = sessionRoster(db, s.id);
    const enrolled = new Set(roster.filter((x) => x.status === 'active').map((x) => x.user_id));
    return {
      session: s,
      roster,
      candidates: s.assign_mode === 'manual' ? listSelectedParticipants(db).filter((u) => !enrolled.has(u.id)) : [],
    };
  }

  r.get('/admin/sessions/:id', (req, res) => {
    const s = session(req, res);
    if (!s) return;
    render(req, res, views.sessionPage, sessionProps(s));
  });

  r.post('/admin/sessions/:id', (req, res) => {
    const s = session(req, res);
    if (!s) return;
    const { value, errors } = parseSessionForm(req.body);
    if (Object.keys(errors).length) return render(req, res, views.sessionPage, { ...sessionProps(s), values: value, errors }, 422);
    updateSession(db, req.user.id, s.id, value);
    req.session.flash('ok', '저장되었습니다.');
    res.redirect(303, `/admin/sessions/${s.id}`);
  });

  r.post('/admin/sessions/:id/assign', (req, res) => {
    const s = session(req, res);
    if (!s) return;
    const ids = [].concat(req.body.user_id || []).map(intParam).filter(Boolean);
    try {
      const n = assignManual(db, req.user.id, s.id, ids);
      req.session.flash('ok', `${n}명 배정했습니다.`);
    } catch (err) {
      if (!(err instanceof EnrollError)) throw err;
      req.session.flash('error', '배정할 수 없는 회차입니다.');
    }
    res.redirect(303, `/admin/sessions/${s.id}`);
  });

  function enrollmentSession(req, res) {
    const id = intParam(req.params.id);
    const e = id && db.prepare('SELECT * FROM enrollments WHERE id = ?').get(id);
    if (!e) deny(req, res, 404);
    return e || null;
  }

  r.post('/admin/enrollments/:id/attendance', (req, res) => {
    const e = enrollmentSession(req, res);
    if (!e) return;
    try {
      recordAttendance(db, req.user.id, e.id, String(req.body.status ?? ''));
      req.session.flash('ok', '출석을 저장했습니다.');
    } catch (err) {
      if (!(err instanceof EnrollError)) throw err;
      req.session.flash('error', '저장할 수 없습니다.');
    }
    res.redirect(303, `/admin/sessions/${e.session_id}`);
  });

  r.post('/admin/enrollments/:id/cancel', (req, res) => {
    const e = enrollmentSession(req, res);
    if (!e) return;
    const attended = db.prepare('SELECT 1 FROM attendance WHERE enrollment_id = ?').get(e.id);
    if (attended) req.session.flash('error', '출석 기록이 있어 취소할 수 없습니다.');
    else req.session.flash('ok', adminCancelEnrollment(db, req.user.id, e.id) ? '취소했습니다.' : '이미 취소된 신청입니다.');
    res.redirect(303, `/admin/sessions/${e.session_id}`);
  });

  // ── Link 자동 배정 ──
  function linkPrograms() {
    return db.prepare(`SELECT p.id, p.name,
        (SELECT COUNT(*) FROM program_sessions s WHERE s.program_id = p.id AND s.is_cancelled = 0) AS session_count,
        (SELECT COUNT(*) FROM enrollments e JOIN program_sessions s ON s.id = e.session_id
          WHERE s.program_id = p.id AND e.status = 'active') AS enrollment_count
      FROM programs p WHERE p.assign_mode = 'auto' ORDER BY p.sort_order`).all();
  }

  r.get('/admin/link', (req, res) => render(req, res, views.linkPage, { programs: linkPrograms() }));

  r.post('/admin/link/run', (req, res) => {
    const result = autoAssignLink(db);
    audit(db, req.user.id, 'link.auto_assign', 'program', null, result);
    render(req, res, views.linkPage, { programs: linkPrograms(), result });
  });

  // ── 꼬모 연동 (전체 관리자) ──
  r.get('/admin/como', requireManager, (req, res) => {
    render(req, res, views.comoPage, {
      adapter: como,
      applyUrl: req.app.locals.cfg.comoApplyUrl,
      rows: db.prepare(`SELECT u.id, u.name, u.phone, l.status, l.detail, l.checked_at FROM users u
        LEFT JOIN como_links l ON l.user_id = u.id WHERE u.role = 'participant' AND u.is_selected = 1
        ORDER BY CASE l.status WHEN 'conflict' THEN 0 WHEN 'error' THEN 1 WHEN 'needs_recheck' THEN 2 ELSE 3 END, u.name`).all(),
      logs: db.prepare(`SELECT g.*, u.name FROM como_sync_log g LEFT JOIN users u ON u.id = g.user_id
        ORDER BY g.id DESC LIMIT 100`).all(),
    });
  });

  function requireComo(req, res, next) {
    if (!como.configured) return deny(req, res, 409, '꼬모 연동이 설정되지 않았습니다.');
    next();
  }

  r.post('/admin/como/check-all', requireManager, requireComo, async (req, res) => {
    const counts = {};
    for (const u of listSelectedParticipants(db)) {
      const result = await checkLink(db, como, u, req.user.id);
      counts[result] = (counts[result] || 0) + 1;
    }
    req.session.flash('ok', `확인 완료: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || '대상 없음'}`);
    res.redirect(303, '/admin/como');
  });

  r.post('/admin/como/sync-all', requireManager, requireComo, async (req, res) => {
    let ok = 0;
    let failed = 0;
    for (const u of listSelectedParticipants(db)) {
      const result = await syncStatus(db, como, u);
      if (result === 'ok') ok += 1;
      else if (result === 'error') failed += 1;
    }
    req.session.flash(failed ? 'error' : 'ok', `갱신 ${ok}건${failed ? ` · 실패 ${failed}건` : ''}`);
    res.redirect(303, '/admin/como');
  });

  r.post('/admin/como/:id/check', requireManager, requireComo, async (req, res) => {
    const user = participant(req, res);
    if (!user) return;
    // 재확인은 기존 연결을 무시하고 새로 조회한다.
    db.prepare("UPDATE como_links SET status = 'needs_recheck' WHERE user_id = ? AND status = 'linked'").run(user.id);
    await checkLink(db, como, user, req.user.id);
    res.redirect(303, `/admin/participants/${user.id}`);
  });

  r.post('/admin/como/:id/sync', requireManager, requireComo, async (req, res) => {
    const user = participant(req, res);
    if (!user) return;
    const result = await syncStatus(db, como, user);
    req.session.flash(result === 'ok' ? 'ok' : 'error', result === 'ok' ? '갱신했습니다.' : '갱신하지 못했습니다.');
    res.redirect(303, `/admin/participants/${user.id}`);
  });

  r.post('/admin/como/:id/confirm', requireManager, requireComo, async (req, res) => {
    const user = participant(req, res);
    if (!user) return;
    const result = await confirmLink(db, como, user, String(req.body.external_id || ''), req.user.id);
    req.session.flash(result === 'linked' ? 'ok' : 'error', result === 'linked' ? '연결했습니다.' : '연결할 수 없습니다.');
    res.redirect(303, `/admin/participants/${user.id}`);
  });

  r.post('/admin/como/:id/unlink', requireManager, requireComo, (req, res) => {
    const user = participant(req, res);
    if (!user) return;
    unlink(db, user.id, req.user.id);
    req.session.flash('ok', '연결을 해제했습니다.');
    res.redirect(303, `/admin/participants/${user.id}`);
  });

  r.get('/admin/audit', requireManager, (req, res) => render(req, res, views.auditPage, listAudit(db)));

  return r;
}
