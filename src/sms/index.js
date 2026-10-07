/**
 * 문자 발송 어댑터.
 * 인터페이스: { kind, configured, devVisible, send(phone, message) → Promise<{ ok, reason? }> }
 */
export function createSmsSender(cfg, { logger = console, fetchImpl = (...a) => fetch(...a) } = {}) {
  if (cfg.smsProvider === 'solapi') return createSolapiSender(cfg, { logger, fetchImpl });
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

const enc = new TextEncoder();

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Solapi 인증 헤더: HMAC-SHA256(secret, date + salt), 16진수 서명 (공식 SDK와 같은 방식) */
export async function solapiAuthHeader(apiKey, apiSecret, now = new Date()) {
  const date = now.toISOString();
  const alphabet = '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const salt = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  const signature = await hmacHex(apiSecret, date + salt);
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/**
 * Solapi(https://solapi.com) 문자 발송.
 * POST https://api.solapi.com/messages/v4/send-many/detail  { messages: [{ to, from, text }] }
 * 응답의 failedMessageList가 있으면 실패로 본다. 로그에는 전화번호·문자 내용을 남기지 않는다.
 */
function createSolapiSender(cfg, { logger, fetchImpl }) {
  return {
    kind: 'solapi',
    configured: true,
    devVisible: false,
    async send(phone, text) {
      let res;
      try {
        res = await fetchImpl('https://api.solapi.com/messages/v4/send-many/detail', {
          method: 'POST',
          headers: {
            Authorization: await solapiAuthHeader(cfg.solapiApiKey, cfg.solapiApiSecret),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: [{ to: phone, from: cfg.smsSender, text }] }),
        });
      } catch (err) {
        logger.warn(`Solapi 요청 실패: ${err.message}`);
        return { ok: false, reason: 'network' };
      }
      let data = null;
      try { data = await res.json(); } catch { /* 본문 없음 */ }
      if (!res.ok) {
        logger.warn(`Solapi 오류 ${res.status}: ${data && (data.errorCode || data.errorMessage) ? `${data.errorCode} ${data.errorMessage}` : ''}`);
        return { ok: false, reason: 'provider_error' };
      }
      const failed = data && Array.isArray(data.failedMessageList) ? data.failedMessageList : [];
      if (failed.length) {
        logger.warn(`Solapi 접수 실패: ${failed.map((f) => `${f.statusCode || ''} ${f.statusMessage || ''}`).join('; ')}`);
        return { ok: false, reason: 'rejected' };
      }
      return { ok: true };
    },
  };
}
