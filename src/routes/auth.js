import { loadConsent } from '../config.js';
import { normalizePhone } from '../lib/phone.js';
import { hashPin, pinProblem, verifyPin } from '../lib/pin.js';
import { loginBlock, PHONE_LOCK_MINUTES, recordAttempt, registerBlocked } from '../services/login.js';
import { changePhone, findUserByPhone, getUser, parsePersonForm, registerUser, setPin } from '../services/users.js';
import { loginForm, phoneChangeForm, pinChangeForm, registerForm } from '../views/auth.js';
import { field, fieldList, redirect, render, requireLogin, requireParticipant } from './helpers.js';

function afterLoginPath(user) {
  if (user.pin_must_change) return '/account/pin';
  return user.role === 'participant' ? '/me' : '/admin';
}

const LOGIN_FAILED = '휴대전화 번호 또는 PIN이 맞지 않습니다.';

/**
 * 휴대전화 번호 + PIN 6자리 로그인·최초 등록.
 * 로그인 실패 문구는 번호 등록 여부와 관계없이 같다. 번호별·IP별 실패 횟수로 잠근다.
 */
export function authRoutes(r) {
  // ── 로그인 ──
  r.get('/login', (c) => (c.user ? redirect(c, afterLoginPath(c.user), 302) : render(c, loginForm, {})));

  r.post('/login', async (c) => {
    const { db, cfg } = c;
    const phoneInput = field(c, 'phone');
    const phone = normalizePhone(phoneInput);
    const pin = field(c, 'pin');
    const fail = (error) => render(c, loginForm, { phone: phoneInput, error }, 422);
    if (!phone) return fail('휴대전화 번호를 확인해 주세요.');
    const block = await loginBlock(db, { phone, ip: c.ip });
    if (block) return fail(`로그인 시도가 많아 잠시 잠겼습니다. ${PHONE_LOCK_MINUTES}분 뒤 다시 시도하거나 기관에 문의해 주세요.`);
    const user = await findUserByPhone(db, phone);
    const ok = await verifyPin(cfg.sessionSecret, pin, user && user.pin_hash);
    await recordAttempt(db, { kind: 'login', phone, ip: c.ip, success: ok && !!user });
    if (!ok || !user) return fail(LOGIN_FAILED);
    await c.session.regenerate(user.id);
    return redirect(c, afterLoginPath(user));
  });

  // ── 최초 등록 ──
  r.get('/register', (c) => {
    if (c.user) return redirect(c, afterLoginPath(c.user), 302);
    return render(c, registerForm, { consent: loadConsent(c.cfg) });
  });

  r.post('/register', async (c) => {
    const { db, cfg } = c;
    const consent = loadConsent(cfg);
    const { value, errors } = parsePersonForm(c.body);
    const phoneInput = field(c, 'phone');
    const phone = normalizePhone(phoneInput);
    const pin = field(c, 'pin');
    const agreed = fieldList(c, 'consent');
    if (!phone) errors.phone = '휴대전화 번호를 확인해 주세요.';
    const problem = pinProblem(pin, { birthDate: value.birth_date, phone });
    if (problem) errors.pin = problem;
    else if (pin !== field(c, 'pin_confirm')) errors.pin_confirm = 'PIN이 서로 다릅니다.';
    if (consent.items.some((i) => i.required && !agreed.includes(i.key))) errors.consent = '필수 항목에 동의해 주세요.';
    const values = { ...value, phone: phoneInput, consent: agreed };
    if (Object.keys(errors).length) return render(c, registerForm, { consent, values, errors }, 422);
    if (await registerBlocked(db, c.ip)) {
      return render(c, registerForm, { consent, values, errors: { phone: '잠시 후 다시 시도해 주세요.' } }, 429);
    }
    await recordAttempt(db, { kind: 'register', phone, ip: c.ip, success: true });
    const userId = await registerUser(db, {
      name: value.name, phone, address: value.address, addressDetail: value.address_detail, postcode: value.postcode,
      birthDate: value.birth_date,
      pinHash: await hashPin(cfg.sessionSecret, pin), consent, agreedKeys: agreed,
    });
    if (!userId) {
      return render(c, registerForm, { consent, values, errors: { phone: '이미 등록된 번호입니다. 로그인해 주세요.' } }, 409);
    }
    await c.session.regenerate(userId);
    await c.session.flash('ok', '등록이 완료되었습니다.');
    return redirect(c, '/me');
  });

  r.post('/logout', async (c) => {
    await c.session.destroy();
    return redirect(c, '/');
  });

  // ── PIN 변경(본인). 관리자가 초기화한 임시 PIN으로 로그인하면 여기로 온다. ──
  r.get('/account/pin', requireLogin, (c) => render(c, pinChangeForm, { forced: !!c.user.pin_must_change }));

  r.post('/account/pin', requireLogin, async (c) => {
    const { db, cfg, user } = c;
    const area = user.role === 'participant' ? 'me' : 'admin';
    const forced = !!user.pin_must_change;
    const fail = (errors) => render(c, pinChangeForm, { forced, errors, area }, 422);
    if (await loginBlock(db, { phone: user.phone })) return fail({ current_pin: '시도가 많아 잠시 잠겼습니다. 잠시 후 다시 시도해 주세요.' });
    const okCurrent = await verifyPin(cfg.sessionSecret, field(c, 'current_pin'), user.pin_hash);
    await recordAttempt(db, { kind: 'pin', phone: user.phone, ip: c.ip, success: okCurrent });
    if (!okCurrent) return fail({ current_pin: '현재 PIN이 맞지 않습니다.' });
    const pin = field(c, 'pin');
    const problem = pinProblem(pin, { birthDate: user.birth_date, phone: user.phone });
    if (problem) return fail({ pin: problem });
    if (await verifyPin(cfg.sessionSecret, pin, user.pin_hash)) return fail({ pin: '현재 PIN과 다른 번호를 입력해 주세요.' });
    if (pin !== field(c, 'pin_confirm')) return fail({ pin_confirm: 'PIN이 서로 다릅니다.' });
    await setPin(db, user.id, await hashPin(cfg.sessionSecret, pin), c.session.tokenHash);
    await c.session.regenerate(user.id);
    await c.session.flash('ok', 'PIN이 변경되었습니다.');
    return redirect(c, afterLoginPath(await getUser(db, user.id)));
  });

  // ── 전화번호 변경(현재 PIN 확인). 새 번호는 관리자가 다시 확인하기 전까지 꼬모 연동에 쓰지 않는다. ──
  r.get('/me/phone', requireParticipant, (c) => render(c, phoneChangeForm, {}));

  r.post('/me/phone', requireParticipant, async (c) => {
    const { db, cfg, user } = c;
    const phoneInput = field(c, 'phone');
    const phone = normalizePhone(phoneInput);
    const fail = (errors) => render(c, phoneChangeForm, { phone: phoneInput, errors }, 422);
    if (!phone) return fail({ phone: '휴대전화 번호를 확인해 주세요.' });
    if (phone === user.phone) return fail({ phone: '현재 번호와 같습니다.' });
    if (await loginBlock(db, { phone: user.phone })) return fail({ pin: '시도가 많아 잠시 잠겼습니다. 잠시 후 다시 시도해 주세요.' });
    const ok = await verifyPin(cfg.sessionSecret, field(c, 'pin'), user.pin_hash);
    await recordAttempt(db, { kind: 'pin', phone: user.phone, ip: c.ip, success: ok });
    if (!ok) return fail({ pin: 'PIN이 맞지 않습니다.' });
    if (!(await changePhone(db, user.id, phone, c.session.tokenHash))) return fail({ phone: '이미 사용 중인 번호입니다.' });
    await c.session.regenerate(user.id);
    await c.session.flash('ok', '번호가 변경되었습니다.');
    return redirect(c, '/me/profile');
  });
}
