/**
 * 전화번호 정규화: 숫자만 남기고 국가번호(+82)를 0으로 바꾼다.
 * 로그人과 꼬모 매핑에 같은 함수를 사용해 표기 차이로 인한 불일치를 막는다.
 * 휴대전화(010 등)만 허용한다. 유효하지 않으면 null.
 */
export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('+82')) s = `0${s.slice(3).replace(/^0/, '')}`;
  if (!/^\d+$/.test(s)) return null;
  if (!/^01[016789]\d{7,8}$/.test(s)) return null;
  return s;
}

export function formatPhone(p) {
  if (!p) return '';
  if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`;
  if (p.length === 10) return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
  return p;
}

export function maskPhone(p) {
  if (!p) return '';
  return `${p.slice(0, 3)}-****-${p.slice(-4)}`;
}
