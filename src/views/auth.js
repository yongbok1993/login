import { html } from '../lib/html.js';
import { SITE } from '../site.js';
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

function phoneField(value, error, label = '휴대전화 번호') {
  return field({ id: 'phone', label, error, hint: '숫자만 입력해도 됩니다.',
    input: (d) => textInput({ id: 'phone', value, type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 20,
      required: true, error, describedBy: d }) });
}

function pinField({ id, label, error, hint, autocomplete = 'new-password' }) {
  return field({ id, label, error, hint,
    input: (d) => textInput({ id, type: 'password', inputmode: 'numeric', autocomplete, maxlength: 6, required: true,
      error, describedBy: d }) });
}

const NEW_PIN_HINT = '숫자 6자리. 같은 숫자 반복, 연속된 숫자, 생년월일, 전화번호 뒷자리는 사용할 수 없습니다.';

export function loginForm(ctx, { phone = '', error }) {
  return page(ctx, '로그인', html`
    <form method="post" action="/login" class="form card" novalidate>
      ${csrfField(ctx)}
      ${error ? html`<p class="error-summary" role="alert">${error}</p>` : ''}
      ${phoneField(phone)}
      ${pinField({ id: 'pin', label: 'PIN 6자리', autocomplete: 'current-password' })}
      <button type="submit" class="btn">로그인</button>
    </form>
    <p class="aside-link">처음이신가요? <a href="/register">참여 등록</a></p>
    <p class="aside-link">PIN을 잊은 경우 ${SITE.orgName}(${SITE.tel})에 문의해 주세요.</p>`);
}

/** 최초 등록: 연락처·이름·주소·생년월일·PIN·동의 */
export function registerForm(ctx, { consent, values = {}, errors = {} }) {
  return page(ctx, '참여 등록', html`
    ${errorSummary(errors)}
    <form method="post" action="/register" class="form card" novalidate>
      ${csrfField(ctx)}
      ${field({ id: 'name', label: '이름', error: errors.name,
        input: (d) => textInput({ id: 'name', value: values.name, autocomplete: 'name', maxlength: 40, required: true,
          error: errors.name, describedBy: d }) })}
      ${phoneField(values.phone, errors.phone, '연락처 (휴대전화 번호)')}
      ${field({ id: 'address', label: '주소', error: errors.address,
        input: (d) => textInput({ id: 'address', value: values.address, autocomplete: 'street-address', maxlength: 200,
          required: true, error: errors.address, describedBy: d }) })}
      ${field({ id: 'birth_date', label: '생년월일', error: errors.birth_date, hint: '예: 19700101',
        input: (d) => textInput({ id: 'birth_date', value: values.birth_date_input, autocomplete: 'bday', inputmode: 'numeric',
          maxlength: 10, required: true, error: errors.birth_date, describedBy: d }) })}
      ${pinField({ id: 'pin', label: '로그인 PIN 6자리', error: errors.pin, hint: NEW_PIN_HINT })}
      ${pinField({ id: 'pin_confirm', label: 'PIN 확인', error: errors.pin_confirm })}
      <fieldset class="consents${errors.consent ? ' has-error' : ''}" id="consent">
        <legend>동의</legend>
        ${consent.isDraft && ctx.devNotice ? html`<p class="dev-note" role="note">기관 확정 동의문(CONSENT_JSON) 미설정</p>` : ''}
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
    </form>
    <p class="aside-link">이미 등록하셨나요? <a href="/login">로그인</a></p>`);
}

export function pinChangeForm(ctx, { forced, errors = {}, area }) {
  const a = area || (ctx.user && ctx.user.role !== 'participant' ? 'admin' : 'me');
  return page(ctx, 'PIN 변경', html`
    ${forced ? html`<p class="flash info" role="status">임시 PIN으로 로그인했습니다. 새 PIN을 정해 주세요.</p>` : ''}
    ${errorSummary(errors)}
    <form method="post" action="/account/pin" class="form card" novalidate>
      ${csrfField(ctx)}
      ${pinField({ id: 'current_pin', label: forced ? '임시 PIN' : '현재 PIN', error: errors.current_pin, autocomplete: 'current-password' })}
      ${pinField({ id: 'pin', label: '새 PIN 6자리', error: errors.pin, hint: NEW_PIN_HINT })}
      ${pinField({ id: 'pin_confirm', label: '새 PIN 확인', error: errors.pin_confirm })}
      <button type="submit" class="btn">변경</button>
    </form>`, a);
}

export function phoneChangeForm(ctx, { phone = '', errors = {} }) {
  return page(ctx, '번호 변경', html`
    ${errorSummary(errors)}
    <form method="post" action="/me/phone" class="form card" novalidate>
      ${csrfField(ctx)}
      ${phoneField(phone, errors.phone, '새 휴대전화 번호')}
      ${pinField({ id: 'pin', label: 'PIN 6자리', error: errors.pin, autocomplete: 'current-password' })}
      <button type="submit" class="btn">변경</button>
    </form>`, 'me');
}
