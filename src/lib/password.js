import { hmac, safeEqual } from './crypto.js';

// 관리자 비밀번호. 저장 형식: p1$<반복 횟수>$<salt>$<PBKDF2-SHA256(HMAC(앱 비밀키, 비밀번호), salt)>
// 앱 비밀키를 섞어(pepper) DB만 유출되면 대입할 수 없게 하고, PBKDF2로 대입 속도를 늦춘다.
// Cloudflare Workers의 PBKDF2 반복 횟수 상한은 100,000이다.
const enc = new TextEncoder();
const ITERATIONS = 100000;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomString(length) {
  const a = new Uint8Array(length);
  crypto.getRandomValues(a);
  return [...a].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function derive(secret, password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(await hmac(secret, `pw:v1:${password}`)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256));
}

export async function hashPassword(secret, password) {
  const salt = randomString(22);
  return `p1$${ITERATIONS}$${salt}$${await derive(secret, password, salt, ITERATIONS)}`;
}

/** 저장값이 없거나 형식이 다르면 false. 계정이 없을 때도 같은 연산을 해 응답 시간 차이를 줄인다. */
export async function verifyPassword(secret, password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const valid = parts.length === 4 && parts[0] === 'p1' && /^\d+$/.test(parts[1]) && Number(parts[1]) <= ITERATIONS;
  const expected = await derive(secret, String(password ?? ''), valid ? parts[2] : 'x'.repeat(22), valid ? Number(parts[1]) : ITERATIONS);
  return valid && safeEqual(expected, parts[3]);
}

export function normalizeLoginId(v) {
  return String(v ?? '').trim().toLowerCase();
}

export function loginIdProblem(id) {
  return /^[a-z][a-z0-9_.-]{3,19}$/.test(id) ? null : '영문 소문자로 시작하는 4~20자(영문 소문자·숫자·_ . -)로 입력해 주세요.';
}

export function passwordProblem(pw, { loginId } = {}) {
  if (typeof pw !== 'string' || pw.length < 8) return '8자 이상으로 입력해 주세요.';
  if (pw.length > 64) return '64자 이하로 입력해 주세요.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 함께 사용해 주세요.';
  if (/^(.)\1+$/.test(pw)) return '같은 문자 반복은 사용할 수 없습니다.';
  if (loginId && pw.toLowerCase().includes(loginId)) return '아이디를 포함할 수 없습니다.';
  return null;
}

/** 관리자 비밀번호 초기화용 임시 비밀번호(영문 소문자·숫자 12자) */
export function temporaryPassword() {
  let pw;
  do pw = randomString(12); while (passwordProblem(pw));
  return pw;
}
