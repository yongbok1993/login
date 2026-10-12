import { checkLink, comoOverview, confirmLink, counselingView, getLink, recheck, syncStatus, unlink } from '../como/mapping.js';
import { get } from '../lib/db.js';
import { audit, listAudit } from '../services/audit.js';
import {
  adminCancelEnrollment, assignManual, autoAssignLink, EnrollError, enrollmentsOf, growApplications, recordAttendance, setGrowSelection,
} from '../services/enrollments.js';
import { createNotice, deleteNotice, getNotice, listNotices, parseNoticeForm, updateNotice } from '../services/notices.js';
import { safeEqual } from '../lib/crypto.js';
import { recordAttempt, setupBlocked } from '../services/login.js';
import { normalizePhone } from '../lib/phone.js';
import { setupCodeHash, setupCodeMatches } from '../services/settings.js';
import {
  createProgram, createSession, getProgram, getSession, linkProgramStats, listPrograms, listSessions, parseProgramForm,
  parseSessionForm, sessionRoster, updateProgram, updateSession,
} from '../services/programs.js';
import {
  claimFirstManager, confirmPhone, getRegistration, getUser, hasManager, listConsents, listRegistrants, listSelectedParticipants, listStaff, resetPin,
  setInternalStatus, setRole, setSelected,
} from '../services/users.js';
import { hashPin, pinProblem, temporaryPin } from '../lib/pin.js';
import { clearPhoneFailures } from '../services/login.js';
import * as views from '../views/admin.js';
import { deny, field, fieldList, intParam, redirect, render, requireManager, requireStaff } from './helpers.js';

export function adminRoutes(r) {
  const staff = requireStaff;
  const manager = requireManager;

  // ── 첫 관리자 지정: 전체 관리자가 한 명도 없을 때만. 로그인 없이 1회용 설정 코드 또는 SESSION_SECRET(Cloudflare 환경 변수 원문) 확인 후
  //    이름·번호·새 PIN으로 관리자 계정을 만들거나, 이미 등록된 번호면 그 계정을 관리자로 바꾸고 PIN을 새로 정한다. ──
  const setupOpen = async (c) => ((await hasManager(c.db)) ? deny(c, 404) : null);
  const envReady = (c) => (c.cfg.envSecret || '').length >= 32;
  const setupReady = async (c) => envReady(c) || !!(await setupCodeHash(c.db));
  r.get('/admin/setup', setupOpen, async (c) => render(c, views.setupPage, { notReady: !(await setupReady(c)) }));
  r.post('/admin/setup', setupOpen, async (c) => {
    const values = { name: field(c, 'name'), phone: field(c, 'phone') };
    const fail = async (errors, status = 422) => render(c, views.setupPage, { values, errors, notReady: !(await setupReady(c)) }, status);
    if (await setupBlocked(c.db, c.ip)) return fail({ secret: '시도가 많아 잠시 잠겼습니다. 1시간 뒤 다시 시도해 주세요.' }, 429);
    const secret = field(c, 'secret').trim();
    const ok = (envReady(c) && safeEqual(secret, c.cfg.envSecret)) || (await setupCodeMatches(c.db, secret));
    await recordAttempt(c.db, { kind: 'pin', ip: c.ip, success: ok });
    if (!ok) return fail({ secret: '설정 코드가 맞지 않습니다.' });
    const name = values.name.trim();
    const phone = normalizePhone(values.phone);
    const pin = field(c, 'pin');
    const errors = {};
    if (!name || name.length > 40) errors.name = '이름을 입력해 주세요.';
    if (!phone) errors.phone = '휴대전화 번호를 확인해 주세요.';
    const problem = pinProblem(pin, { phone });
    if (problem) errors.pin = problem;
    else if (pin !== field(c, 'pin_confirm')) errors.pin_confirm = 'PIN이 서로 다릅니다.';
    if (Object.keys(errors).length) return fail(errors);
    const userId = await claimFirstManager(c.db, { name, phone, pinHash: await hashPin(c.cfg.sessionSecret, pin) });
    if (!userId) return deny(c, 404);
    await clearPhoneFailures(c.db, phone);
    await c.session.regenerate(userId);
    await c.session.flash('ok', '전체 관리자로 지정되었습니다.');
    return redirect(c, '/admin');
  });

  r.get('/admin', staff, async (c) => {
    const n = async (sql) => (await get(c.db, sql)).n;
    return render(c, views.dashboardPage, {
      received: await n("SELECT COUNT(*) n FROM registrations WHERE internal_status IN ('received', 'reviewing')"),
      selected: await n("SELECT COUNT(*) n FROM users WHERE role = 'participant' AND is_selected = 1"),
      programs: await n('SELECT COUNT(*) n FROM programs'),
      comoAttention: await n("SELECT COUNT(*) n FROM como_links WHERE status IN ('conflict', 'error', 'needs_recheck')"),
      growPending: await n("SELECT COUNT(*) n FROM enrollments WHERE status = 'active' AND selection = 'pending'"),
      notices: await n('SELECT COUNT(*) n FROM notices'),
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

  // PIN 초기화: 기관이 본인 확인 후 실행. 임시 PIN은 이 화면에서 한 번만 보여 준다.
  r.post('/admin/participants/:id/pin-reset', manager, async (c) => {
    const user = await participant(c);
    if (!user) return deny(c, 404);
    const pin = temporaryPin();
    await resetPin(c.db, c.user.id, user.id, await hashPin(c.cfg.sessionSecret, pin));
    await clearPhoneFailures(c.db, user.phone);
    await c.session.flash('ok', `임시 PIN: ${pin} — 본인에게 전달해 주세요. 첫 로그인 때 새 PIN으로 바꾸게 됩니다.`);
    return redirect(c, `/admin/participants/${user.id}`);
  });

  r.post('/admin/participants/:id/confirm-phone', manager, async (c) => {
    const user = await participant(c);
    if (!user) return deny(c, 404);
    await confirmPhone(c.db, c.user.id, user.id);
    if (c.como.configured && user.is_selected) await checkLink(c.db, c.como, await getUser(c.db, user.id), c.user.id);
    await c.session.flash('ok', '연락처 확인을 기록했습니다.');
    return redirect(c, `/admin/participants/${user.id}`);
  });

  // 권한 지정(전체 관리자만): 참여자 ↔ 운영 담당 ↔ 전체 관리자
  r.post('/admin/users/:id/role', manager, async (c) => {
    const id = intParam(c.params.id);
    const result = id ? await setRole(c.db, c.user.id, id, field(c, 'role')) : 'not_found';
    const msg = { ok: '권한을 변경했습니다.', last_manager: '마지막 전체 관리자는 해제할 수 없습니다.', invalid: '잘못된 권한입니다.',
      not_found: '사용자를 찾을 수 없습니다.' }[result];
    await c.session.flash(result === 'ok' ? 'ok' : 'error', msg);
    if (id === c.user.id) return redirect(c, '/admin');
    return redirect(c, field(c, 'back') === 'staff' ? '/admin/staff' : `/admin/participants/${id}`);
  });

  r.get('/admin/staff', manager, async (c) => render(c, views.staffPage, await listStaff(c.db)));

  // ── 공지 ──
  r.get('/admin/notices', staff, async (c) => render(c, views.noticesAdminPage, await listNotices(c.db)));
  r.get('/admin/notices/new', staff, (c) => render(c, views.noticeFormPage, { values: { audience: 'public' } }));
  r.post('/admin/notices/new', staff, async (c) => {
    const { value, errors } = parseNoticeForm(c.body);
    if (Object.keys(errors).length) return render(c, views.noticeFormPage, { values: value, errors }, 422);
    await createNotice(c.db, c.user.id, value);
    await c.session.flash('ok', '공지를 등록했습니다.');
    return redirect(c, '/admin/notices');
  });
  async function notice(c) {
    const id = intParam(c.params.id);
    return (id && (await getNotice(c.db, id))) || null;
  }
  r.get('/admin/notices/:id', staff, async (c) => {
    const n = await notice(c);
    if (!n) return deny(c, 404);
    return render(c, views.noticeFormPage, { notice: n, values: n });
  });
  r.post('/admin/notices/:id', staff, async (c) => {
    const n = await notice(c);
    if (!n) return deny(c, 404);
    const { value, errors } = parseNoticeForm(c.body);
    if (Object.keys(errors).length) return render(c, views.noticeFormPage, { notice: n, values: value, errors }, 422);
    await updateNotice(c.db, c.user.id, n.id, value);
    await c.session.flash('ok', '저장했습니다.');
    return redirect(c, '/admin/notices');
  });
  r.post('/admin/notices/:id/delete', staff, async (c) => {
    const n = await notice(c);
    if (!n) return deny(c, 404);
    await deleteNotice(c.db, c.user.id, n.id);
    await c.session.flash('ok', '삭제했습니다.');
    return redirect(c, '/admin/notices');
  });

  // ── Grow 희망 신청 선정 ──
  r.get('/admin/grow', staff, async (c) => {
    const status = ['pending', 'selected', 'not_selected', 'all'].includes(c.query.get('status')) ? c.query.get('status') : 'pending';
    return render(c, views.growAdminPage, { rows: await growApplications(c.db, { status }), status });
  });

  r.post('/admin/enrollments/:id/selection', staff, async (c) => {
    const e = await enrollment(c);
    if (!e) return deny(c, 404);
    try {
      await setGrowSelection(c.db, c.user.id, e.id, field(c, 'decision'));
      await c.session.flash('ok', '저장했습니다.');
    } catch (err) {
      if (!(err instanceof EnrollError)) throw err;
      await c.session.flash('error', err.code === 'full' ? '정원이 찼습니다. 정원을 늘리거나 다른 선정을 해제해 주세요.' : '변경할 수 없습니다.');
    }
    const back = field(c, 'back');
    return redirect(c, back.startsWith('/admin/') ? back : `/admin/sessions/${e.session_id}`);
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
