const TZ = 'Asia/Seoul';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function nowIso(now = new Date()) {
  return now.toISOString();
}

export function addMs(iso, ms) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

/** 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export function todaySeoul(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isValidTime(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** 2027-03-05 → 2027년 3월 5일 (금) */
export function formatDate(s) {
  if (!s || !isValidDate(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

/** UTC ISO 시각 → 한국 시간 표기 */
export function formatDateTime(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(t).map((p) => [p.type, p.value]));
  return `${formatDate(`${parts.year}-${parts.month}-${parts.day}`)} ${parts.hour}:${parts.minute}`;
}

export function formatTimeRange(start, end) {
  if (!start) return '';
  return end ? `${start}~${end}` : start;
}

/**
 * 생년월일 입력 정규화: 19700101, 1970-01-01, 1970.1.1, 1970 01 01 → 1970-01-01.
 * 실제로 없는 날짜, 1900년 이전, 오늘 이후는 null.
 */
export function parseBirthDate(input, now = new Date()) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s) || /^(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})\.?$/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (!isValidDate(iso) || iso < '1900-01-01' || iso > todaySeoul(now)) return null;
  return iso;
}
