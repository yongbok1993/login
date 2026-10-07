/**
 * Cloudflare Pages 환경 변수(env) 기반 설정.
 * APP_ENV를 지정하지 않으면 운영(production)으로 동작한다. 개발용 기능은 APP_ENV=development에서만 켜진다.
 * 운영에서는 개발용 문자 발송·꼬모 모의 어댑터를 사용할 수 없다.
 */
export function loadConfig(env = {}, overrides = {}) {
  const appEnv = env.APP_ENV || 'production';
  const isProd = appEnv === 'production';
  const cfg = {
    env: appEnv,
    isProd,
    sessionSecret: env.SESSION_SECRET || (isProd ? '' : 'dev-only-secret-change-me-000000000000'),
    sessionIdleDays: Number(env.SESSION_IDLE_DAYS || 14),
    sessionMaxDays: Number(env.SESSION_MAX_DAYS || 60),
    // 문자 발송: console(개발용, 인증번호를 로그·화면에 표시) | none(미설정)
    // 실제 발송 서비스는 미정이다. 확정되면 src/sms/에 어댑터를 추가한다.
    smsProvider: env.SMS_PROVIDER || (isProd ? 'none' : 'console'),
    // 꼬모 연동: none(미연결) | mock(개발용 모의 데이터, COMO_MOCK_JSON)
    // 실제 인터페이스는 미확인이다. 확인되면 src/como/에 어댑터를 추가한다.
    comoAdapter: env.COMO_ADAPTER || 'none',
    comoMockJson: env.COMO_MOCK_JSON || '',
    comoApplyUrl: env.COMO_APPLY_URL || 'https://cco-mho.pages.dev/',
    comoStatusMaxAgeMinutes: Number(env.COMO_STATUS_MAX_AGE_MINUTES || 30),
    // 기관 확정 동의문(JSON 문자열). 형식은 content/consent.example.json 참고.
    consentJson: env.CONSENT_JSON || '',
    ...overrides,
  };
  validateConfig(cfg);
  return cfg;
}

export function validateConfig(cfg) {
  if (!['production', 'development', 'test'].includes(cfg.env)) throw new Error(`지원하지 않는 APP_ENV: ${cfg.env}`);
  if (cfg.isProd) {
    if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) throw new Error('SESSION_SECRET(32자 이상)가 필요합니다.');
    if (cfg.smsProvider === 'console') throw new Error('운영 환경에서는 SMS_PROVIDER=console을 사용할 수 없습니다.');
    if (cfg.comoAdapter === 'mock') throw new Error('운영 환경에서는 COMO_ADAPTER=mock을 사용할 수 없습니다.');
  }
  if (!['console', 'none'].includes(cfg.smsProvider)) throw new Error(`지원하지 않는 SMS_PROVIDER: ${cfg.smsProvider}`);
  if (!['none', 'mock'].includes(cfg.comoAdapter)) throw new Error(`지원하지 않는 COMO_ADAPTER: ${cfg.comoAdapter}`);
  if (!/^https:\/\//.test(cfg.comoApplyUrl)) throw new Error('COMO_APPLY_URL은 https 주소여야 합니다.');
}

/**
 * 동의문: 기관 확정 문안을 CONSENT_JSON으로 제공한다.
 * 없으면 운영에서는 등록을 열지 않고(null), 개발에서는 개발용 표시가 붙은 임시 항목을 쓴다.
 */
export function loadConsent(cfg) {
  if (cfg.consent) return cfg.consent;
  try {
    const doc = JSON.parse(cfg.consentJson);
    if (!doc.version || !Array.isArray(doc.items) || doc.items.length === 0) throw new Error('invalid');
    return { ...doc, isDraft: false };
  } catch {
    if (cfg.isProd) return null;
    return {
      version: 'dev-draft',
      isDraft: true,
      items: [{ key: 'privacy', title: '개인정보 수집·이용 동의', required: true, body: '' }],
    };
  }
}
