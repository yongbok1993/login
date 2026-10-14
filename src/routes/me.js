import { counselingView, refreshIfStale } from '../como/mapping.js';
import { loadConsent } from '../config.js';
import { get } from '../lib/db.js';
import { applyGrow, cancelOwnGrow, EnrollError, growApplyBlocker } from '../services/enrollments.js';
import { getSession, groupByTheme, listPrograms } from '../services/programs.js';
import { attendedFor, groupAttended, growSessionsFor, nextAction, pendingWishCount, upcomingFor } from '../services/schedule.js';
import { recentNotices } from '../services/board.js';
import { formatPhone, normalizePhone } from '../lib/phone.js';
import { verifyPassword } from '../lib/password.js';
import { loginBlock, recordAttempt } from '../services/login.js';
import { changePhone, getApplication, isApprovedParticipant, listConsents, parseName, updateName } from '../services/users.js';
import * as views from '../views/me.js';
import { deny, field, intParam, redirect, render, requireParticipant, requireSelected } from './helpers.js';

/** 참여자 영역. 모든 조회는 세션 사용자 ID 기준이며 다른 사용자 ID를 받지 않는다. */
export function meRoutes(r) {
  async function counseling(c) {
    try {
      await refreshIfStale(c.db, c.como, c.user, c.cfg.comoStatusMaxAgeMinutes);
    } catch (err) {
      c.logger.warn(`꼬모 현황 갱신 실패: ${err.message}`);
    }
    return counselingView(c.db, c.como, c.user);
  }

  // 내 신청정보: 신청 시각 → 이름 → 전화번호 → 신청 상태. 본인 것만 조회한다.
  const application = async (c, extra = {}, status = 200) => render(c, views.applicationPage, {
    app: await getApplication(c.db, c.user.id), consents: await listConsents(c.db, c.user.id), consentDoc: loadConsent(c.cfg),
    canEdit: isApprovedParticipant(c.user), ...extra,
  }, status);

  r.get('/me', requireParticipant, async (c) => {
    // 승인 대기·승인 해제·이용 중지: 본인 신청정보만
    if (!isApprovedParticipant(c.user)) return application(c);
    const upcoming = await upcomingFor(c.db, c.user.id);
    return render(c, views.statusPage, {
      next: nextAction(upcoming),
      upcoming,
      attended: groupAttended(await attendedFor(c.db, c.user.id)),
      counseling: await counseling(c),
      pendingWishes: await pendingWishCount(c.db, c.user.id),
      notices: await recentNotices(c.db, 3),
    });
  });

  r.get('/me/programs', requireSelected, async (c) => render(c, views.programsPage, {
    groups: groupByTheme(await listPrograms(c.db)),
    upcoming: await upcomingFor(c.db, c.user.id),
    growSessions: await growSessionsFor(c.db, c.user.id),
  }));

  // L 정서 지원 → 전문 심리상담
  r.get('/me/open/counseling', requireSelected, async (c) => render(c, views.counselingPage, await counseling(c)));

  // 상담신청하기: 선정 여부를 서버에서 확인한 뒤 꼬모로 이동. 전화번호 등은 전달하지 않는다.
  r.get('/me/counseling/apply', requireSelected, (c) => {
    c.resHeaders.set('Referrer-Policy', 'no-referrer');
    return redirect(c, c.cfg.comoApplyUrl, 302);
  });

  async function growSession(c) {
    const id = intParam(c.params.id);
    const s = id && (await getSession(c.db, id));
    return s && s.assign_mode === 'select' ? s : null;
  }

  r.get('/me/grow/:id', requireSelected, async (c) => {
    const s = await growSession(c);
    if (!s) return deny(c, 404);
    const blocker = await growApplyBlocker(c.db, c.user, s.id);
    return render(c, (ctx) => views.growConfirmPage(ctx, s, blocker), undefined);
  });

  r.post('/me/grow/:id', requireSelected, async (c) => {
    const s = await growSession(c);
    if (!s) return deny(c, 404);
    try {
      await applyGrow(c.db, c.user, s.id);
    } catch (err) {
      if (!(err instanceof EnrollError)) throw err;
      const fresh = await getSession(c.db, s.id);
      return render(c, (ctx) => views.growConfirmPage(ctx, fresh, err.code), undefined, 409);
    }
    return redirect(c, `/me/grow/${s.id}/done`);
  });

  r.get('/me/grow/:id/done', requireSelected, async (c) => {
    const s = await growSession(c);
    if (!s) return deny(c, 404);
    const mine = await get(c.db, "SELECT 1 AS ok FROM enrollments WHERE user_id = ? AND session_id = ? AND status = 'active'", c.user.id, s.id);
    if (!mine) return redirect(c, `/me/grow/${s.id}`, 302);
    return render(c, views.growDonePage, s);
  });

  r.post('/me/grow/enrollments/:eid/cancel', requireSelected, async (c) => {
    try {
      await cancelOwnGrow(c.db, c.user, intParam(c.params.eid));
      await c.session.flash('ok', '신청이 취소되었습니다.');
    } catch (err) {
      if (!(err instanceof EnrollError)) throw err;
      await c.session.flash('error', '취소할 수 없는 신청입니다.');
    }
    return redirect(c, '/me/programs');
  });

  r.get('/me/application', requireParticipant, (c) => application(c));

  // 이름만 수정할 수 있다(승인된 참여자). 최초 신청 시각·전화번호는 바뀌지 않는다.
  r.post('/me/application', requireSelected, async (c) => {
    const { name, error } = parseName(c.body);
    if (error) return application(c, { values: { name }, errors: { name: error } }, 422);
    await updateName(c.db, c.user.id, name);
    await c.session.flash('ok', '저장되었습니다.');
    return redirect(c, '/me/application');
  });

  r.get('/me/profile', requireParticipant, (c) => redirect(c, '/me/application', 301));
  r.get('/me/phone', requireParticipant, (c) => redirect(c, '/me/application#phone-change', 302));

  // 전화번호(로그인 아이디) 변경: 본인 계정만, 현재 비밀번호 재확인. 승인 여부와 관계없이 본인이 바꾼다.
  // 계정·승인 상태·최초 신청 시각·접수번호는 그대로이며 새 신청을 만들지 않는다. 이전 번호로는 더 로그인할 수 없다.
  r.post('/me/phone', requireParticipant, async (c) => {
    const { db, cfg, user } = c;
    const phoneInput = field(c, 'phone');
    const fail = (phoneErrors, status = 422) => application(c, { phoneValue: phoneInput, phoneErrors }, status);
    if (await loginBlock(db, { phone: user.phone })) return fail({ current_password: '시도가 많아 잠시 잠겼습니다. 잠시 후 다시 시도해 주세요.' }, 429);
    const ok = await verifyPassword(cfg.sessionSecret, field(c, 'current_password'), user.password_hash);
    await recordAttempt(db, { kind: 'pin', phone: user.phone, ip: c.ip, success: ok });
    if (!ok) return fail({ current_password: '현재 비밀번호가 맞지 않습니다.' });
    const phone = normalizePhone(phoneInput);
    if (!phone) return fail({ phone: '새 휴대전화 번호를 확인해 주세요. 예: 010-1234-5678' });
    if (phone === user.phone) return fail({ phone: '지금 쓰는 번호와 같습니다.' });
    if (!(await changePhone(db, user.id, user.id, phone, { keepTokenHash: c.session.tokenHash }))) {
      return fail({ phone: '이미 다른 계정에서 쓰는 번호입니다. 담당자에게 문의해 주세요.' }, 409);
    }
    await c.session.regenerate(user.id);
    await c.session.flash('ok', `전화번호가 ${formatPhone(phone)}(으)로 바뀌었습니다. 다음부터 새 번호와 지금 비밀번호로 로그인합니다.`);
    return redirect(c, '/me/application');
  });
}
