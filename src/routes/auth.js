import { loadConsent } from '../config.js';
import { normalizePhone } from '../lib/phone.js';
import { invalidateOtp, issueOtp, verifyOtp } from '../services/otp.js';
import { changePhone, findUserByPhone, registerUser } from '../services/users.js';
import { codeForm, phoneForm, registerDetailsForm, registrationClosed } from '../views/auth.js';
import { field, fieldList, redirect, render, requireLogin } from './helpers.js';

const VERIFIED_PHONE_TTL_MS = 15 * 60 * 1000;
const TITLES = { login: '로그인', register: '참여 등록', change: '번호 변경' };
const VERIFY_ERRORS = {
  expired: '인증번호가 만료되었습니다. 다시 받아 주세요.',
  too_many: '입력 횟수를 초과했습니다. 인증번호를 다시 받아 주세요.',
  mismatch: '인증번호가 일치하지 않습니다.',
};

function afterLoginPath(user) {
  return user.role === 'participant' ? '/me' : '/admin';
}

/**
 * 전화번호 인증 기반 로그인·최초 등록.
 * 등록 여부는 인증번호 확인 이후에만 드러난다(번호만으로 참여 여부를 조회할 수 없게).
 */
export function authRoutes(r) {
  async function sendCode(c, { entry, purpose, formAction, area }) {
    const { db, cfg, sms } = c;
    const phoneInput = field(c, 'phone');
    const phone = normalizePhone(phoneInput);
    const fail = (error) => render(c, phoneForm, { title: TITLES[entry], action: formAction, phone: phoneInput, error, area }, 422);
    if (!phone) return fail('휴대전화 번호를 확인해 주세요.');
    if (entry === 'change' && phone === c.user.phone) return fail('현재 번호와 같습니다.');
    if (!sms.configured) return fail('인증 문자를 보낼 수 없습니다. 기관에 문의해 주세요.');
    const issued = await issueOtp(db, cfg.sessionSecret, { phone, purpose, ip: c.ip });
    if (!issued.ok) return fail('잠시 후 다시 시도해 주세요.');
    const sent = await sms.send(phone, `[로그人] 인증번호 ${issued.code}`);
    if (!sent.ok) {
      await invalidateOtp(db, issued.id);
      c.logger.warn(`SMS 발송 실패: ${sent.reason}`);
      return fail('인증 문자를 보낼 수 없습니다. 기관에 문의해 주세요.');
    }
    c.session.data.otp = { phone, purpose, entry, devCode: sms.devVisible ? issued.code : undefined };
    await c.session.save();
    return redirect(c, entry === 'change' ? '/me/phone/verify' : '/verify');
  }

  function verifiedPhone(c) {
    const v = c.session.data.verifiedPhone;
    if (!v || Date.now() - v.at > VERIFIED_PHONE_TTL_MS) return null;
    return v.phone;
  }

  const authCodeForm = (c, otp, error, status = 200) => render(c, codeForm, {
    title: TITLES[otp.entry], action: '/verify', resendAction: otp.entry === 'register' ? '/register' : '/login',
    phone: otp.phone, devCode: otp.devCode, error,
  }, status);

  // ── 로그인 ──
  r.get('/login', (c) => (c.user ? redirect(c, afterLoginPath(c.user), 302) : render(c, phoneForm, { title: '로그인', action: '/login' })));
  r.post('/login', (c) => sendCode(c, { entry: 'login', purpose: 'auth', formAction: '/login' }));

  // ── 최초 등록 ──
  r.get('/register', (c) => {
    if (c.user) return redirect(c, afterLoginPath(c.user), 302);
    if (!loadConsent(c.cfg)) return render(c, registrationClosed, undefined, 200, { session: false });
    return render(c, phoneForm, { title: '참여 등록', action: '/register' });
  });
  r.post('/register', (c) => {
    if (!loadConsent(c.cfg)) return render(c, registrationClosed, undefined, 200, { session: false });
    return sendCode(c, { entry: 'register', purpose: 'auth', formAction: '/register' });
  });

  // ── 인증번호 확인 (로그인·등록 공통) ──
  r.get('/verify', (c) => {
    const otp = c.session.data.otp;
    if (!otp || otp.purpose !== 'auth') return redirect(c, '/login', 302);
    return authCodeForm(c, otp);
  });
  r.post('/verify', async (c) => {
    const { db, cfg } = c;
    const otp = c.session.data.otp;
    if (!otp || otp.purpose !== 'auth') return redirect(c, '/login');
    const result = await verifyOtp(db, cfg.sessionSecret, { phone: otp.phone, purpose: 'auth', code: field(c, 'code').trim() });
    if (result !== 'ok') return authCodeForm(c, otp, VERIFY_ERRORS[result], 422);
    const user = await findUserByPhone(db, otp.phone);
    if (user) {
      await c.session.regenerate(user.id);
      if (otp.entry === 'register') await c.session.flash('info', '이미 등록된 번호입니다. 로그인되었습니다.');
      return redirect(c, afterLoginPath(user));
    }
    // 등록되지 않은 번호: 인증된 번호를 들고 등록 정보 입력으로 이동(재인증 없음)
    await c.session.regenerate(null, { verifiedPhone: { phone: otp.phone, at: Date.now() } });
    if (otp.entry === 'login') await c.session.flash('info', '등록된 정보가 없습니다. 참여 등록을 진행해 주세요.');
    return redirect(c, '/register/details');
  });

  r.get('/register/details', (c) => {
    const consent = loadConsent(c.cfg);
    if (!consent) return render(c, registrationClosed, undefined, 200, { session: false });
    const phone = verifiedPhone(c);
    if (!phone) return redirect(c, '/register', 302);
    return render(c, registerDetailsForm, { phone, consent });
  });

  r.post('/register/details', async (c) => {
    const consent = loadConsent(c.cfg);
    if (!consent) return render(c, registrationClosed, undefined, 200, { session: false });
    const phone = verifiedPhone(c);
    if (!phone) return redirect(c, '/register');
    const name = field(c, 'name').trim();
    const region = field(c, 'region').trim();
    const agreed = fieldList(c, 'consent');
    const errors = {};
    if (!name || name.length > 40) errors.name = '이름을 입력해 주세요.';
    if (!region || region.length > 60) errors.region = '거주 지역을 입력해 주세요.';
    if (consent.items.some((i) => i.required && !agreed.includes(i.key))) errors.consent = '필수 항목에 동의해 주세요.';
    if (Object.keys(errors).length) {
      return render(c, registerDetailsForm, { phone, consent, values: { name, region, consent: agreed }, errors }, 422);
    }
    const userId = await registerUser(c.db, { name, phone, region, consent, agreedKeys: agreed });
    if (!userId) {
      await c.session.regenerate(null);
      await c.session.flash('info', '이미 등록된 번호입니다. 로그인해 주세요.');
      return redirect(c, '/login');
    }
    await c.session.regenerate(userId);
    await c.session.flash('ok', '등록이 완료되었습니다.');
    return redirect(c, '/me');
  });

  r.post('/logout', async (c) => {
    await c.session.destroy();
    return redirect(c, '/');
  });

  // ── 전화번호 변경: 새 번호 인증 후 반영, 꼬모 연결은 재확인 대상으로 ──
  const changeCodeForm = (c, otp, error, status = 200) => render(c, codeForm, {
    title: '번호 변경', action: '/me/phone/verify', resendAction: '/me/phone', phone: otp.phone, devCode: otp.devCode, error, area: 'me',
  }, status);

  r.get('/me/phone', requireLogin, (c) => render(c, phoneForm, { title: '번호 변경', action: '/me/phone', area: 'me' }));
  r.post('/me/phone', requireLogin, (c) => sendCode(c, { entry: 'change', purpose: 'change_phone', formAction: '/me/phone', area: 'me' }));
  r.get('/me/phone/verify', requireLogin, (c) => {
    const otp = c.session.data.otp;
    if (!otp || otp.purpose !== 'change_phone') return redirect(c, '/me/phone', 302);
    return changeCodeForm(c, otp);
  });
  r.post('/me/phone/verify', requireLogin, async (c) => {
    const { db, cfg } = c;
    const otp = c.session.data.otp;
    if (!otp || otp.purpose !== 'change_phone') return redirect(c, '/me/phone');
    const result = await verifyOtp(db, cfg.sessionSecret, { phone: otp.phone, purpose: 'change_phone', code: field(c, 'code').trim() });
    if (result !== 'ok') return changeCodeForm(c, otp, result === 'mismatch' ? VERIFY_ERRORS.mismatch : '인증번호를 다시 받아 주세요.', 422);
    if (!(await changePhone(db, c.user.id, otp.phone, c.session.tokenHash))) {
      delete c.session.data.otp;
      await c.session.save();
      return changeCodeForm(c, otp, '이미 사용 중인 전화번호입니다.', 422);
    }
    await c.session.regenerate(c.user.id);
    await c.session.flash('ok', '번호가 변경되었습니다.');
    return redirect(c, '/me/profile');
  });
}
