import { html } from '../lib/html.js';
import { formatShort } from '../lib/time.js';
import { ACCEPT, FORM_KINDS } from '../services/forms.js';
import { isAdminRole } from '../services/users.js';
import { SITE } from '../site.js';
import { csrfField, layout } from './layout.js';

function size(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

function fileType(f) {
  return { 'application/pdf': 'PDF', 'application/x-hwp': 'HWP', 'application/vnd.hancom.hwpx': 'HWPX' }[f.content_type] || 'DOCX';
}

/** 신청서·동의서 안내(누구나). 등록된 실제 양식만 내려받기·인쇄 링크를 보인다. */
export function formsPage(ctx, forms) {
  const area = !ctx.user ? 'public' : isAdminRole(ctx.user) ? 'admin' : 'me';
  return layout(ctx, {
    title: '신청서·동의서',
    area,
    body: html`<section class="sec"><div class="wrap">
      <h1 class="page-title">신청서·동의서</h1>
      <p>프로그램 신청서와 개인정보 활용 동의서를 내려받거나 인쇄할 수 있습니다. 작성한 서류는 ${SITE.orgName}에 제출해 주세요.</p>
      <p class="small muted">양식을 내려받거나 인쇄하는 것만으로는 신청이나 개인정보 동의가 완료되지 않습니다.
        온라인 신청은 <a href="/register">참여 신청</a>에서 할 수 있습니다.</p>
      <div class="forms-grid">
        ${Object.entries(FORM_KINDS).map(([kind, k]) => {
          const f = forms[kind];
          return html`<section class="card form-card" aria-labelledby="form-${kind}">
            <h2 class="card-title" id="form-${kind}">${k.title}</h2>
            ${f ? html`<p class="form-status">${fileType(f)} · ${size(f.size)} · ${formatShort(f.uploaded_at)} 등록</p>
              <p class="actions">
                <a class="btn" href="/forms/${kind}/download">${k.title} 다운로드</a>
                ${f.content_type === 'application/pdf'
                  ? html`<a class="btn ghost" href="/forms/${kind}/print" target="_blank" rel="noopener">${k.title} 인쇄</a>` : ''}
              </p>
              ${f.content_type === 'application/pdf' ? html`<p class="small muted">인쇄를 누르면 양식이 새 창에 열립니다. 인쇄 설정에서 용지를 A4, 배율을 '실제 크기'로 선택해 주세요.</p>`
                : html`<p class="small muted">내려받은 파일을 한글·워드 프로그램으로 열어 A4로 인쇄해 주세요.</p>`}`
              : html`<p class="form-status"><span class="chip warn">양식 준비 중</span></p>
                <p class="small muted">기관에서 양식을 준비하고 있습니다. 필요하면 ${SITE.orgName}(${SITE.tel})에 문의해 주세요.</p>`}
          </section>`;
        })}
      </div>
    </div></section>`,
  });
}

/** 담당자: 양식 등록·교체·내리기 */
export function formsAdminPage(ctx, { forms, errorKind, error }) {
  return layout(ctx, {
    title: '신청서·동의서 양식 · 관리',
    area: 'admin',
    body: html`<section class="sec"><div class="wrap">
      <h1 class="page-title">신청서·동의서 양식</h1>
      <p class="small muted">기관에서 승인한 실제 양식 파일만 등록해 주세요. PDF를 등록하면 인쇄 화면도 함께 제공됩니다(HWP·HWPX·DOCX는 내려받기만).
        최대 1.9MB. 새 파일을 등록하면 기존 파일을 교체합니다. 등록 전에는 누리집에 '양식 준비 중'으로 보입니다.</p>
      <div class="forms-grid">
        ${Object.entries(FORM_KINDS).map(([kind, k]) => {
          const f = forms[kind];
          const err = errorKind === kind ? error : null;
          return html`<section class="card" aria-labelledby="admin-form-${kind}">
            <h2 class="card-title" id="admin-form-${kind}">${k.title}</h2>
            ${f ? html`<p class="form-status">${f.filename} · ${size(f.size)} · ${formatShort(f.uploaded_at)} 등록</p>
              <p class="actions"><a class="btn small ghost" href="/forms/${kind}/download">내려받아 확인</a></p>`
              : html`<p class="form-status"><span class="chip warn">양식 준비 중</span></p>`}
            <form method="post" action="/admin/forms/${kind}" enctype="multipart/form-data" class="form" novalidate>
              ${csrfField(ctx)}
              <div class="field${err ? ' has-error' : ''}">
                <label for="file-${kind}">${f ? '교체할 파일' : '등록할 파일'}</label>
                <input id="file-${kind}" name="file" type="file" accept="${ACCEPT}" required ${err ? html`aria-invalid="true" aria-describedby="file-${kind}-error"` : ''}>
                ${err ? html`<p class="error" id="file-${kind}-error">${err}</p>` : ''}
              </div>
              <button type="submit" class="btn small">${f ? '교체' : '등록'}</button>
            </form>
            ${f ? html`<form method="post" action="/admin/forms/${kind}/delete" class="inline-form">
              ${csrfField(ctx)}<button type="submit" class="btn small ghost">양식 내리기</button></form>` : ''}
          </section>`;
        })}
      </div>
    </div></section>`,
  });
}
