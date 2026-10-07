import { counselingView, refreshIfStale } from '../como/mapping.js';
import { loadConsent } from '../config.js';
import { get } from '../lib/db.js';
import { applyGrow, cancelOwnGrow, EnrollError, growApplyBlocker } from '../services/enrollments.js';
import { getSession, groupByTheme, listPrograms } from '../services/programs.js';
import { attendedFor, groupAttended, growSessionsFor, nextAction, upcomingFor } from '../services/schedule.js';
import { listConsents, updateProfile } from '../services/users.js';
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

  r.get('/me', requireParticipant, async (c) => {
    if (!c.user.is_selected) return render(c, views.notSelectedPage, undefined);
    const upcoming = await upcomingFor(c.db, c.user.id);
    return render(c, views.statusPage, {
      next: nextAction(upcoming),
      upcoming,
      attended: groupAttended(await attendedFor(c.db, c.user.id)),
      counseling: await counseling(c),
    });
  });

  r.get('/me/programs', requireSelected, async (c) => render(c, views.programsPage, {
    groups: groupByTheme(await listPrograms(c.db)),
    upcoming: await upcomingFor(c.db, c.user.id),
    growSessions: await growSessionsFor(c.db, c.user.id),
  }));

  // O 마음 → 전문 심리상담
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

  const profile = async (c, extra = {}, status = 200) => render(c, views.profilePage, {
    user: c.user, consents: await listConsents(c.db, c.user.id), consentDoc: loadConsent(c.cfg), ...extra,
  }, status);

  r.get('/me/profile', requireParticipant, (c) => profile(c));

  r.post('/me/profile', requireParticipant, async (c) => {
    const name = field(c, 'name').trim();
    const region = field(c, 'region').trim();
    const errors = {};
    if (!name || name.length > 40) errors.name = '이름을 입력해 주세요.';
    if (!region || region.length > 60) errors.region = '거주 지역을 입력해 주세요.';
    if (Object.keys(errors).length) return profile(c, { values: { name, region }, errors }, 422);
    await updateProfile(c.db, c.user.id, { name, region });
    await c.session.flash('ok', '저장되었습니다.');
    return redirect(c, '/me/profile');
  });
}
