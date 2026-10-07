import express from 'express';
import { counselingView, refreshIfStale } from '../como/mapping.js';
import { loadConsent } from '../config.js';
import { applyGrow, cancelOwnGrow, EnrollError, growApplyBlocker } from '../services/enrollments.js';
import { getSession, groupByTheme, listPrograms } from '../services/programs.js';
import { attendedFor, groupAttended, growSessionsFor, nextAction, upcomingFor } from '../services/schedule.js';
import { listConsents, updateProfile } from '../services/users.js';
import * as views from '../views/me.js';
import { deny, intParam, render, requireParticipant, requireSelected } from './helpers.js';

/** 참여자 영역. 모든 조회는 세션 사용자 ID 기준이며 다른 사용자 ID를 받지 않는다. */
export function meRoutes({ db, cfg, como, logger }) {
  const r = express.Router();

  async function counseling(user) {
    try {
      await refreshIfStale(db, como, user, cfg.comoStatusMaxAgeMinutes);
    } catch (err) {
      logger.warn(`꼬모 현황 갱신 실패: ${err.message}`);
    }
    return counselingView(db, como, user);
  }

  r.get('/me', requireParticipant, async (req, res) => {
    if (!req.user.is_selected) return render(req, res, views.notSelectedPage, undefined);
    const upcoming = upcomingFor(db, req.user.id);
    render(req, res, views.statusPage, {
      next: nextAction(upcoming),
      upcoming,
      attended: groupAttended(attendedFor(db, req.user.id)),
      counseling: await counseling(req.user),
    });
  });

  r.get('/me/programs', requireSelected, (req, res) => {
    render(req, res, views.programsPage, {
      groups: groupByTheme(listPrograms(db)),
      upcoming: upcomingFor(db, req.user.id),
      growSessions: growSessionsFor(db, req.user.id),
    });
  });

  // O 마음 → 전문 심리상담
  r.get('/me/open/counseling', requireSelected, async (req, res) => {
    render(req, res, views.counselingPage, await counseling(req.user));
  });

  // 상담신청하기: 선정 여부를 서버에서 확인한 뒤 꼬모로 이동. 전화번호 등은 전달하지 않는다.
  r.get('/me/counseling/apply', requireSelected, (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.redirect(302, cfg.comoApplyUrl);
  });

  function growSession(req, res) {
    const id = intParam(req.params.id);
    const s = id && getSession(db, id);
    if (!s || s.assign_mode !== 'select') {
      deny(req, res, 404);
      return null;
    }
    return s;
  }

  r.get('/me/grow/:id', requireSelected, (req, res) => {
    const s = growSession(req, res);
    if (!s) return;
    const blocker = growApplyBlocker(db, req.user, s.id);
    render(req, res, (ctx) => views.growConfirmPage(ctx, s, blocker), undefined);
  });

  r.post('/me/grow/:id', requireSelected, (req, res) => {
    const s = growSession(req, res);
    if (!s) return;
    try {
      applyGrow(db, req.user, s.id);
    } catch (err) {
      if (!(err instanceof EnrollError)) throw err;
      const fresh = getSession(db, s.id);
      return render(req, res, (ctx) => views.growConfirmPage(ctx, fresh, err.code), undefined, 409);
    }
    res.redirect(303, `/me/grow/${s.id}/done`);
  });

  r.get('/me/grow/:id/done', requireSelected, (req, res) => {
    const s = growSession(req, res);
    if (!s) return;
    const mine = db.prepare("SELECT 1 FROM enrollments WHERE user_id = ? AND session_id = ? AND status = 'active'").get(req.user.id, s.id);
    if (!mine) return res.redirect(`/me/grow/${s.id}`);
    render(req, res, views.growDonePage, s);
  });

  r.post('/me/grow/enrollments/:eid/cancel', requireSelected, (req, res) => {
    const eid = intParam(req.params.eid);
    try {
      cancelOwnGrow(db, req.user, eid);
      req.session.flash('ok', '신청이 취소되었습니다.');
    } catch (err) {
      if (!(err instanceof EnrollError)) throw err;
      req.session.flash('error', '취소할 수 없는 신청입니다.');
    }
    res.redirect(303, '/me/programs');
  });

  r.get('/me/profile', requireParticipant, (req, res) => {
    render(req, res, views.profilePage, { user: req.user, consents: listConsents(db, req.user.id), consentDoc: loadConsent(cfg) });
  });

  r.post('/me/profile', requireParticipant, (req, res) => {
    const name = String(req.body.name || '').trim();
    const region = String(req.body.region || '').trim();
    const errors = {};
    if (!name || name.length > 40) errors.name = '이름을 입력해 주세요.';
    if (!region || region.length > 60) errors.region = '거주 지역을 입력해 주세요.';
    if (Object.keys(errors).length) {
      return render(req, res, views.profilePage, { user: req.user, consents: listConsents(db, req.user.id),
        consentDoc: loadConsent(cfg), values: { name, region }, errors }, 422);
    }
    updateProfile(db, req.user.id, { name, region });
    req.session.flash('ok', '저장되었습니다.');
    res.redirect(303, '/me/profile');
  });

  return r;
}
