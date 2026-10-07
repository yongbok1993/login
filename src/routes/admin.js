import { checkLink, comoOverview, confirmLink, counselingView, getLink, recheck, syncStatus, unlink } from '../como/mapping.js';
import { get } from '../lib/db.js';
import { audit, listAudit } from '../services/audit.js';
import {
  adminCancelEnrollment, assignManual, autoAssignLink, EnrollError, enrollmentsOf, recordAttendance,
} from '../services/enrollments.js';
import {
  createProgram, createSession, getProgram, getSession, linkProgramStats, listPrograms, listSessions, parseProgramForm,
  parseSessionForm, sessionRoster, updateProgram, updateSession,
} from '../services/programs.js';
import {
  getRegistration, getUser, listConsents, listRegistrants, listSelectedParticipants, setInternalStatus, setSelected,
} from '../services/users.js';
import * as views from '../views/admin.js';
import { deny, field, fieldList, intParam, redirect, render, requireManager, requireStaff } from './helpers.js';

export function adminRoutes(r) {
  const staff = requireStaff;
  const manager = requireManager;

  r.get('/admin', staff, async (c) => {
    const n = async (sql) => (await get(c.db, sql)).n;
    return render(c, views.dashboardPage, {
      received: await n("SELECT COUNT(*) n FROM registrations WHERE internal_status IN ('received', 'reviewing')"),
      selected: await n("SELECT COUNT(*) n FROM users WHERE role = 'participant' AND is_selected = 1"),
      programs: await n('SELECT COUNT(*) n FROM programs'),
      comoAttention: await n("SELECT COUNT(*) n FROM como_links WHERE status IN ('conflict', 'error', 'needs_recheck')"),
    });
  });

  // ── 접수·선정 (전체 관리자) ──
  r.get('/admin/participants', manager, async (c) => {
    const status = c.query.get('status') || '';
    return render(c, views.participantsPage, { rows: await listRegistrants(c.db, { status }), status });
  });

  async function participant(c) {
    const id = intParam(c.params.id);
    const user = id && (await getUser(c.db, id));
    return user && user.role === 'participant' ? user : null;
  }

  r.get('/admin/participants/:id', manager, async (c) => {
    const user = await participant(c);
    if (!user) return deny(c, 404);
    return render(c, views.participantPage, {
      user,
      registration: await getRegistration(c.db, user.id),
      consents: await listConsents(c.db, user.id),
      enrollments: await enrollmentsOf(c.db, user.id),
      link: await getLink(c.db, user.id),
      comoConfigured: c.como.configured,
      counseling: await counselingView(c.db, c.como, user),
    });
  });

  r.post('/admin/participants/:id/select', manager, async (c) => {
    const user = await participant(c);
    if (!user) return deny(c, 404);
    const selected = field(c, 'selected') === '1';
    const result = await setSelected(c.db, c.user.id, user.id, selected);
    if (selected && c.como.configured) await checkLink(c.db, c.como, await getUser(c.db, user.id), c.user.id);
    await c.session.flash('ok', selected ? `선정했습니다. Link 배정 ${result.created + result.restored}건` : '선정을 해제했습니다.');
    return redirect(c, `/admin/participants/${user.id}`);
  });

  r.post('/admin/participants/:id/status', manager, async (c) => {
    const user = await participant(c);
    if (!user) return deny(c, 404);
    const ok = await setInternalStatus(c.db, c.user.id, user.id, field(c, 'status'));
    await c.session.flash(ok ? 'ok' : 'error', ok ? '저장되었습니다.' : '변경할 수 없는 상태입니다.');
    return redirect(c, `/admin/participants/${user.id}`);
  });

  // ── 프로그램·회차 ──
  r.get('/admin/programs', staff, async (c) => render(c, views.programsPage, await listPrograms(c.db)));

  r.get('/admin/programs/new', staff, (c) => render(c, views.programNewPage, { values: { theme: 'G', assign_mode: 'select', is_public: 1 } }));

  r.post('/admin/programs/new', staff, async (c) => {
    const { value, errors } = parseProgramForm(c.body);
    if (Object.keys(errors).length) return render(c, views.programNewPage, { values: value, errors }, 422);
    const id = await createProgram(c.db, c.user.id, value);
    await c.session.flash('ok', '추가되었습니다.');
    return redirect(c, `/admin/programs/${id}`);
  });

  async function program(c) {
    const id = intParam(c.params.id);
    return (id && (await getProgram(c.db, id))) || null;
  }

  r.get('/admin/programs/:id', staff, async (c) => {
    const p = await program(c);
    if (!p) return deny(c, 404);
    return render(c, views.programPage, { program: p, sessions: await listSessions(c.db, p.id) });
  });

  r.post('/admin/programs/:id', staff, async (c) => {
    const p = await program(c);
    if (!p) return deny(c, 404);
    const { value, errors } = parseProgramForm({ ...c.body, assign_mode: p.assign_mode });
    if (Object.keys(errors).length) {
      return render(c, views.programPage, { program: p, sessions: await listSessions(c.db, p.id), values: value, errors }, 422);
    }
    await updateProgram(c.db, c.user.id, p.id, value);
    await c.session.flash('ok', '저장되었습니다.');
    return redirect(c, `/admin/programs/${p.id}`);
  });

  r.post('/admin/programs/:id/sessions', staff, async (c) => {
    const p = await program(c);
    if (!p) return deny(c, 404);
    if (p.assign_mode === 'external') return deny(c, 400, '꼬모에서 관리하는 프로그램입니다.');
    const { value, errors } = parseSessionForm(c.body);
    if (Object.keys(errors).length) {
      return render(c, views.programPage, { program: p, sessions: await listSessions(c.db, p.id), sessionValues: value, sessionErrors: errors }, 422);
    }
    await createSession(c.db, c.user.id, p.id, value);
    await c.session.flash('ok', '회차가 추가되었습니다.');
    return redirect(c, `/admin/programs/${p.id}`);
  });

  async function session(c) {
    const id = intParam(c.params.id);
    return (id && (await getSession(c.db, id))) || null;
  }

  async function sessionProps(c, s) {
    const roster = await sessionRoster(c.db, s.id);
    const enrolled = new Set(roster.filter((x) => x.status === 'active').map((x) => x.user_id));
    return {
      session: s,
      roster,
      candidates: s.assign_mode === 'manual' ? (await listSelectedParticipants(c.db)).filter((u) => !enrolled.has(u.id)) : [],
    };
  }

  r.get('/admin/sessions/:id', staff, async (c) => {
    const s = await session(c);
    if (!s) return deny(c, 404);
    return render(c, views.sessionPage, await sessionProps(c, s));
  });

  r.post('/admin/sessions/:id', staff, async (c) => {
    const s = await session(c);
    if (!s) return deny(c, 404);
    const { value, errors } = parseSessionForm(c.body);
    if (Object.keys(errors).length) return render(c, views.sessionPage, { ...(await sessionProps(c, s)), values: value, errors }, 422);
    await updateSession(c.db, c.user.id, s.id, value);
    await c.session.flash('ok', '저장되었습니다.');
    return redirect(c, `/admin/sessions/${s.id}`);
  });

  r.post('/admin/sessions/:id/assign', staff, async (c) => {
    const s = await session(c);
    if (!s) return deny(c, 404);
    const ids = fieldList(c, 'user_id').map(intParam).filter(Boolean);
    try {
      const n = await assignManual(c.db, c.user.id, s.id, ids);
      await c.session.flash('ok', `${n}명 배정했습니다.`);
    } catch (err) {
      if (!(err instanceof EnrollError)) throw err;
      await c.session.flash('error', '배정할 수 없는 회차입니다.');
    }
    return redirect(c, `/admin/sessions/${s.id}`);
  });

  async function enrollment(c) {
    const id = intParam(c.params.id);
    return (id && (await get(c.db, 'SELECT * FROM enrollments WHERE id = ?', id))) || null;
  }

  r.post('/admin/enrollments/:id/attendance', staff, async (c) => {
    const e = await enrollment(c);
    if (!e) return deny(c, 404);
    try {
      await recordAttendance(c.db, c.user.id, e.id, field(c, 'status'));
      await c.session.flash('ok', '출석을 저장했습니다.');
    } catch (err) {
      if (!(err instanceof EnrollError)) throw err;
      await c.session.flash('error', '저장할 수 없습니다.');
    }
    return redirect(c, `/admin/sessions/${e.session_id}`);
  });

  r.post('/admin/enrollments/:id/cancel', staff, async (c) => {
    const e = await enrollment(c);
    if (!e) return deny(c, 404);
    const changed = await adminCancelEnrollment(c.db, c.user.id, e.id);
    await c.session.flash(changed ? 'ok' : 'error', changed ? '취소했습니다.' : '취소할 수 없습니다(출석 기록이 있거나 이미 취소됨).');
    return redirect(c, `/admin/sessions/${e.session_id}`);
  });

  // ── Link 자동 배정 ──
  r.get('/admin/link', staff, async (c) => render(c, views.linkPage, { programs: await linkProgramStats(c.db) }));

  r.post('/admin/link/run', staff, async (c) => {
    const result = await autoAssignLink(c.db);
    await audit(c.db, c.user.id, 'link.auto_assign', 'program', null, result);
    return render(c, views.linkPage, { programs: await linkProgramStats(c.db), result });
  });

  // ── 꼬모 연동 (전체 관리자) ──
  r.get('/admin/como', manager, async (c) => {
    const [rows, logs] = await comoOverview(c.db);
    return render(c, views.comoPage, { adapter: c.como, applyUrl: c.cfg.comoApplyUrl, rows, logs });
  });

  const comoReady = (c) => (c.como.configured ? null : deny(c, 409, '꼬모 연동이 설정되지 않았습니다.'));

  r.post('/admin/como/check-all', manager, comoReady, async (c) => {
    const counts = {};
    for (const u of await listSelectedParticipants(c.db)) {
      const result = await checkLink(c.db, c.como, u, c.user.id);
      counts[result] = (counts[result] || 0) + 1;
    }
    await c.session.flash('ok', `확인 완료: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || '대상 없음'}`);
    return redirect(c, '/admin/como');
  });

  r.post('/admin/como/sync-all', manager, comoReady, async (c) => {
    let ok = 0;
    let failed = 0;
    for (const u of await listSelectedParticipants(c.db)) {
      const result = await syncStatus(c.db, c.como, u);
      if (result === 'ok') ok += 1;
      else if (result === 'error') failed += 1;
    }
    await c.session.flash(failed ? 'error' : 'ok', `갱신 ${ok}건${failed ? ` · 실패 ${failed}건` : ''}`);
    return redirect(c, '/admin/como');
  });

  r.post('/admin/como/:id/check', manager, comoReady, async (c) => {
    const user = await participant(c);
    if (!user) return deny(c, 404);
    await recheck(c.db, c.como, user, c.user.id);
    return redirect(c, `/admin/participants/${user.id}`);
  });

  r.post('/admin/como/:id/sync', manager, comoReady, async (c) => {
    const user = await participant(c);
    if (!user) return deny(c, 404);
    const result = await syncStatus(c.db, c.como, user);
    await c.session.flash(result === 'ok' ? 'ok' : 'error', result === 'ok' ? '갱신했습니다.' : '갱신하지 못했습니다.');
    return redirect(c, `/admin/participants/${user.id}`);
  });

  r.post('/admin/como/:id/confirm', manager, comoReady, async (c) => {
    const user = await participant(c);
    if (!user) return deny(c, 404);
    const result = await confirmLink(c.db, c.como, user, field(c, 'external_id'), c.user.id);
    await c.session.flash(result === 'linked' ? 'ok' : 'error', result === 'linked' ? '연결했습니다.' : '연결할 수 없습니다.');
    return redirect(c, `/admin/participants/${user.id}`);
  });

  r.post('/admin/como/:id/unlink', manager, comoReady, async (c) => {
    const user = await participant(c);
    if (!user) return deny(c, 404);
    await unlink(c.db, user.id, c.user.id);
    await c.session.flash('ok', '연결을 해제했습니다.');
    return redirect(c, `/admin/participants/${user.id}`);
  });

  r.get('/admin/audit', manager, async (c) => render(c, views.auditPage, await listAudit(c.db)));
}
