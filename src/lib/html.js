// 자동 이스케이프 템플릿. 보간값은 기본적으로 이스케이프되고, html`` 결과나 raw()만 그대로 출력된다.
export class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export function raw(s) {
  return new SafeHtml(String(s));
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
