import { html } from '../lib/html.js';
import { formatPhone } from '../lib/phone.js';
import { formatDate, formatDateTime, formatTimeRange } from '../lib/time.js';
import { THEMES } from '../site.js';
import { csrfField, errorSummary, field, layout, textInput, themeDot } from './layout.js';

function page(ctx, title, inner) {
  return layout(ctx, {
    title,
    area: 'me',
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
  const t = THEMES[theme];
  return theme === 'IN' ? '지역사회' : `${t.letter} ${t.ko}`;
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

export function notSelectedPage(ctx) {
  return page(ctx, '나의 현황', html`
    <h1 class="page-title">나의 현황</h1>
    <div class="card">
      <p>참여자 전용 기능은 선정 후 이용할 수 있습니다.</p>
      <p class="actions"><a class="btn ghost" href="/me/profile">내 정보</a></p>
    </div>`);
}

export function statusPage(ctx, { next, upcoming, attended, counseling }) {
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
      </div>

      ${counselingCard(counseling)}

      <div class="ph-card">
        <h2 class="lb">참여한 프로그램</h2>
        ${attended.length ? html`<ul class="plain">${attended.map((a) => html`
          <li>${themeDot(a.theme)}${a.program_name} <b>${a.count}회</b></li>`)}</ul>` : html`<p>없음</p>`}
      </div>
    </div>
    <p class="actions"><a class="btn" href="/me/programs">프로그램</a></p>`);
}

function sessionLine(s) {
  return html`${round(s) ? html`${round(s)} · ` : ''}${when(s)}${s.date || s.place ? html` · ${where(s)}` : ''}`;
}

function growAction(ctx, s) {
  if (s.my_status === 'active') {
    return html`<span class="chip">신청 완료</span>
      ${s.self_cancel ? html`<form method="post" action="/me/grow/enrollments/${s.my_enrollment_id}/cancel" class="inline-form">
        ${csrfField(ctx)}<button type="submit" class="linklike">신청 취소</button></form>` : ''}`;
  }
  if (s.is_closed) return html`<span class="chip muted-chip">마감</span>`;
  if (s.capacity !== null && s.active_count >= s.capacity) return html`<span class="chip muted-chip">정원 마감</span>`;
  return html`<a class="btn small" href="/me/grow/${s.id}">신청</a>`;
}

export function programsPage(ctx, { groups, upcoming, growSessions }) {
  const mine = (programId) => upcoming.filter((u) => u.program_id === programId);
  const growBy = (programId) => growSessions.filter((s) => s.program_id === programId);
  return page(ctx, '프로그램', html`
    <h1 class="page-title">프로그램</h1>
    <div class="log-grid member">
      <section class="log-card l" aria-labelledby="t-l">
        <h2 id="t-l">L 관계 <span class="en">LINK</span></h2>
        <ul>${groups.L.map((p) => html`<li>${p.name}
          ${mine(p.id).length ? html`<ul class="sessions">${mine(p.id).map((u) => html`<li>${sessionLine(u)}</li>`)}</ul>`
            : html`<small>일정 미정</small>`}</li>`)}</ul>
        <span class="mode">전체 자동 참여</span>
      </section>

      <section class="log-card o" aria-labelledby="t-o">
        <h2 id="t-o">O 마음 <span class="en">OPEN</span></h2>
        <ul>${groups.O.map((p) => p.assign_mode === 'external'
          ? html`<li><a class="item-link" href="/me/open/counseling">${p.name}</a></li>`
          : html`<li>${p.name}
            ${mine(p.id).length ? html`<ul class="sessions">${mine(p.id).map((u) => html`<li>${sessionLine(u)}</li>`)}</ul>` : ''}</li>`)}
        </ul>
      </section>

      <section class="log-card g" aria-labelledby="t-g">
        <h2 id="t-g">G 성장 <span class="en">GROW</span></h2>
        <ul>${groups.G.map((p) => html`<li>${p.name}${p.detail ? html` <small>${p.detail}</small>` : ''}
          ${growBy(p.id).length ? html`<ul class="sessions">${growBy(p.id).map((s) => html`
            <li class="session-row"><span>${sessionLine(s)}</span><span class="row-action">${growAction(ctx, s)}</span></li>`)}</ul>`
            : html`<small>일정 미정</small>`}</li>`)}</ul>
        <span class="mode">희망 활동 직접 선택</span>
      </section>
    </div>`);
}

export function counselingPage(ctx, counseling) {
  return page(ctx, '전문 심리상담', html`
    <p class="crumb"><a href="/me/programs">프로그램</a> › O 마음</p>
    <h1 class="page-title">전문 심리상담</h1>
    <div class="status-grid one">
      ${counselingCard(counseling)}
    </div>
    <p class="actions"><a class="btn" href="/me/counseling/apply" rel="noopener noreferrer">상담신청하기</a></p>`);
}

const BLOCKER_MESSAGES = {
  closed: '마감된 회차입니다.',
  full: '정원이 마감되었습니다.',
  duplicate: '이미 신청한 회차입니다.',
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
  return page(ctx, '신청 확인', html`
    <p class="crumb"><a href="/me/programs">프로그램</a> › G 성장</p>
    <h1 class="page-title">신청 확인</h1>
    <div class="card">
      ${sessionSummary(ctx.user, s)}
      ${blocker ? html`<p class="error" role="alert">${blockerMessage(blocker)}</p>
        <p class="actions"><a class="btn ghost" href="/me/programs">돌아가기</a></p>`
        : html`<form method="post" action="/me/grow/${s.id}" class="actions">
          ${csrfField(ctx)}
          <button type="submit" class="btn">신청하기</button>
          <a class="btn ghost" href="/me/programs">취소</a>
        </form>`}
    </div>`);
}

export function growDonePage(ctx, s) {
  return page(ctx, '신청 완료', html`
    <h1 class="page-title">신청 완료</h1>
    <div class="card">
      ${sessionSummary(ctx.user, s)}
      <p class="actions"><a class="btn" href="/me">나의 현황</a><a class="btn ghost" href="/me/programs">프로그램</a></p>
    </div>`);
}

export function profilePage(ctx, { user, consents, consentDoc, values, errors = {} }) {
  const titles = Object.fromEntries((consentDoc?.items || []).map((i) => [i.key, i.title]));
  const v = values || user;
  return page(ctx, '내 정보', html`
    <h1 class="page-title">내 정보</h1>
    ${errorSummary(errors)}
    <form method="post" action="/me/profile" class="form card" novalidate>
      ${csrfField(ctx)}
      ${field({ id: 'name', label: '이름', error: errors.name,
        input: (d) => textInput({ id: 'name', value: v.name, autocomplete: 'name', maxlength: 40, required: true,
          error: errors.name, describedBy: d }) })}
      ${field({ id: 'region', label: '거주 지역', error: errors.region,
        input: (d) => textInput({ id: 'region', value: v.region, autocomplete: 'address-level2', maxlength: 60,
          required: true, error: errors.region, describedBy: d }) })}
      <button type="submit" class="btn">저장</button>
    </form>

    <div class="card">
      <h2 class="card-title">휴대전화 번호</h2>
      <p>${formatPhone(user.phone)}</p>
      <p class="actions"><a class="btn ghost" href="/me/phone">번호 변경</a></p>
    </div>

    <div class="card">
      <h2 class="card-title">동의 내역</h2>
      ${consents.length ? html`<ul class="plain">${consents.map((c) => html`
        <li>${titles[c.purpose] || c.purpose} · ${c.agreed ? '동의' : '미동의'} · ${formatDateTime(c.agreed_at)}
          ${c.withdrawn_at ? html` · 철회 ${formatDateTime(c.withdrawn_at)}` : ''}</li>`)}</ul>` : html`<p>없음</p>`}
    </div>`);
}
