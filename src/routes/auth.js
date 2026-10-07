import express from 'express';
import { normalizePhone } from '../lib/phone.js';
import { issueOtp, verifyOtp } from '../services/otp.js';
import { changePhone, findUserByPhone, registerUser } from '../services/users.js';
import { codeForm, phoneForm, registerDetailsForm, registrationClosed } from '../views/auth.js';
import { loadConsent } from '../config.js';
import { requireLogin, render } from './helpers.js';

const VERIFIED_PHONE_TTL_MS = 15 * 60 * 1000;
const TITLES = { login: '로그인', register: '참여 등록', change: '번호 변경' };

/**
 * 전화번호 인증 기반 로그인·최초 등록.
 * 등록 여부는 인증번호 확인 이후에만 드러난다(번호만으로 참여 여부를 조회할 수 없게).
 */
export function authRoutes({ db, cfg, sms, logger }) {
  const r = express.Router();

  async function sendCode(req, res, { entry, purpose, phoneInput, formAction, area }) {
    const phone = normalizePhone(phoneInput);
    const renderForm = (error) => render(req, res, phoneForm, { title: TITLES[entry], action: formAction, phone: phoneInput, error, area }, 422);
    if (!phone) return renderForm('휴대전화 번호를 확인해 주세요.');
    if (entry === 'change' && phone === req.user.phone) return renderForm('현재 번호와 같습니다.');
    if (!sms.configured) return renderForm('인증 문자를 보낼 수 없습니다. 기관에 문의해 주세요.');
    const issued = issueOtp(db, cfg.sessionSecret, { phone, purpose, ip: req.ip });
    if (!issued.ok) return renderForm('잠시 후 다시 시도해 주세요.');
    const sent = await sms.send(phone, `[로그人] 인증번호 ${issued.code}`);
    if (!sent.ok) {
      db.prepare('UPDATE otp_codes SET consumed_at = created_at WHERE id = ?').run(issued.id);
      logger.warn(`SMS 발송 실패: ${sent.reason}`);
      return renderForm('인증 문자를 보낼 수 없습니다. 기관에 문의해 주세요.');
    }
    req.session.data.otp = { phone, purpose, entry, devCode: sms.devVisible ? issued.code : undefined };
    req.session.save();
    return res.redirect(303, entry === 'change' ? '/me/phone/verify' : '/verify');
  }

  function afterLoginPath(user) {
    return user.role === 'participant' ? '/me' : '/admin';
  }

  // ── 로그인 ──
  r.get('/login', (req, res) => {
    if (req.user) return res.redirect(afterLoginPath(req.user));
    render(req, res, phoneForm, { title: '로그인', action: '/login' });
  });
  r.post('/login', (req, res) => sendCode(req, res, { entry: 'login', purpose: 'auth', phoneInput: req.body.phone, formAction: '/login' }));

  // ── 최초 등록 ──
  r.get('/register', (req, res) => {
    if (req.user) return res.redirect(afterLoginPath(req.user));
    if (!loadConsent(cfg)) return render(req, res, registrationClosed, undefined);
    render(req, res, phoneForm, { title: '참여 등록', action: '/register' });
  });
  r.post('/register', (req, res) => {
    if (!loadConsent(cfg)) return render(req, res, registrationClosed, undefined);
    return sendCode(req, res, { entry: 'register', purpose: 'auth', phoneInput: req.body.phone, formAction: '/register' });
  });

  // ── 인증번호 확인 (로그인·등록 공통) ──
  r.get('/verify', (req, res) => {
    const otp = req.session.data.otp;
    if (!otp || otp.purpose !== 'auth') return res.redirect('/login');
    render(req, res, codeForm, { title: TITLES[otp.entry], action: '/verify', resendAction: otp.entry === 'register' ? '/register' : '/login',
      phone: otp.phone, devCode: otp.devCode });
  });
  r.post('/verify', (req, res) => {
    const otp = req.session.data.otp;
    if (!otp || otp.purpose !== 'auth') return res.redirect(303, '/login');
    const result = verifyOtp(db, cfg.sessionSecret, { phone: otp.phone, purpose: 'auth', code: String(req.body.code || '').trim() });
    if (result !== 'ok') {
      const error = { expired: '인증번호가 만료되었습니다. 다시 받아 주세요.', too_many: '입력 횟수를 초과했습니다. 인증번호를 다시 받아 주세요.' }[result]
        || '인증번호가 일치하지 않습니다.';
      return render(req, res, codeForm, { title: TITLES[otp.entry], action: '/verify', resendAction: otp.entry === 'register' ? '/register' : '/login',
        phone: otp.phone, devCode: otp.devCode, error }, 422);
    }
    const user = findUserByPhone(db, otp.phone);
    if (user) {
      req.session.regenerate(user.id);
      if (otp.entry === 'register') req.session.flash('info', '이미 등록된 번호입니다. 로그인되었습니다.');
      return res.redirect(303, afterLoginPath(user));
    }
    // 등록되지 않은 번호: 인증된 번호를 들고 등록 정보 입력으로 이동(재인증 없음)
    req.session.regenerate(null, { verifiedPhone: { phone: otp.phone, at: Date.now() } });
    if (otp.entry === 'login') req.session.flash('info', '등록된 정보가 없습니다. 참여 등록을 진행해 주세요.');
    return res.redirect(303, '/register/details');
  });

  function verifiedPhone(req) {
    const v = req.session.data.verifiedPhone;
    if (!v || Date.now() - v.at > VERIFIED_PHONE_TTL_MS) return null;
    return v.phone;
  }

  r.get('/register/details', (req, res) => {
    const consent = loadConsent(cfg);
    if (!consent) return render(req, res, registrationClosed, undefined);
    const phone = verifiedPhone(req);
    if (!phone) return res.redirect('/register');
    render(req, res, registerDetailsForm, { phone, consent });
  });

  r.post('/register/details', (req, res) => {
    const consent = loadConsent(cfg);
    if (!consent) return render(req, res, registrationClosed, undefined);
    const phone = verifiedPhone(req);
    if (!phone) return res.redirect(303, '/register');
    const name = String(req.body.name || '').trim();
    const region = String(req.body.region || '').trim();
    const agreed = [].concat(req.body.consent || []).map(String);
    const errors = {};
    if (!name || name.length > 40) errors.name = '이름을 입력해 주세요.';
    if (!region || region.length > 60) errors.region = '거주 지역을 입력해 주세요.';
    if (consent.items.some((i) => i.required && !agreed.includes(i.key))) errors.consent = '필수 항목에 동의해 주세요.';
    if (Object.keys(errors).length) {
      return render(req, res, registerDetailsForm, { phone, consent, values: { name, region, consent: agreed }, errors }, 422);
    }
    const userId = registerUser(db, { name, phone, region, consent, agreedKeys: agreed });
    if (!userId) {
      req.session.regenerate(null);
      req.session.flash('info', '이미 등록된 번호입니다. 로그인해 주세요.');
      return res.redirect(303, '/login');
    }
    req.session.regenerate(userId);
    req.session.flash('ok', '등록이 완료되었습니다.');
    return res.redirect(303, '/me');
  });

  r.post('/logout', (req, res) => {
    req.session.destroy();
    res.redirect(303, '/');
  });

  // ── 전화번호 변경: 새 번호 인증 후 반영, 꼬모 연결은 재확인 대상으로 ──
  r.get('/me/phone', requireLogin, (req, res) => {
    render(req, res, phoneForm, { title: '번호 변경', action: '/me/phone', area: 'me' });
  });
  r.post('/me/phone', requireLogin, (req, res) => sendCode(req, res, {
    entry: 'change', purpose: 'change_phone', phoneInput: req.body.phone, formAction: '/me/phone', area: 'me',
  }));
  r.get('/me/phone/verify', requireLogin, (req, res) => {
    const otp = req.session.data.otp;
    if (!otp || otp.purpose !== 'change_phone') return res.redirect('/me/phone');
    render(req, res, codeForm, { title: '번호 변경', action: '/me/phone/verify', resendAction: '/me/phone', phone: otp.phone,
      devCode: otp.devCode, area: 'me' });
  });
  r.post('/me/phone/verify', requireLogin, (req, res) => {
    const otp = req.session.data.otp;
    if (!otp || otp.purpose !== 'change_phone') return res.redirect(303, '/me/phone');
    const result = verifyOtp(db, cfg.sessionSecret, { phone: otp.phone, purpose: 'change_phone', code: String(req.body.code || '').trim() });
    const fail = (error) => render(req, res, codeForm, { title: '번호 변경', action: '/me/phone/verify', resendAction: '/me/phone',
      phone: otp.phone, devCode: otp.devCode, error, area: 'me' }, 422);
    if (result !== 'ok') return fail(result === 'mismatch' ? '인증번호가 일치하지 않습니다.' : '인증번호를 다시 받아 주세요.');
    if (!changePhone(db, req.user.id, otp.phone, req.session.tokenHash)) {
      delete req.session.data.otp;
      req.session.save();
      return fail('이미 사용 중인 전화번호입니다.');
    }
    req.session.regenerate(req.user.id);
    req.session.flash('ok', '번호가 변경되었습니다.');
    return res.redirect(303, '/me/profile');
  });

  return r;
}
