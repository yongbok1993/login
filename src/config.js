import fs from 'node:fs';

/**
 * 환경 변수 기반 설정.
 * 운영(NODE_ENV=production)에서는 개발용 문자 발송·꼬모 모의 어댑터를 사용할 수 없다.
 */
export function loadConfig(env = process.env, overrides = {}) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const cfg = {
    env: nodeEnv,
    isProd,
    port: Number(env.PORT || 3000),
    dbPath: env.DATABASE_PATH || 'data/login.db',
    sessionSecret: env.SESSION_SECRET || (isProd ? '' : 'dev-only-secret-change-me'),
    sessionIdleDays: Number(env.SESSION_IDLE_DAYS || 14),
    sessionMaxDays: Number(env.SESSION_MAX_DAYS || 60),
    trustProxy: env.TRUST_PROXY === '1',
    // 문자 발송: console(개발용, 서버 로그에 인증번호 출력) | none(미설정)
    // 실제 발송 서비스는 미정이다. 확정되면 src/sms/에 어댑터를 추가한다.
    smsProvider: env.SMS_PROVIDER || (isProd ? 'none' : 'console'),
    // 꼬모 연동: none(미연결) | mock(개발용 모의 데이터)
    // 실제 인터페이스는 미확인이다. 확인되면 src/como/에 어댑터를 추가한다.
    comoAdapter: env.COMO_ADAPTER || 'none',
    comoMockFile: env.COMO_MOCK_FILE || 'dev/como-mock.json',
    comoApplyUrl: env.COMO_APPLY_URL || 'https://cco-mho.pages.dev/',
    comoStatusMaxAgeMinutes: Number(env.COMO_STATUS_MAX_AGE_MINUTES || 30),
    consentFile: env.CONSENT_FILE || 'content/consent.json',
    ...overrides,
  };
  validateConfig(cfg);
  return cfg;
}

export function validateConfig(cfg) {
  if (cfg.isProd) {
    if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) {
      throw new Error('SESSION_SECRET(32자 이상)가 필요합니다.');
    }
    if (cfg.smsProvider === 'console') throw new Error('운영 환경에서는 SMS_PROVIDER=console을 사용할 수 없습니다.');
    if (cfg.comoAdapter === 'mock') throw new Error('운영 환경에서는 COMO_ADAPTER=mock을 사용할 수 없습니다.');
  }
  if (!['console', 'none'].includes(cfg.smsProvider)) throw new Error(`지원하지 않는 SMS_PROVIDER: ${cfg.smsProvider}`);
  if (!['none', 'mock'].includes(cfg.comoAdapter)) throw new Error(`지원하지 않는 COMO_ADAPTER: ${cfg.comoAdapter}`);
  if (!/^https:\/\//.test(cfg.comoApplyUrl)) throw new Error('COMO_APPLY_URL은 https 주소여야 합니다.');
}

/**
 * 동의문: 기관 확정 문안을 CONSENT_FILE(JSON)로 제공한다. 형식은 content/consent.example.json 참고.
 * 파일이 없으면 운영에서는 등록을 열지 않고, 개발에서는 개발용 표시가 붙은 임시 항목을 쓴다.
 */
export function loadConsent(cfg) {
  if (cfg.consent) return cfg.consent;
  try {
    const doc = JSON.parse(fs.readFileSync(cfg.consentFile, 'utf8'));
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
