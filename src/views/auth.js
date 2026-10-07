import { html } from '../lib/html.js';
import { maskPhone } from '../lib/phone.js';
import { csrfField, errorSummary, field, layout, textInput } from './layout.js';

function page(ctx, title, inner, area = 'public') {
  return layout(ctx, {
    title,
    area,
    body: html`<section class="sec narrow"><div class="wrap">
      <h1 class="page-title">${title}</h1>
      ${inner}
    </div></section>`,
  });
}

/** 전화번호 입력 → 인증번호 발송 (로그인·등록·번호 변경 공통) */
export function phoneForm(ctx, { title, action, phone = '', error, area }) {
  return page(ctx, title, html`
    <form method="post" action="${action}" class="form card" novalidate>
      ${csrfField(ctx)}
      ${field({ id: 'phone', label: '휴대전화 번호', error, hint: '숫자만 입력해도 됩니다.',
        input: (d) => textInput({ id: 'phone', value: phone, type: 'tel', autocomplete: 'tel', inputmode: 'tel',
          maxlength: 20, required: true, error, describedBy: d }) })}
      <button type="submit" class="btn">인증번호 받기</button>
    </form>
    ${action === '/login' ? html`<p class="aside-link">처음이신가요? <a href="/register">참여 등록</a></p>` : ''}
    ${action === '/register' ? html`<p class="aside-link">이미 등록하셨나요? <a href="/login">로그인</a></p>` : ''}`, area);
}

/** 인증번호 확인 */
export function codeForm(ctx, { title, action, resendAction, phone, error, devCode, area }) {
  return page(ctx, title, html`
    <form method="post" action="${action}" class="form card" novalidate>
      ${csrfField(ctx)}
      <p class="muted">${maskPhone(phone)}</p>
      ${devCode ? html`<p class="dev-note" role="note">개발용 인증번호 (실제 문자 발송 안 됨): <b>${devCode}</b></p>` : ''}
      ${field({ id: 'code', label: '인증번호 6자리', error,
        input: (d) => textInput({ id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6,
          required: true, error, describedBy: d }) })}
      <button type="submit" class="btn">확인</button>
    </form>
    <form method="post" action="${resendAction}" class="aside-link">
      ${csrfField(ctx)}
      <input type="hidden" name="phone" value="${phone}">
      <button type="submit" class="linklike">인증번호 다시 받기</button>
    </form>`, area);
}

/** 최초 등록 정보 입력 (전화번호 인증 후) */
export function registerDetailsForm(ctx, { phone, values = {}, errors = {}, consent }) {
  return page(ctx, '참여 등록', html`
    ${errorSummary(errors)}
    <form method="post" action="/register/details" class="form card" novalidate>
      ${csrfField(ctx)}
      <div class="field">
        <span class="label">휴대전화 번호</span>
        <p class="readonly">${maskPhone(phone)} <span class="chip">인증 완료</span></p>
      </div>
      ${field({ id: 'name', label: '이름', error: errors.name,
        input: (d) => textInput({ id: 'name', value: values.name, autocomplete: 'name', maxlength: 40, required: true,
          error: errors.name, describedBy: d }) })}
      ${field({ id: 'region', label: '거주 지역', error: errors.region, hint: '예: 시·구·동',
        input: (d) => textInput({ id: 'region', value: values.region, autocomplete: 'address-level2', maxlength: 60,
          required: true, error: errors.region, describedBy: d }) })}
      <fieldset class="consents${errors.consent ? ' has-error' : ''}" id="consent">
        <legend>동의</legend>
        ${consent.isDraft ? html`<p class="dev-note" role="note">개발용 임시 항목 — 기관 확정 동의문으로 교체 필요</p>` : ''}
        ${consent.items.map((item) => html`
          <div class="consent-item">
            ${item.body ? html`<details><summary>${item.title} 내용 보기</summary><div class="consent-body">${item.body}</div></details>` : ''}
            <label class="check">
              <input type="checkbox" name="consent" value="${item.key}"
                ${(values.consent || []).includes(item.key) ? html`checked` : ''}>
              <span>${item.title} (${item.required ? '필수' : '선택'})</span>
            </label>
          </div>`)}
        ${errors.consent ? html`<p class="error">${errors.consent}</p>` : ''}
      </fieldset>
      <button type="submit" class="btn">등록하기</button>
    </form>`);
}

export function registrationClosed(ctx) {
  return page(ctx, '참여 등록', html`<p class="card">등록 준비 중입니다.</p>`);
}
