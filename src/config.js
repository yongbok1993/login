import { DEFAULT_CONSENT } from './content/consent.js';

/**
 * Cloudflare Pages 환경 변수(env) 기반 설정.
 * APP_ENV를 지정하지 않으면 운영(production)으로 동작한다. 개발용 기능은 APP_ENV=development에서만 켜진다.
 * 운영에서는 꼬모 모의 어댑터를 사용할 수 없다.
 */
export function loadConfig(env = {}, overrides = {}) {
  const appEnv = env.APP_ENV || 'production';
  const isProd = appEnv === 'production';
  const cfg = {
    env: appEnv,
    isProd,
    // 세션·PIN 해시 키의 초깃값(선택). 앱은 처음 실행될 때 이 값(32자 이상일 때) 또는 무작위 값을 DB에 저장하고,
    // 이후에는 DB 값을 쓴다(src/services/settings.js). 운영에서 따로 설정하지 않아도 된다.
    sessionSecret: env.SESSION_SECRET || (isProd ? '' : 'dev-only-secret-change-me-000000000000'),
    sessionIdleDays: Number(env.SESSION_IDLE_DAYS || 14),
    sessionMaxDays: Number(env.SESSION_MAX_DAYS || 60),
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
    if (cfg.comoAdapter === 'mock') throw new Error('운영 환경에서는 COMO_ADAPTER=mock을 사용할 수 없습니다.');
  }
  if (!['none', 'mock'].includes(cfg.comoAdapter)) throw new Error(`지원하지 않는 COMO_ADAPTER: ${cfg.comoAdapter}`);
  if (!/^https:\/\//.test(cfg.comoApplyUrl)) throw new Error('COMO_APPLY_URL은 https 주소여야 합니다.');
}

/**
 * 동의문: CONSENT_JSON 환경 변수(형식: content/consent.example.json)가 있으면 그 문안, 없으면 기본 문안(src/content/consent.js).
 */
export function loadConsent(cfg) {
  if (cfg.consent) return cfg.consent;
  try {
    const doc = JSON.parse(cfg.consentJson);
    if (!doc.version || !Array.isArray(doc.items) || doc.items.length === 0) throw new Error('invalid');
    return doc;
  } catch {
    return DEFAULT_CONSENT;
  }
}
