import { html } from '../lib/html.js';
import { field, textInput } from './layout.js';

// 카카오(다음) 우편번호 서비스. 스크립트를 불러오지 못하면 주소를 직접 입력할 수 있다.
export const POSTCODE_SCRIPTS = [
  'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js',
  '/static/address.js',
];

/** 우편번호·도로명 주소·상세 주소 입력. values: { postcode, address, address_detail } */
export function addressFields(values = {}, errors = {}) {
  return html`
    <div class="field address-field${errors.address ? ' has-error' : ''}">
      <label for="address">주소</label>
      <p class="hint" id="address-hint">도로명 주소를 입력하거나 주소 검색을 이용해 주세요.</p>
      <div class="address-row">
        <input id="postcode" name="postcode" class="postcode" value="${values.postcode ?? ''}" readonly
          aria-label="우편번호" placeholder="우편번호" tabindex="-1">
        <button type="button" class="btn small ghost" id="address-search" hidden>주소 검색</button>
      </div>
      ${textInput({ id: 'address', value: values.address, autocomplete: 'street-address', maxlength: 200, required: true,
        error: errors.address, describedBy: errors.address ? 'address-hint address-error' : 'address-hint', placeholder: '도로명 주소' })}
      ${errors.address ? html`<p class="error" id="address-error">${errors.address}</p>` : ''}
      <div id="postcode-layer" class="postcode-layer" hidden>
        <div class="postcode-layer-head">
          <span>도로명 주소 검색</span>
          <button type="button" class="btn small ghost" id="postcode-close">닫기</button>
        </div>
        <div id="postcode-box" class="postcode-box"></div>
      </div>
    </div>
    ${field({ id: 'address_detail', label: '상세 주소', error: errors.address_detail, hint: '동·호수 등',
      input: (d) => textInput({ id: 'address_detail', value: values.address_detail, autocomplete: 'address-line2', maxlength: 100,
        error: errors.address_detail, describedBy: d }) })}`;
}
