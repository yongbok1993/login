import { html } from '../lib/html.js';
import { canUseInternal, isAdminRole, PARTICIPANT_CAP } from '../services/users.js';
import { SITE, THEME_ORDER, THEMES } from '../site.js';
import { SELECTION_NOTICE } from './application.js';
import { layout, stamp, themeDot, themeName, wordmark } from './layout.js';

function programItems(list) {
  return list.map((p) => html`<li>${p.name} <small>${p.schedule_label}</small>${p.detail ? html`<span class="desc">${p.detail}</span>` : ''}</li>`);
}

function areaHead(k, Tag = 'h3') {
  const t = THEMES[k];
  const head = html`<span class="area-name">${themeName(k)}</span><span class="area-ko">${t.ko}</span>`;
  return Tag === 'h2' ? html`<h2 class="area-title">${head}</h2>` : html`<h3 class="area-title">${head}</h3>`;
}

/** 공개 영역 소개(네 영역 이름·짧은 설명). 상세 프로그램은 넣지 않는다. */
function areaIntro() {
  return html`<div class="log-grid four">
    ${THEME_ORDER.map((k) => html`<article class="log-card ${THEMES[k].key}">
      ${stamp(k, [])}
      ${areaHead(k)}
      <p class="area-desc">${THEMES[k].desc}</p>
      ${k === 'L' ? html`<p class="area-link"><a href="${SITE.lightLink}" target="_blank" rel="noopener noreferrer">${SITE.lightLink}</a></p>` : ''}
    </article>`)}
  </div>`;
}

/** 상세 프로그램 카드(L·O·G·iN 같은 구성). 승인된 참여자와 담당자에게만 서버에서 넣는다. */
export function programCards(groups) {
  return html`<div class="log-grid four">
    ${THEME_ORDER.map((k) => html`<article class="log-card ${THEMES[k].key}">
      ${stamp(k, [])}
      ${areaHead(k)}
      <ul>${programItems(groups[k] || [])}</ul>
    </article>`)}
  </div>`;
}

/** '2026년 기획 ‘북한이탈주민 지원사업’' — 좁은 화면에서도 따옴표 안의 사업명은 한 줄로 */
function programLabel() {
  const i = SITE.programLabel.indexOf('‘');
  if (i < 0) return SITE.programLabel;
  return html`${SITE.programLabel.slice(0, i)}<span class="nowrap">${SITE.programLabel.slice(i)}</span>`;
}

function heroButtons(ctx) {
  const u = ctx.user;
  if (!u) return html`<a class="btn" href="/register">참여 신청</a><a class="btn ghost" href="/login">로그인</a>`;
  if (isAdminRole(u)) return html`<a class="btn" href="/admin">관리</a><a class="btn ghost" href="/board">게시판</a>`;
  if (canUseInternal(u)) return html`<a class="btn" href="/me">나의 현황</a><a class="btn ghost" href="/board">게시판</a>`;
  return html`<a class="btn" href="/me">내 신청정보</a><a class="btn ghost" href="/board">게시판</a>`;
}

export function homePage(ctx, groups) {
  const body = html`
  <section class="hero">
    <div class="wrap">
      <div>
        <p class="eyebrow">${SITE.orgName}</p>
        <p class="program-label">${programLabel()}</p>
        <h1 class="wordmark">${wordmark()}</h1>
        <p class="lead">${SITE.orgName}의 ${SITE.projectName}입니다.</p>
        <p class="themes-line">
          ${THEME_ORDER.map((k) => html`<b>${themeDot(k)}${themeName(k)} — ${THEMES[k].ko}</b>`)}
        </p>
        <div class="btns">${heroButtons(ctx)}</div>
      </div>
      <div class="stamps" aria-hidden="true">
        ${THEME_ORDER.map((k) => stamp(k, THEMES[k].ko.split(' ')))}
      </div>
    </div>
  </section>

  <section id="areas" class="sec">
    <div class="wrap">
      <div class="sec-head"><h2>네 가지 영역</h2></div>
      ${areaIntro()}
    </div>
  </section>

  ${groups ? html`<section id="programs" class="sec">
    <div class="wrap">
      <div class="sec-head"><h2>프로그램</h2></div>
      ${programCards(groups)}
    </div>
  </section>` : ''}

  <section id="guide" class="sec guide">
    <div class="wrap">
      <div class="sec-head"><h2>참여 안내</h2></div>
      <div class="guide-grid">
        <div class="card guide-intro">
          <h3 class="card-title">사업 소개</h3>
          <p class="intro-title">${SITE.serviceName} — 사람과 사람을 잇는 연결의 시작</p>
          <p>북한이탈주민이 마음을 나눌 이웃을 만나고 지역사회에 안정적으로 정착할 수 있도록 돕는 사업입니다.</p>
          <p>전문 상담과 맞춤형 지원을 비롯해 요리교실, 계절 행사, 나들이, 자조모임 등 다양한 활동을 진행합니다.
            지역주민과 함께 교류하고 진로 탐색 및 체험활동에 참여하며 새로운 관계를 맺고 자신의 가능성을 발견할 수 있도록 지원합니다.</p>
          <p class="intro-close">혼자가 아닌 함께, 지역사회 안에서 새로운 연결을 시작합니다.</p>
        </div>
        <div class="card guide-target">
          <h3 class="card-title">참여 대상</h3>
          <p class="target-main">중위소득 100% 이하 용인시에 거주 중인 북한이탈주민</p>
          <p class="small muted">승인된 참여자는 최대 ${PARTICIPANT_CAP}명입니다. 궁금한 점은 ${SITE.orgName}(${SITE.tel})에 문의해 주세요.</p>
        </div>
        <div class="card guide-steps">
          <h3 class="card-title">신청·선정 절차</h3>
          <ol class="steps">
            <li><b>참여 신청</b> 이름·휴대전화 번호·비밀번호를 입력하고 동의하면 접수됩니다. 신청 시각은 자동으로 기록됩니다.</li>
            <li><b>담당자 검토</b> ${SELECTION_NOTICE}</li>
            <li><b>참여 확정 안내</b> 담당자의 최종 승인 후 안내합니다. 먼저 신청했다고 자동으로 확정되지 않습니다.</li>
            <li><b>참여</b> 승인되면 프로그램 안내와 나의 현황을 이용할 수 있습니다.</li>
          </ol>
        </div>
        <div class="card guide-forms">
          <h3 class="card-title">신청서·동의서</h3>
          <p>프로그램 신청서와 개인정보 활용 동의서를 내려받거나 인쇄할 수 있습니다.</p>
          <div class="privacy-note">
            <p class="privacy-title"><span aria-hidden="true">🔒</span> 소중한 개인정보를 안전하게 보호합니다.</p>
            <p class="small">작성한 신청서와 동의서는 작성자 본인과 관리자만 확인할 수 있습니다.</p>
          </div>
          <p class="actions"><a class="btn ghost" href="/forms">신청서·동의서 보기</a></p>
        </div>
        <div class="card guide-contact">
          <h3 class="card-title">문의</h3>
          <p><b>${SITE.orgName}</b></p>
          <p>전화 <a href="tel:${SITE.tel}">${SITE.tel}</a></p>
          <p class="small muted">${SITE.address}</p>
        </div>
      </div>
      ${ctx.user ? '' : html`<p class="actions"><a class="btn" href="/register">참여 신청</a><a class="btn ghost" href="/login">로그인</a></p>`}
    </div>
  </section>`;
  return layout(ctx, { title: SITE.programLabel, body });
}

export function errorPage(ctx, status, message) {
  const titles = { 403: '접근 권한이 없습니다', 404: '페이지를 찾을 수 없습니다', 500: '오류가 발생했습니다',
    503: '잠시 이용할 수 없습니다' };
  const title = titles[status] || '요청을 처리할 수 없습니다';
  const body = html`<section class="sec narrow"><div class="wrap">
    <h1 class="page-title">${title}</h1>
    ${message ? html`<p>${message}</p>` : ''}
    <p class="actions"><a class="btn ghost" href="/">처음으로</a></p>
  </div></section>`;
  return layout(ctx, { title, body, area: ctx.area || 'public' });
}
