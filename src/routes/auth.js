import { loadConsent } from '../config.js';
import { normalizePhone } from '../lib/phone.js';
import { hashPassword, passwordProblem, verifyPassword } from '../lib/password.js';
import { verifyPin } from '../lib/pin.js';
import { loginBlock, PHONE_LOCK_MINUTES, recordAttempt, registerBlocked } from '../services/login.js';
import { completeReset, findValidReset } from '../services/passwordReset.js';
import { findUserByPhone, getApplication, isAdminRole, parseName, registerUser, setPassword } from '../services/users.js';
import { loginForm, passwordChangeForm, registerDonePage, registerForm, resetForm } from '../views/auth.js';
import { field, fieldList, redirect, render, requireLogin, requireParticipant } from './helpers.js';

export function afterLoginPath(user) {
  if (!user.password_hash) return isAdminRole(user) ? '/admin/account' : '/account/password';
  return user.role === 'participant' ? '/me' : '/admin';
}

const LOGIN_FAILED = '휴대전화 번호 또는 비밀번호가 맞지 않습니다.';

/**
 * 로그인(휴대전화 번호 + 비밀번호)·참여 신청·비밀번호 변경·재설정.
 * 로그인 실패 문구는 번호 등록 여부와 관계없이 같다. 번호별·IP별 실패 횟수로 잠근다.
 * 비밀번호가 아직 없는 기존 PIN 계정은 PIN으로 한 번 로그인한 뒤 새 비밀번호를 정해야 다른 화면을 쓸 수 있다.
 */
export function authRoutes(r) {
  // ── 로그인 ──
  r.get('/login', (c) => (c.user ? redirect(c, afterLoginPath(c.user), 302) : render(c, loginForm, {})));

  r.post('/login', async (c) => {
    const { db, cfg } = c;
    const phoneInput = field(c, 'phone');
    const phone = normalizePhone(phoneInput);
    const password = field(c, 'password');
    const fail = (error) => render(c, loginForm, { phone: phoneInput, error }, 422);
    if (!phone) return fail('휴대전화 번호를 확인해 주세요.');
    if (await loginBlock(db, { phone, ip: c.ip })) {
      return fail(`로그인 시도가 많아 잠시 잠겼습니다. ${PHONE_LOCK_MINUTES}분 뒤 다시 시도하거나 기관에 문의해 주세요.`);
    }
    const user = await findUserByPhone(db, phone);
    let ok;
    if (user && !user.password_hash && user.pin_hash && /^\d{6}$/.test(password)) {
      ok = await verifyPin(cfg.sessionSecret, password, user.pin_hash); // 기존 PIN 계정 전환용
    } else {
      ok = (await verifyPassword(cfg.sessionSecret, password, user && user.password_hash)) && !!user;
    }
    await recordAttempt(db, { kind: 'login', phone, ip: c.ip, success: ok });
    if (!ok) return fail(LOGIN_FAILED);
    await c.session.regenerate(user.id);
    return redirect(c, afterLoginPath(user));
  });

  // ── 참여 신청 ──
  r.get('/register', (c) => {
    if (c.user) return redirect(c, afterLoginPath(c.user), 302);
    return render(c, registerForm, { consent: loadConsent(c.cfg) });
  });

  r.post('/register', async (c) => {
    const { db, cfg } = c;
    if (c.user) return redirect(c, afterLoginPath(c.user)); // 이미 신청·로그인된 상태의 재전송
    const consent = loadConsent(cfg);
    const { name, error: nameError } = parseName(c.body);
    const phoneInput = field(c, 'phone');
    const phone = normalizePhone(phoneInput);
    const password = field(c, 'password');
    const agreed = fieldList(c, 'consent');
    const errors = {};
    if (nameError) errors.name = nameError;
    if (!phone) errors.phone = phoneInput ? '휴대전화 번호를 확인해 주세요.' : '휴대전화 번호를 입력해 주세요.';
    const problem = passwordProblem(password, { phone });
    if (problem) errors.password = problem;
    else if (password !== field(c, 'password_confirm')) errors.password_confirm = '비밀번호가 서로 다릅니다.';
    if (consent.items.some((i) => i.required && !agreed.includes(i.key))) errors.consent = '필수 항목에 동의해 주세요.';
    const values = { name, phone: phoneInput, consent: agreed };
    if (Object.keys(errors).length) return render(c, registerForm, { consent, values, errors }, 422);
    if (await registerBlocked(db, c.ip)) {
      return render(c, registerForm, { consent, values, errors: { phone: '잠시 후 다시 시도해 주세요.' } }, 429);
    }
    await recordAttempt(db, { kind: 'register', phone, ip: c.ip, success: true });
    const userId = await registerUser(db, {
      name, phone, passwordHash: await hashPassword(cfg.sessionSecret, password), consent, agreedKeys: agreed,
    });
    if (!userId) {
      return render(c, registerForm, { consent, values, errors: { phone: '이미 신청된 번호입니다. 로그인해 주세요.' } }, 409);
    }
    await c.session.regenerate(userId);
    return redirect(c, '/register/done');
  });

  r.get('/register/done', requireParticipant, async (c) => render(c, registerDonePage, await getApplication(c.db, c.user.id)));

  r.post('/logout', async (c) => {
    await c.session.destroy();
    return redirect(c, '/');
  });

  // ── 비밀번호 변경(본인). 기존 PIN 계정은 PIN 확인 후 첫 비밀번호를 정한다. ──
  r.get('/account/password', requireLogin, (c) => render(c, passwordChangeForm, {}));

  r.post('/account/password', requireLogin, async (c) => {
    const { db, cfg, user } = c;
    const fail = (errors, status = 422) => render(c, passwordChangeForm, { errors }, status);
    if (await loginBlock(db, { phone: user.phone })) return fail({ current: '시도가 많아 잠시 잠겼습니다. 잠시 후 다시 시도해 주세요.' }, 429);
    const current = field(c, 'current');
    const okCurrent = user.password_hash
      ? await verifyPassword(cfg.sessionSecret, current, user.password_hash)
      : await verifyPin(cfg.sessionSecret, current, user.pin_hash);
    await recordAttempt(db, { kind: 'pin', phone: user.phone, ip: c.ip, success: okCurrent });
    if (!okCurrent) return fail({ current: user.password_hash ? '현재 비밀번호가 맞지 않습니다.' : 'PIN이 맞지 않습니다.' });
    const password = field(c, 'password');
    const problem = passwordProblem(password, { phone: user.phone, loginId: user.login_id });
    if (problem) return fail({ password: problem });
    if (password === current) return fail({ password: '지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.' });
    if (password !== field(c, 'password_confirm')) return fail({ password_confirm: '비밀번호가 서로 다릅니다.' });
    await setPassword(db, user.id, await hashPassword(cfg.sessionSecret, password), c.session.tokenHash);
    await c.session.regenerate(user.id);
    await c.session.flash('ok', '비밀번호가 저장되었습니다. 다음부터 휴대전화 번호와 이 비밀번호로 로그인합니다.');
    return redirect(c, user.role === 'participant' ? '/me' : '/admin');
  });

  // ── 비밀번호 재설정: 담당자가 본인 확인 후 발급한 1회용 코드로 본인이 새 비밀번호를 정한다. ──
  r.get('/password/reset', (c) => render(c, resetForm, {}));

  r.post('/password/reset', async (c) => {
    const { db, cfg } = c;
    const phoneInput = field(c, 'phone');
    const phone = normalizePhone(phoneInput);
    const fail = (errors, status = 422) => render(c, resetForm, { phone: phoneInput, errors }, status);
    if (!phone) return fail({ phone: '휴대전화 번호를 확인해 주세요.' });
    const key = `reset:${phone}`;
    if (await loginBlock(db, { phone: key, ip: c.ip })) return fail({ code: '시도가 많아 잠시 잠겼습니다. 담당자에게 문의해 주세요.' }, 429);
    const user = await findUserByPhone(db, phone);
    const reset = user && (await findValidReset(db, user.id, field(c, 'code')));
    await recordAttempt(db, { kind: 'login', phone: key, ip: c.ip, success: !!reset });
    if (!reset) return fail({ code: '휴대전화 번호 또는 재설정 코드가 맞지 않거나 만료되었습니다.' });
    const password = field(c, 'password');
    const problem = passwordProblem(password, { phone, loginId: user.login_id });
    if (problem) return fail({ password: problem });
    if (password !== field(c, 'password_confirm')) return fail({ password_confirm: '비밀번호가 서로 다릅니다.' });
    if (!(await completeReset(db, reset, await hashPassword(cfg.sessionSecret, password)))) {
      return fail({ code: '이미 사용된 코드입니다.' }, 409);
    }
    await c.session.flash('ok', '비밀번호를 바꿨습니다. 새 비밀번호로 로그인해 주세요.');
    return redirect(c, isAdminRole(user) && user.login_id ? '/admin/login' : '/login');
  });
}
