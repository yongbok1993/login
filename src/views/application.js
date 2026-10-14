import { html } from '../lib/html.js';
import { formatPhone } from '../lib/phone.js';
import { formatSeconds } from '../lib/time.js';
import { APPLICATION_STATUS, applicationStatus } from '../services/users.js';

// 선정 원칙(최신 사업계획서): 우선순위에 따라 검토하고, 같은 순위 안에서는 먼저 신청한 순서. 최종 승인은 담당자.
export const SELECTION_NOTICE = '우선순위에 따라 검토하고, 같은 순위에서는 먼저 신청한 순서를 따릅니다.';
export const REVIEW_NOTICE = `${SELECTION_NOTICE} 참여 확정은 담당자 확인 후 안내합니다.`;
export const PENDING_NOTICE = '신청이 접수되었습니다. 참여 확정 후 내부 서비스를 이용할 수 있습니다.';

/** 신청정보: 신청 시각 → 이름 → 전화번호 → 신청 상태 (모든 화면 같은 순서) */
export function applicationSummary(app) {
  const status = applicationStatus(app, app.internal_status);
  return html`<dl class="summary application">
    <dt>신청 시각</dt><dd class="mono">${app.registered_at ? formatSeconds(app.registered_at) : '기록 없음'}</dd>
    <dt>이름</dt><dd>${app.name}</dd>
    <dt>전화번호</dt><dd>${formatPhone(app.phone)}</dd>
    <dt>신청 상태</dt><dd><span class="chip status-${status}">${APPLICATION_STATUS[status]}</span></dd>
    ${app.receipt_no ? html`<dt>접수번호</dt><dd>${app.receipt_no}</dd>` : ''}
  </dl>`;
}

export function statusMessage(app) {
  const status = applicationStatus(app, app.internal_status);
  if (status === 'approved') return '참여가 확정되었습니다.';
  if (status === 'suspended') return '현재 이용이 중지된 상태입니다. 자세한 내용은 담당자에게 문의해 주세요.';
  if (status === 'released') return '참여 승인이 해제되었습니다. 자세한 내용은 담당자에게 문의해 주세요.';
  if (status === 'not_selected') return '이번에는 참여가 확정되지 않았습니다. 자세한 내용은 담당자에게 문의해 주세요.';
  return PENDING_NOTICE;
}
