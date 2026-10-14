import { html } from '../lib/html.js';
import { formatDate, formatDateTime, formatShort, formatTimeRange } from '../lib/time.js';
import { THEME_ORDER, THEMES } from '../site.js';
import { applicationSummary, REVIEW_NOTICE, statusMessage } from './application.js';
import { PASSWORD_SCRIPTS, passwordField } from './auth.js';
import { csrfField, errorSummary, field, layout, textInput, themeDot, themeMark, themeName } from './layout.js';

function page(ctx, title, inner, scripts = []) {
  return layout(ctx, {
    title,
    area: 'me',
    scripts,
    body: html`<section class="sec"><div class="wrap">${inner}</div></section>`,
  });
}

function round(s) {
  return s.round_no ? `${s.round_no}회차` : '';
}

/** 확정된 값만 표시하고, 비어 있으면 '미정'으로 둔다. */
function when(s) {
  if (!s.date) return '일정 미정';
  const t = formatTimeRange(s.start_time, s.end_time);
  return t ? `${formatDate(s.date)} ${t}` : formatDate(s.date);
}

function where(s) {
  return s.place || '장소 미정';
}

function fmtNext(v) {
  if (!v) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : formatDateTime(v);
}

function themeLabel(theme) {
  return html`${themeMark(theme)} ${THEMES[theme].ko}`;
}

export function counselingCard(c, { heading = 'h2' } = {}) {
  const H = heading === 'h2' ? (x) => html`<h2 class="lb">${x}</h2>` : (x) => html`<h3 class="lb">${x}</h3>`;
  if (c.state !== 'available') {
    return html`<div class="ph-card">${H('전문 심리상담')}<p><b>연동 확인 필요</b></p></div>`;
  }
  return html`<div class="ph-card">
    ${c.isMock ? html`<span class="chip warn">개발용 모의 데이터</span>` : html`<span class="chip">꼬모 연동</span>`}
    ${H('전문 심리상담')}
    <p><b>${c.total !== null ? `${c.completed} / ${c.total}회 완료` : `${c.completed}회 완료`}</b></p>
    ${c.progress !== null ? html`<progress class="bar" max="${c.total}" value="${c.completed}">${Math.round(c.progress * 100)}%</progress>` : ''}
    ${c.nextAt ? html`<p>다음 상담 ${fmtNext(c.nextAt)}</p>` : ''}
    <p class="small muted">갱신 ${formatDateTime(c.syncedAt)}</p>
  </div>`;
}

/** 내 신청정보(모든 참여자). 승인 대기 중에는 이 화면만 이용할 수 있다. */
export function applicationPage(ctx, { app, consents, consentDoc, canEdit, values, errors = {}, phoneValue = '', phoneErrors = {} }) {
  const titles = Object.fromEntries((consentDoc?.items || []).map((i) => [i.key, i.title]));
  return page(ctx, '내 신청정보', html`
    <h1 class="page-title">내 신청정보</h1>
    <div class="card">
      ${applicationSummary(app)}
      <p class="status-message">${statusMessage(app)}</p>
      <p class="small muted">${REVIEW_NOTICE}</p>
    </div>
    ${canEdit ? html`${errorSummary(errors)}
    <form method="post" action="/me/application" class="form card" novalidate>
      ${csrfField(ctx)}
      ${field({ id: 'name', label: '이름 수정', error: errors.name, hint: '이름을 바꿔도 신청 시각은 그대로입니다.',
        input: (d) => textInput({ id: 'name', value: values ? values.name : app.name, autocomplete: 'name', maxlength: 40, required: true,
          error: errors.name, describedBy: d }) })}
      <button type="submit" class="btn">저장</button>
    </form>` : ''}
    <section class="card" id="phone-change" aria-labelledby="phone-change-title">
      <h2 class="card-title" id="phone-change-title">전화번호 변경</h2>
      <p>휴대전화 번호는 로그인 아이디입니다. 바꾸면 <b>다음부터 새 번호로 로그인</b>하고, 이전 번호로는 로그인할 수 없습니다.
        신청 시각·접수번호·승인 상태·게시글은 그대로입니다.</p>
      ${errorSummary(phoneErrors)}
      <form method="post" action="/me/phone" class="form" novalidate>
        ${csrfField(ctx)}
        ${field({ id: 'phone', label: '새 휴대전화 번호', error: phoneErrors.phone, hint: '하이픈(-) 없이 숫자만 입력해도 됩니다.',
          input: (d) => textInput({ id: 'phone', value: phoneValue, type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 20,
            required: true, error: phoneErrors.phone, describedBy: d }) })}
        ${passwordField({ id: 'current_password', label: '현재 비밀번호', error: phoneErrors.current_password, autocomplete: 'current-password' })}
        <button type="submit" class="btn">전화번호 바꾸기</button>
      </form>
    </section>
    <div class="card">
      <h2 class="card-title">비밀번호</h2>
      <p class="actions"><a class="btn ghost" href="/account/password">비밀번호 변경</a></p>
    </div>
    <div class="card">
      <h2 class="card-title">동의 내역</h2>
      ${consents.length ? html`<ul class="plain">${consents.map((c) => html`
        <li>${titles[c.purpose] || c.purpose} · ${c.agreed ? '동의' : '미동의'} · ${formatDateTime(c.agreed_at)}
          ${c.withdrawn_at ? html` · 철회 ${formatDateTime(c.withdrawn_at)}` : ''}</li>`)}</ul>` : html`<p>없음</p>`}
    </div>
    <p class="actions"><button type="button" class="btn ghost" data-print hidden>내 신청정보 인쇄</button></p>`, [...PASSWORD_SCRIPTS, '/static/print.js']);
}

export function statusPage(ctx, { next, upcoming, attended, counseling, pendingWishes = 0, notices = [] }) {
  const byTheme = {};
  for (const u of upcoming) (byTheme[u.theme] ||= []).push(u);
  return page(ctx, '나의 현황', html`
    <h1 class="page-title">나의 현황</h1>
    <div class="status-grid">
      <div class="ph-card now">
        <h2 class="lb">지금 해야 할 것</h2>
        ${next ? html`
          <p>${themeDot(next.theme)}<b>${next.program_name}</b> ${round(next)}</p>
          <p>${when(next)}</p>
          ${next.date || next.place ? html`<p>${where(next)}</p>` : ''}`
          : html`<p>예정된 일정이 없습니다.</p>`}
      </div>

      <div class="ph-card">
        <h2 class="lb">참여할 프로그램</h2>
        ${upcoming.length ? html`<ul class="plain">
          ${['L', 'O', 'G', 'IN'].filter((t) => byTheme[t]).map((t) => html`
            <li><b>${themeLabel(t)}</b>
              <ul class="sub">${byTheme[t].map((u) => html`
                <li>${u.program_name} ${round(u)} <span class="muted">· ${when(u)}</span></li>`)}
              </ul>
            </li>`)}
        </ul>` : html`<p>없음</p>`}
        ${pendingWishes ? html`<p class="small"><a href="/me/programs#t-g">G 나의 성장 희망 신청 ${pendingWishes}건 선정 대기</a></p>` : ''}
      </div>

      ${counselingCard(counseling)}

      <div class="ph-card">
        <h2 class="lb">참여한 프로그램</h2>
        ${attended.length ? html`<ul class="plain">${attended.map((a) => html`
          <li>${themeDot(a.theme)}${a.program_name} <b>${a.count}회</b></li>`)}</ul>` : html`<p>없음</p>`}
      </div>
    </div>
    ${notices.length ? html`<div class="card notices-card">
      <h2 class="card-title">공지사항</h2>
      <ul class="post-list">${notices.map((n) => html`<li>
        <a href="/board/notice/${n.id}">${n.is_pinned ? html`<span class="chip">중요</span> ` : ''}${n.title}</a>
        <span class="small muted">${formatShort(n.created_at)}</span></li>`)}</ul>
      <p class="small"><a href="/board/notice">전체 보기</a></p>
    </div>` : ''}
    <p class="actions"><a class="btn" href="/me/programs">프로그램 안내</a><a class="btn ghost" href="/board">게시판</a>
      <a class="btn ghost" href="/me/application">내 신청정보</a></p>`);
}

function sessionLine(s) {
  return html`${round(s) ? html`${round(s)} · ` : ''}${when(s)}${s.date || s.place ? html` · ${where(s)}` : ''}`;
}

function growAction(ctx, s) {
  if (s.my_status === 'active') {
    const cancel = (label) => html`<form method="post" action="/me/grow/enrollments/${s.my_enrollment_id}/cancel" class="inline-form">
      ${csrfField(ctx)}<button type="submit" class="linklike">${label}</button></form>`;
    if (s.my_selection === 'pending') return html`<span class="chip warn">선정 대기</span>${cancel('희망 취소')}`;
    if (s.my_selection === 'not_selected') return html`<span class="chip muted-chip">미선정</span>`;
    return html`<span class="chip">선정</span>${s.self_cancel ? cancel('참여 취소') : ''}`;
  }
  if (s.is_closed) return html`<span class="chip muted-chip">마감</span>`;
  if (s.capacity !== null && s.active_count >= s.capacity) return html`<span class="chip muted-chip">정원 마감</span>`;
  return html`<a class="btn small" href="/me/grow/${s.id}">희망 신청</a>`;
}

export function programsPage(ctx, { groups, upcoming, growSessions }) {
  const mine = (programId) => upcoming.filter((u) => u.program_id === programId);
  const growBy = (programId) => growSessions.filter((s) => s.program_id === programId);
  const item = (p) => {
    const name = p.assign_mode === 'external' ? html`<a class="item-link" href="/me/open/counseling">${p.name}</a>` : p.name;
    const sessions = p.assign_mode === 'select'
      ? growBy(p.id).map((s) => html`<li class="session-row"><span>${sessionLine(s)}</span><span class="row-action">${growAction(ctx, s)}</span></li>`)
      : mine(p.id).map((u) => html`<li>${sessionLine(u)}</li>`);
    return html`<li>${name} <small>${p.schedule_label}</small>${p.detail ? html`<span class="desc">${p.detail}</span>` : ''}
      ${sessions.length ? html`<ul class="sessions">${sessions}</ul>` : ''}</li>`;
  };
  return page(ctx, '프로그램', html`
    <h1 class="page-title">프로그램</h1>
    <div class="log-grid member">
      ${THEME_ORDER.map((k) => html`<section class="log-card ${THEMES[k].key}" aria-labelledby="t-${THEMES[k].key}">
        <h2 id="t-${THEMES[k].key}" class="area-title"><span class="area-name">${themeName(k)}</span><span class="area-ko">${THEMES[k].ko}</span></h2>
        <ul>${(groups[k] || []).map(item)}</ul>
        ${k === 'G' ? html`<span class="mode">희망 활동 직접 선택</span>` : ''}
      </section>`)}
    </div>`);
}

export function counselingPage(ctx, counseling) {
  return page(ctx, '전문 심리상담', html`
    <p class="crumb"><a href="/me/programs">프로그램</a> › L 정서 지원</p>
    <h1 class="page-title">전문 심리상담</h1>
    <div class="status-grid one">
      ${counselingCard(counseling)}
    </div>
    <p class="actions"><a class="btn" href="/me/counseling/apply" rel="noopener noreferrer">상담신청하기</a></p>`);
}

const BLOCKER_MESSAGES = {
  forbidden: '신청할 수 없는 회차입니다.',
  closed: '마감된 회차입니다.',
  full: '정원이 마감되었습니다.',
  duplicate: '이미 희망 신청한 회차입니다.',
  past: '지난 회차입니다.',
  cancelled: '취소된 회차입니다.',
};

export function blockerMessage(code) {
  return BLOCKER_MESSAGES[code] || '신청할 수 없는 회차입니다.';
}

function sessionSummary(user, s) {
  return html`<dl class="summary">
    <dt>프로그램</dt><dd>${s.program_name}${s.program_detail ? html` <small>${s.program_detail}</small>` : ''}</dd>
    ${s.round_no ? html`<dt>회차</dt><dd>${s.round_no}회차</dd>` : ''}
    <dt>일정</dt><dd>${when(s)}</dd>
    <dt>장소</dt><dd>${where(s)}</dd>
    <dt>신청자</dt><dd>${user.name}</dd>
  </dl>`;
}

export function growConfirmPage(ctx, s, blocker) {
  return page(ctx, '희망 신청', html`
    <p class="crumb"><a href="/me/programs">프로그램</a> › G 나의 성장</p>
    <h1 class="page-title">희망 신청</h1>
    <div class="card">
      ${sessionSummary(ctx.user, s)}
      ${blocker ? html`<p class="error" role="alert">${blockerMessage(blocker)}</p>
        <p class="actions"><a class="btn ghost" href="/me/programs">돌아가기</a></p>`
        : html`<form method="post" action="/me/grow/${s.id}" class="actions">
          ${csrfField(ctx)}
          <button type="submit" class="btn">희망 신청하기</button>
          <a class="btn ghost" href="/me/programs">취소</a>
        </form>`}
    </div>`);
}

export function growDonePage(ctx, s) {
  return page(ctx, '희망 신청 완료', html`
    <h1 class="page-title">희망 신청 완료</h1>
    <div class="card">
      ${sessionSummary(ctx.user, s)}
      <p>관리자가 선정하면 나의 현황 일정에 표시됩니다. 선정 결과는 프로그램 화면에서 확인할 수 있습니다.</p>
      <p class="actions"><a class="btn" href="/me">나의 현황</a><a class="btn ghost" href="/me/programs">프로그램</a></p>
    </div>`);
}
