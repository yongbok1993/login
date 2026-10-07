import { hmac, numericCode, safeEqual } from './crypto.js';

// PIN 6자리. 저장 형식: h1$<salt>$<HMAC-SHA256(secret, "pin:v1:" + salt + ":" + pin)>
// 6자리 PIN은 경우의 수가 적어 느린 해시로도 오프라인 대입을 막기 어렵다.
// 대신 DB 밖의 비밀키(SESSION_SECRET)로 HMAC해, DB만 유출되면 대입할 수 없게 한다.
// SESSION_SECRET을 바꾸면 모든 PIN을 재설정해야 한다.

export const PIN_LENGTH = 6;

function isSequential(pin) {
  const d = [...pin].map(Number);
  const up = d.every((v, i) => i === 0 || v === (d[i - 1] + 1) % 10);
  const down = d.every((v, i) => i === 0 || v === (d[i - 1] + 9) % 10);
  return up || down;
}

/** PIN 형식·추측 쉬운 값 검사. 문제가 있으면 오류 문구, 없으면 null */
export function pinProblem(pin, { birthDate, phone } = {}) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return '숫자 6자리로 입력해 주세요.';
  if (/^(\d)\1{5}$/.test(pin) || isSequential(pin)) return '같은 숫자 반복이나 연속된 숫자는 사용할 수 없습니다.';
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return '반복되는 숫자는 사용할 수 없습니다.';
  if (birthDate) {
    const [y, m, d] = birthDate.split('-');
    if ([y.slice(2) + m + d, m + d + y.slice(2), y + m.slice(0, 2)].includes(pin)) return '생년월일은 사용할 수 없습니다.';
  }
  if (phone && phone.endsWith(pin)) return '전화번호 뒷자리는 사용할 수 없습니다.';
  return null;
}

export async function hashPin(secret, pin) {
  const salt = numericCode(6) + numericCode(6) + numericCode(4);
  return `h1$${salt}$${await hmac(secret, `pin:v1:${salt}:${pin}`)}`;
}

/** 저장값이 없거나 형식이 다르면 false. 계정이 없을 때도 같은 연산을 해 응답 시간 차이를 줄인다. */
export async function verifyPin(secret, pin, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const salt = parts.length === 3 && parts[0] === 'h1' ? parts[1] : '0000000000000000';
  const expected = await hmac(secret, `pin:v1:${salt}:${String(pin)}`);
  return parts.length === 3 && parts[0] === 'h1' && safeEqual(expected, parts[2]);
}

/** 관리자 초기화용 임시 PIN(추측 쉬운 값 제외) */
export function temporaryPin() {
  let pin;
  do pin = numericCode(PIN_LENGTH); while (pinProblem(pin));
  return pin;
}
