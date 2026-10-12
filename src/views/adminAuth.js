import { html } from '../lib/html.js';
import { csrfField, errorSummary, field, layout, textInput } from './layout.js';

function page(ctx, title, inner, area) {
  return layout(ctx, {
    title,
    area,
    body: html`<section class="sec narrow"><div class="wrap">
      <h1 class="page-title">${title}</h1>
      ${inner}
    </div></section>`,
  });
}

function input(id, label, { value = '', error, hint, type = 'text', autocomplete = 'off', maxlength } = {}) {
  return field({ id, label, error, hint,
    input: (d) => textInput({ id, value, type, autocomplete, maxlength, required: true, error, describedBy: d }) });
}

const PASSWORD_HINT = '8자 이상, 영문과 숫자를 함께 사용. 아이디는 포함할 수 없습니다.';

export function adminLoginForm(ctx, { loginId = '', error }) {
  return page(ctx, '관리자 로그인', html`
    <form method="post" action="/admin/login" class="form card" novalidate>
      ${csrfField(ctx)}
      ${error ? html`<p class="error-summary" role="alert">${error}</p>` : ''}
      ${input('login_id', '아이디', { value: loginId, autocomplete: 'username', maxlength: 20 })}
      ${input('password', '비밀번호', { type: 'password', autocomplete: 'current-password', maxlength: 64 })}
      <button type="submit" class="btn">로그인</button>
    </form>
    <p class="aside-link">참여자는 <a href="/login">휴대전화 번호로 로그인</a></p>
    <p class="aside-link">비밀번호를 잊은 경우 전체 관리자에게 초기화를 요청해 주세요.</p>`);
}

/**
 * 관리자 아이디·비밀번호 설정/변경. 처음(비밀번호 없음)에는 현재 PIN으로 본인 확인,
 * 이후에는 현재(또는 임시) 비밀번호로 확인한다.
 */
export function adminAccountForm(ctx, { values = {}, errors = {} }) {
  const u = ctx.user;
  const first = !u.password_hash;
  const forced = first || !!u.password_must_change;
  const currentLabel = first ? '현재 PIN 6자리' : u.password_must_change ? '임시 비밀번호' : '현재 비밀번호';
  return page(ctx, first ? '관리자 아이디·비밀번호 만들기' : '아이디·비밀번호 변경', html`
    ${forced ? html`<p class="flash info" role="status">${first
      ? '관리자는 아이디와 비밀번호로 로그인합니다. 사용할 아이디와 비밀번호를 정해 주세요. 이후에는 관리자 로그인 화면을 이용합니다.'
      : '임시 비밀번호로 로그인했습니다. 새 비밀번호를 정해 주세요.'}</p>` : ''}
    ${errorSummary(errors)}
    <form method="post" action="/admin/account" class="form card" novalidate>
      ${csrfField(ctx)}
      ${input('login_id', '아이디', { value: values.login_id ?? u.login_id ?? '', error: errors.login_id, autocomplete: 'username', maxlength: 20,
        hint: '영문 소문자로 시작하는 4~20자(영문 소문자·숫자·_ . -)' })}
      ${input('current', currentLabel, { type: 'password', error: errors.current, autocomplete: 'current-password', maxlength: 64 })}
      ${input('password', '새 비밀번호', { type: 'password', error: errors.password, autocomplete: 'new-password', maxlength: 64, hint: PASSWORD_HINT })}
      ${input('password_confirm', '새 비밀번호 확인', { type: 'password', error: errors.password_confirm, autocomplete: 'new-password', maxlength: 64 })}
      <button type="submit" class="btn">저장</button>
    </form>`, 'admin');
}
