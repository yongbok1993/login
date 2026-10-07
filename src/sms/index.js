/**
 * 문자 발송 어댑터.
 * 인터페이스: { kind, configured, devVisible, send(phone, message) → Promise<{ ok, reason? }> }
 * 실제 발송 서비스·비용은 미정이다. 확정되면 같은 인터페이스의 어댑터를 추가하고 SMS_PROVIDER로 선택한다.
 */
export function createSmsSender(cfg, logger = console) {
  if (cfg.smsProvider === 'console') {
    return {
      kind: 'console',
      configured: true,
      // 개발 환경에서만 화면에 인증번호를 함께 보여 준다(실제 문자는 발송되지 않음).
      devVisible: !cfg.isProd,
      async send(phone, message) {
        logger.info(`[SMS:개발용, 실제 발송 안 됨] ${phone} ${message}`);
        return { ok: true };
      },
    };
  }
  return {
    kind: 'none',
    configured: false,
    devVisible: false,
    async send() {
      return { ok: false, reason: 'not_configured' };
    },
  };
}
