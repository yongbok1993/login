import { html } from '../lib/html.js';
import { SITE } from '../site.js';
import { applicationSummary, REVIEW_NOTICE, statusMessage } from './application.js';
import { csrfField, errorSummary, field, layout, textInput } from './layout.js';

export const PASSWORD_SCRIPTS = ['/static/password.js'];

function page(ctx, title, inner, { area = 'public', scripts = PASSWORD_SCRIPTS } = {}) {
  return layout(ctx, {
    title,
    area,
    scripts,
    body: html`<section class="sec narrow"><div class="wrap">
      <h1 class="page-title">${title}</h1>
      ${inner}
    </div></section>`,
  });
}

function phoneField(value, error, label = '휴대전화 번호') {
  return field({ id: 'phone', label, error, hint: '하이픈(-) 없이 숫자만 입력해도 됩니다.',
    input: (d) => textInput({ id: 'phone', value, type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 20,
      required: true, error, describedBy: d }) });
}

/** 가려진 비밀번호 입력 + 보기/숨기기 버튼(스크립트가 있을 때만 보임) */
export function passwordField({ id, label, error, hint, autocomplete = 'new-password' }) {
  return field({ id, label, error, hint,
    input: (d) => html`<div class="pw-wrap">
      ${textInput({ id, type: 'password', autocomplete, maxlength: 64, required: true, error, describedBy: d })}
      <button type="button" class="pw-toggle" data-target="${id}" aria-controls="${id}" aria-pressed="false" hidden>보기</button>
    </div>` });
}

export const NEW_PASSWORD_HINT = '8자 이상, 영문과 숫자를 함께 사용해 주세요. 휴대전화 번호는 넣을 수 없습니다.';

function forgotHelp() {
  return html`<p class="aside-link">비밀번호를 잊으셨나요? ${SITE.orgName}(${SITE.tel})에 문의하면 본인 확인 후
    재설정 코드를 드립니다. <a href="/password/reset">재설정 코드로 비밀번호 바꾸기</a></p>`;
}

export function loginForm(ctx, { phone = '', error }) {
  return page(ctx, '로그인', html`
    <form method="post" action="/login" class="form card" novalidate>
      ${csrfField(ctx)}
      ${error ? html`<p class="error-summary" role="alert">${error}</p>` : ''}
      ${phoneField(phone)}
      ${passwordField({ id: 'password', label: '비밀번호', autocomplete: 'current-password' })}
      <button type="submit" class="btn">로그인</button>
    </form>
    <p class="aside-link">처음이신가요? <a href="/register">신청하기</a></p>
    ${forgotHelp()}
    <p class="aside-link">기존에 PIN 6자리로 등록하셨다면 비밀번호 칸에 PIN을 입력해 로그인한 뒤 새 비밀번호를 정해 주세요.</p>
    <p class="aside-link">기관 관리자는 <a href="/admin/login">관리자 로그인</a></p>`);
}

/** 참여 신청: 신청 시각(자동 기록 안내) → 이름 → 휴대전화 번호 → 비밀번호 → 비밀번호 확인 → 동의 → 신청하기 */
export function registerForm(ctx, { consent, values = {}, errors = {} }) {
  return page(ctx, '참여 신청', html`
    ${errorSummary(errors)}
    <form method="post" action="/register" class="form card" novalidate>
      ${csrfField(ctx)}
      <div class="field readonly-field">
        <span class="label" id="applied-at-label">신청 시각</span>
        <p class="readonly" aria-labelledby="applied-at-label">신청 시각은 접수 완료 시 자동으로 기록됩니다.</p>
      </div>
      ${field({ id: 'name', label: '이름', error: errors.name,
        input: (d) => textInput({ id: 'name', value: values.name, autocomplete: 'name', maxlength: 40, required: true,
          error: errors.name, describedBy: d }) })}
      ${phoneField(values.phone, errors.phone)}
      ${passwordField({ id: 'password', label: '비밀번호', error: errors.password, hint: NEW_PASSWORD_HINT })}
      ${passwordField({ id: 'password_confirm', label: '비밀번호 확인', error: errors.password_confirm })}
      <fieldset class="consents${errors.consent ? ' has-error' : ''}" id="consent">
        <legend>개인정보 수집·이용 동의</legend>
        ${consent.items.map((item) => html`
          <div class="consent-item">
            ${item.body ? html`<div class="consent-body" tabindex="0" role="region" aria-label="${item.title} 내용">${item.body}</div>` : ''}
            <label class="check">
              <input type="checkbox" name="consent" value="${item.key}"
                ${(values.consent || []).includes(item.key) ? html`checked` : ''}>
              <span>${item.title} (${item.required ? '필수' : '선택'})</span>
            </label>
          </div>`)}
        ${errors.consent ? html`<p class="error">${errors.consent}</p>` : ''}
      </fieldset>
      <p class="small muted">${REVIEW_NOTICE}</p>
      <button type="submit" class="btn">신청하기</button>
    </form>
    <p class="aside-link">이미 신청하셨나요? <a href="/login">로그인</a></p>`);
}

export function registerDonePage(ctx, app) {
  return page(ctx, '신청 완료', html`
    <div class="card">
      ${applicationSummary(app)}
      <p>${statusMessage(app)}</p>
      <p class="small muted">${REVIEW_NOTICE}</p>
      <p class="actions"><a class="btn" href="/me">내 신청정보</a></p>
    </div>`, { area: 'me', scripts: [] });
}

/** 비밀번호 변경. 기존 PIN 계정은 PIN으로 확인한 뒤 새 비밀번호를 정한다. */
export function passwordChangeForm(ctx, { errors = {} }) {
  const u = ctx.user;
  const viaPin = !u.password_hash;
  return page(ctx, viaPin ? '새 비밀번호 정하기' : '비밀번호 변경', html`
    ${viaPin ? html`<p class="flash info" role="status">로그인 방식이 휴대전화 번호 + 비밀번호로 바뀌었습니다.
      지금 쓰던 PIN을 확인한 뒤 새 비밀번호를 정해 주세요. 정한 뒤에는 PIN을 쓸 수 없습니다.</p>` : ''}
    ${errorSummary(errors)}
    <form method="post" action="/account/password" class="form card" novalidate>
      ${csrfField(ctx)}
      ${passwordField({ id: 'current', label: viaPin ? '지금 쓰는 PIN 6자리' : '현재 비밀번호', error: errors.current,
        autocomplete: 'current-password' })}
      ${passwordField({ id: 'password', label: '새 비밀번호', error: errors.password, hint: NEW_PASSWORD_HINT })}
      ${passwordField({ id: 'password_confirm', label: '새 비밀번호 확인', error: errors.password_confirm })}
      <button type="submit" class="btn">저장</button>
    </form>`, { area: u.role === 'participant' ? 'me' : 'admin' });
}

export function resetForm(ctx, { phone = '', errors = {} }) {
  return page(ctx, '비밀번호 재설정', html`
    <p>담당자(${SITE.orgName}, ${SITE.tel})에게 본인 확인을 받은 뒤 받은 재설정 코드를 입력해 주세요. 코드는 24시간 동안 한 번만 쓸 수 있습니다.</p>
    ${errorSummary(errors)}
    <form method="post" action="/password/reset" class="form card" novalidate>
      ${csrfField(ctx)}
      ${phoneField(phone, errors.phone)}
      ${field({ id: 'code', label: '재설정 코드', error: errors.code, hint: '예: ABCD-1234',
        input: (d) => textInput({ id: 'code', autocomplete: 'one-time-code', maxlength: 12, required: true, error: errors.code,
          describedBy: d }) })}
      ${passwordField({ id: 'password', label: '새 비밀번호', error: errors.password, hint: NEW_PASSWORD_HINT })}
      ${passwordField({ id: 'password_confirm', label: '새 비밀번호 확인', error: errors.password_confirm })}
      <button type="submit" class="btn">비밀번호 바꾸기</button>
    </form>`);
}
