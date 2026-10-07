import { html } from '../lib/html.js';
import { formatPhone, maskPhone } from '../lib/phone.js';
import { formatDate, formatDateTime, formatTimeRange } from '../lib/time.js';
import { LINK_STATUS } from '../como/mapping.js';
import { ASSIGN_MODES } from '../services/programs.js';
import { INTERNAL_STATUS } from '../services/users.js';
import { THEMES } from '../site.js';
import { csrfField, errorSummary, field, layout, textInput } from './layout.js';

function page(ctx, title, inner) {
  return layout(ctx, {
    title: `${title} · 관리`,
    area: 'admin',
    body: html`<section class="sec"><div class="wrap">${inner}</div></section>`,
  });
}

const isManager = (ctx) => ctx.user.role === 'manager';
// 담당 범위 제한: 운영 담당(staff)에게는 전화번호를 가려서 보여 준다.
const phoneFor = (ctx, p) => (isManager(ctx) ? formatPhone(p) : maskPhone(p));

function when(s) {
  if (!s.date) return '일정 미정';
  const t = formatTimeRange(s.start_time, s.end_time);
  return t ? `${formatDate(s.date)} ${t}` : formatDate(s.date);
}

function postButton(ctx, action, label, { cls = 'btn small', hidden = {} } = {}) {
  return html`<form method="post" action="${action}" class="inline-form">
    ${csrfField(ctx)}
    ${Object.entries(hidden).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <button type="submit" class="${cls}">${label}</button>
  </form>`;
}

function table(head, rows, empty = '없음') {
  if (!rows.length) return html`<p class="muted">${empty}</p>`;
  return html`<div class="table-wrap"><table>
    <thead><tr>${head.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

export function dashboardPage(ctx, counts) {
  return page(ctx, '관리', html`
    <h1 class="page-title">관리</h1>
    <div class="tiles">
      ${isManager(ctx) ? html`<a class="tile" href="/admin/participants?status=received"><span>신규 접수</span><b>${counts.received}</b></a>
      <a class="tile" href="/admin/participants?status=selected"><span>선정 참여자</span><b>${counts.selected}</b></a>` : ''}
      <a class="tile" href="/admin/programs"><span>프로그램</span><b>${counts.programs}</b></a>
      ${isManager(ctx) ? html`<a class="tile" href="/admin/como"><span>꼬모 확인 필요</span><b>${counts.comoAttention}</b></a>` : ''}
    </div>`);
}

// ── 참여자 ─────────────────────────────────────────────

export function participantsPage(ctx, { rows, status }) {
  return page(ctx, '참여자', html`
    <h1 class="page-title">참여자</h1>
    <form method="get" action="/admin/participants" class="filter">
      <label for="status">상태</label>
      <select id="status" name="status">
        <option value="">전체</option>
        ${Object.entries(INTERNAL_STATUS).map(([k, v]) => html`<option value="${k}"${status === k ? html` selected` : ''}>${v}</option>`)}
      </select>
      <button type="submit" class="btn small ghost">보기</button>
    </form>
    ${table(['이름', '연락처', '생년월일', '주소', '등록일', '상태', '꼬모'], rows.map((u) => html`<tr>
      <td><a href="/admin/participants/${u.id}">${u.name}</a></td>
      <td>${formatPhone(u.phone)}</td>
      <td>${formatDate(u.birth_date)}</td>
      <td>${u.postcode ? `(${u.postcode}) ` : ''}${u.address} ${u.address_detail || ''}</td>
      <td>${formatDateTime(u.registered_at)}</td>
      <td>${INTERNAL_STATUS[u.internal_status]}</td>
      <td>${u.como_status ? LINK_STATUS[u.como_status] : '미확인'}</td>
    </tr>`))}`);
}

export function participantPage(ctx, { user, registration, consents, enrollments, link, comoConfigured, counseling }) {
  const candidates = link?.candidates ? JSON.parse(link.candidates) : [];
  return page(ctx, user.name, html`
    <p class="crumb"><a href="/admin/participants">참여자</a></p>
    <h1 class="page-title">${user.name}</h1>
    <div class="card">
      <dl class="summary">
        <dt>연락처</dt><dd>${formatPhone(user.phone)}
          ${user.phone_confirmed_at ? html`<span class="chip">확인 ${formatDateTime(user.phone_confirmed_at)}</span>` : html`<span class="chip warn">미확인</span>`}</dd>
        <dt>생년월일</dt><dd>${formatDate(user.birth_date)}</dd>
        <dt>주소</dt><dd>${user.postcode ? `(${user.postcode}) ` : ''}${user.address} ${user.address_detail || ''}</dd>
        <dt>등록일</dt><dd>${formatDateTime(registration.registered_at)}</dd>
        <dt>상태</dt><dd>${INTERNAL_STATUS[registration.internal_status]}</dd>
      </dl>
      <div class="actions">
        ${user.is_selected
          ? postButton(ctx, `/admin/participants/${user.id}/select`, '선정 해제', { cls: 'btn small ghost', hidden: { selected: '0' } })
          : html`${postButton(ctx, `/admin/participants/${user.id}/select`, '선정', { hidden: { selected: '1' } })}
            <form method="post" action="/admin/participants/${user.id}/status" class="inline-form">
              ${csrfField(ctx)}
              <label class="sr-only" for="istatus">상태 변경</label>
              <select id="istatus" name="status">
                ${['received', 'reviewing', 'not_selected'].map((k) => html`<option value="${k}"${registration.internal_status === k ? html` selected` : ''}>${INTERNAL_STATUS[k]}</option>`)}
              </select>
              <button type="submit" class="btn small ghost">상태 저장</button>
            </form>`}
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">계정</h2>
      <p class="small muted">연락처 확인: 본인·번호를 확인한 경우 기록합니다(선정 시 자동 기록). 꼬모 연동은 확인된 번호만 사용합니다.</p>
      <div class="actions">
        ${user.phone_confirmed_at ? '' : postButton(ctx, `/admin/participants/${user.id}/confirm-phone`, '연락처 확인', { cls: 'btn small ghost' })}
        ${postButton(ctx, `/admin/participants/${user.id}/pin-reset`, 'PIN 초기화', { cls: 'btn small ghost' })}
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">꼬모 연결</h2>
      ${!comoConfigured ? html`<p>연동 미설정</p>` : html`
        <p>${link ? LINK_STATUS[link.status] : '미확인'}${link?.detail ? html` <span class="muted">(${link.detail})</span>` : ''}</p>
        ${link?.checked_at ? html`<p class="small muted">확인 ${formatDateTime(link.checked_at)}</p>` : ''}
        ${counseling.state === 'available' ? html`<p>${counseling.total !== null ? `${counseling.completed} / ${counseling.total}회 완료` : `${counseling.completed}회 완료`}
          ${counseling.isMock ? html`<span class="chip warn">개발용 모의 데이터</span>` : ''}</p>` : ''}
        <div class="actions">
          ${postButton(ctx, `/admin/como/${user.id}/check`, '다시 확인', { cls: 'btn small ghost' })}
          ${link?.status === 'linked' ? postButton(ctx, `/admin/como/${user.id}/sync`, '현황 갱신', { cls: 'btn small ghost' }) : ''}
          ${link?.status === 'linked' ? postButton(ctx, `/admin/como/${user.id}/unlink`, '연결 해제', { cls: 'btn small ghost' }) : ''}
        </div>
        ${link?.status === 'conflict' && candidates.length ? html`
          <form method="post" action="/admin/como/${user.id}/confirm" class="inline-form">
            ${csrfField(ctx)}
            <label for="ext">연결할 꼬모 계정</label>
            <select id="ext" name="external_id">${candidates.map((c) => html`<option value="${c}">${c}</option>`)}</select>
            <button type="submit" class="btn small">본인 확인 후 연결</button>
          </form>` : ''}`}
    </div>

    <div class="card">
      <h2 class="card-title">참여·신청</h2>
      ${table(['프로그램', '일정', '구분', '상태', '출석'], enrollments.map((e) => html`<tr>
        <td><a href="/admin/sessions/${e.session_id}">${e.program_name}${e.round_no ? ` ${e.round_no}회차` : ''}</a></td>
        <td>${when(e)}</td>
        <td>${{ auto: '자동 배정', select: '선택 신청', manual: '관리자 배정' }[e.source]}</td>
        <td>${e.status === 'active' ? '유효' : '취소'}</td>
        <td>${{ attended: '참여', absent: '불참' }[e.attendance] || '-'}</td>
      </tr>`))}
    </div>

    <div class="card">
      <h2 class="card-title">동의 내역</h2>
      ${table(['항목', '동의', '문안 버전', '일시'], consents.map((c) => html`<tr>
        <td>${c.purpose}</td><td>${c.agreed ? '동의' : '미동의'}</td><td>${c.doc_version}</td><td>${formatDateTime(c.agreed_at)}</td>
      </tr>`))}
    </div>`);
}

// ── 프로그램·회차 ───────────────────────────────────────

export function programsPage(ctx, programs) {
  return page(ctx, '프로그램', html`
    <h1 class="page-title">프로그램</h1>
    <p class="actions"><a class="btn small" href="/admin/programs/new">프로그램 추가</a></p>
    ${table(['테마', '프로그램', '운영 계획', '배정 방식', '공개', '회차'], programs.map((p) => html`<tr>
      <td><span class="theme-tag ${THEMES[p.theme].key}">${p.theme}</span></td>
      <td><a href="/admin/programs/${p.id}">${p.name}</a></td>
      <td>${p.schedule_label}</td>
      <td>${ASSIGN_MODES[p.assign_mode]}</td>
      <td>${p.is_public ? '공개' : '비공개'}</td>
      <td>${p.session_count}</td>
    </tr>`))}`);
}

function programFields(p, errors, isNew) {
  return html`
    ${field({ id: 'theme', label: '테마', error: errors.theme, input: () => html`
      <select id="theme" name="theme">${Object.entries(THEMES).map(([k, t]) => html`
        <option value="${k}"${p.theme === k ? html` selected` : ''}>${k} ${t.ko}</option>`)}</select>` })}
    ${field({ id: 'name', label: '프로그램명', error: errors.name,
      input: (d) => textInput({ id: 'name', value: p.name, maxlength: 80, required: true, error: errors.name, describedBy: d }) })}
    ${field({ id: 'detail', label: '세부 내용', input: (d) => textInput({ id: 'detail', value: p.detail, maxlength: 200, describedBy: d }) })}
    ${field({ id: 'schedule_label', label: '운영 계획 표기', hint: '예: 2~11월 · 10회',
      input: (d) => textInput({ id: 'schedule_label', value: p.schedule_label, maxlength: 200, describedBy: d }) })}
    ${isNew ? field({ id: 'assign_mode', label: '배정 방식', error: errors.assign_mode, hint: '생성 후 변경할 수 없습니다.', input: (d) => html`
      <select id="assign_mode" name="assign_mode" aria-describedby="${d}">${Object.entries(ASSIGN_MODES).map(([k, v]) => html`
        <option value="${k}"${p.assign_mode === k ? html` selected` : ''}>${v}</option>`)}</select>` })
      : html`<div class="field"><span class="label">배정 방식</span><p class="readonly">${ASSIGN_MODES[p.assign_mode]}</p>
        <input type="hidden" name="assign_mode" value="${p.assign_mode}"></div>`}
    <label class="check"><input type="checkbox" name="is_public" value="1"${p.is_public ? html` checked` : ''}><span>공개 목록에 표시</span></label>
    <label class="check"><input type="checkbox" name="self_cancel" value="1"${p.self_cancel ? html` checked` : ''}><span>참여자 본인 신청 취소 허용 (선택 신청)</span></label>`;
}

export function programNewPage(ctx, { values, errors = {} }) {
  return page(ctx, '프로그램 추가', html`
    <p class="crumb"><a href="/admin/programs">프로그램</a></p>
    <h1 class="page-title">프로그램 추가</h1>
    ${errorSummary(errors)}
    <form method="post" action="/admin/programs/new" class="form card" novalidate>
      ${csrfField(ctx)}
      ${programFields(values, errors, true)}
      <button type="submit" class="btn">추가</button>
    </form>`);
}

function sessionFields(s, errors) {
  const input = (id, label, type, opts = {}) => field({ id, label, error: errors[id], hint: opts.hint,
    input: (d) => textInput({ id, value: s[id] ?? '', type, error: errors[id], describedBy: d, ...opts }) });
  return html`<div class="field-grid">
    ${input('round_no', '회차', 'text', { inputmode: 'numeric', maxlength: 3 })}
    ${input('date', '날짜', 'date', { hint: '미정이면 비워 둡니다.' })}
    ${input('start_time', '시작', 'time')}
    ${input('end_time', '종료', 'time')}
    ${input('place', '장소', 'text', { maxlength: 120 })}
    ${input('capacity', '정원', 'text', { inputmode: 'numeric', maxlength: 4, hint: '비우면 제한 없음' })}
  </div>
  <label class="check"><input type="checkbox" name="is_closed" value="1"${s.is_closed ? html` checked` : ''}><span>신청 마감</span></label>
  <label class="check"><input type="checkbox" name="is_cancelled" value="1"${s.is_cancelled ? html` checked` : ''}><span>회차 취소</span></label>`;
}

export function programPage(ctx, { program, sessions, values, errors = {}, sessionValues = {}, sessionErrors = {} }) {
  const p = values || program;
  const hasSessions = !['external'].includes(program.assign_mode);
  return page(ctx, program.name, html`
    <p class="crumb"><a href="/admin/programs">프로그램</a></p>
    <h1 class="page-title">${program.name}</h1>
    ${program.assign_mode === 'external' ? html`<p class="card">전문 심리상담 접수·회차는 꼬모에서 관리합니다. 현황은 <a href="/admin/como">꼬모 연동</a>에서 확인합니다.</p>` : ''}
    ${program.assign_mode === 'internal' ? html`<p class="card">기관 내부 운영 — 참여자 개인 일정·신청 목록에 표시되지 않습니다.</p>` : ''}

    ${hasSessions ? html`<div class="card">
      <h2 class="card-title">회차</h2>
      ${table(['회차', '일정', '장소', '정원', '인원', '상태'], sessions.map((s) => html`<tr>
        <td><a href="/admin/sessions/${s.id}">${s.round_no ? `${s.round_no}회차` : '회차'}</a></td>
        <td>${when(s)}</td>
        <td>${s.place || '장소 미정'}</td>
        <td>${s.capacity ?? '-'}</td>
        <td>${program.assign_mode === 'internal' ? '-' : s.active_count}</td>
        <td>${s.is_cancelled ? '취소' : s.is_closed ? '마감' : '-'}</td>
      </tr>`), '등록된 회차가 없습니다.')}
    </div>

    <div class="card">
      <h2 class="card-title">회차 추가</h2>
      ${program.assign_mode === 'auto' ? html`<p class="small muted">추가하면 선정된 참여자 전원에게 배정됩니다.</p>` : ''}
      ${errorSummary(sessionErrors)}
      <form method="post" action="/admin/programs/${program.id}/sessions" class="form" novalidate>
        ${csrfField(ctx)}
        ${sessionFields(sessionValues, sessionErrors)}
        <button type="submit" class="btn">회차 추가</button>
      </form>
    </div>` : ''}

    <div class="card">
      <h2 class="card-title">프로그램 정보</h2>
      ${errorSummary(errors)}
      <form method="post" action="/admin/programs/${program.id}" class="form" novalidate>
        ${csrfField(ctx)}
        ${programFields(p, errors, false)}
        <button type="submit" class="btn">저장</button>
      </form>
    </div>`);
}

export function sessionPage(ctx, { session, roster, candidates, values, errors = {} }) {
  const s = values || session;
  const mode = session.assign_mode;
  const showRoster = mode !== 'internal';
  return page(ctx, `${session.program_name} 회차`, html`
    <p class="crumb"><a href="/admin/programs">프로그램</a> › <a href="/admin/programs/${session.program_id}">${session.program_name}</a></p>
    <h1 class="page-title">${session.program_name} ${session.round_no ? `${session.round_no}회차` : ''}</h1>

    <div class="card">
      <h2 class="card-title">회차 정보</h2>
      ${errorSummary(errors)}
      <form method="post" action="/admin/sessions/${session.id}" class="form" novalidate>
        ${csrfField(ctx)}
        ${sessionFields(s, errors)}
        <button type="submit" class="btn">저장</button>
      </form>
    </div>

    ${showRoster ? html`<div class="card">
      <h2 class="card-title">참여자 · 출석 <span class="muted small">(${session.active_count}${session.capacity !== null ? ` / ${session.capacity}` : ''})</span></h2>
      ${table(['이름', '전화번호', '구분', '상태', '출석', ''], roster.map((r) => html`<tr>
        <td>${r.name}</td>
        <td>${phoneFor(ctx, r.phone)}</td>
        <td>${{ auto: '자동 배정', select: '선택 신청', manual: '관리자 배정' }[r.source]}</td>
        <td>${r.status === 'active' ? '유효' : `취소${r.cancel_reason === 'self' ? '(본인)' : r.cancel_reason === 'deselected' ? '(선정 해제)' : ''}`}</td>
        <td>${r.status === 'active' ? html`<form method="post" action="/admin/enrollments/${r.id}/attendance" class="inline-form">
          ${csrfField(ctx)}
          <label class="sr-only" for="att-${r.id}">${r.name} 출석</label>
          <select id="att-${r.id}" name="status">
            <option value=""${!r.attendance ? html` selected` : ''}>미기록</option>
            <option value="attended"${r.attendance === 'attended' ? html` selected` : ''}>참여</option>
            <option value="absent"${r.attendance === 'absent' ? html` selected` : ''}>불참</option>
          </select>
          <button type="submit" class="btn small ghost">저장</button>
        </form>` : '-'}</td>
        <td>${r.status === 'active' && !r.attendance ? postButton(ctx, `/admin/enrollments/${r.id}/cancel`, '취소', { cls: 'btn small ghost' }) : ''}</td>
      </tr>`), '참여자가 없습니다.')}
    </div>` : ''}

    ${mode === 'manual' ? html`<div class="card">
      <h2 class="card-title">참여자 배정</h2>
      ${candidates.length ? html`<form method="post" action="/admin/sessions/${session.id}/assign" class="form">
        ${csrfField(ctx)}
        <fieldset class="checks"><legend class="sr-only">배정할 참여자</legend>
          ${candidates.map((u) => html`<label class="check"><input type="checkbox" name="user_id" value="${u.id}"><span>${u.name} <span class="muted">${phoneFor(ctx, u.phone)}</span></span></label>`)}
        </fieldset>
        <button type="submit" class="btn">배정</button>
      </form>` : html`<p class="muted">배정할 수 있는 선정 참여자가 없습니다.</p>`}
    </div>` : ''}`);
}

export function linkPage(ctx, { programs, result }) {
  return page(ctx, 'Link 배정', html`
    <h1 class="page-title">Link 자동 배정</h1>
    <div class="card">
      <p>선정된 참여자 전원을 Link 프로그램의 모든 회차에 배정합니다. 이미 배정된 회차는 다시 만들지 않습니다.</p>
      ${result ? html`<p class="flash ok" role="status">새 배정 ${result.created}건 · 복원 ${result.restored}건</p>` : ''}
      ${postButton(ctx, '/admin/link/run', '자동 배정 실행', { cls: 'btn' })}
    </div>
    ${table(['프로그램', '회차', '배정 인원'], programs.map((p) => html`<tr>
      <td><a href="/admin/programs/${p.id}">${p.name}</a></td><td>${p.session_count}</td><td>${p.enrollment_count}</td>
    </tr>`))}`);
}

export function comoPage(ctx, { adapter, applyUrl, rows, logs }) {
  return page(ctx, '꼬모 연동', html`
    <h1 class="page-title">꼬모 연동</h1>
    <div class="card">
      <dl class="summary">
        <dt>상담 신청 경로</dt><dd>${applyUrl}</dd>
        <dt>회차 연동</dt><dd>${adapter.kind === 'none' ? '미연결 (연동 인터페이스 미확인)' : adapter.kind === 'mock' ? '개발용 모의 데이터' : adapter.kind}</dd>
        <dt>매핑 기준</dt><dd>인증된 전화번호</dd>
      </dl>
      ${adapter.configured ? html`<div class="actions">
        ${postButton(ctx, '/admin/como/check-all', '선정 참여자 매핑 확인', { cls: 'btn small' })}
        ${postButton(ctx, '/admin/como/sync-all', '연결된 참여자 현황 갱신', { cls: 'btn small ghost' })}
      </div>` : ''}
    </div>
    <h2 class="sub-title">선정 참여자</h2>
    ${table(['이름', '전화번호', '연결 상태', '세부', '확인 시각'], rows.map((r) => html`<tr>
      <td><a href="/admin/participants/${r.id}">${r.name}</a></td>
      <td>${formatPhone(r.phone)}</td>
      <td>${r.status ? LINK_STATUS[r.status] : '미확인'}</td>
      <td>${r.detail || ''}</td>
      <td>${formatDateTime(r.checked_at)}</td>
    </tr>`))}
    <h2 class="sub-title">연동 기록</h2>
    ${table(['시각', '참여자', '작업', '결과', '메시지'], logs.map((l) => html`<tr>
      <td>${formatDateTime(l.created_at)}</td><td>${l.name || '-'}</td><td>${l.action}</td><td>${l.result}</td><td>${l.message || ''}</td>
    </tr>`))}`);
}

export function auditPage(ctx, rows) {
  return page(ctx, '변경 기록', html`
    <h1 class="page-title">변경 기록</h1>
    ${table(['시각', '작업자', '작업', '대상', '내용'], rows.map((r) => html`<tr>
      <td>${formatDateTime(r.created_at)}</td><td>${r.actor_name || '-'}</td><td>${r.action}</td>
      <td>${r.target_type} ${r.target_id ?? ''}</td><td class="mono">${r.detail || ''}</td>
    </tr>`))}`);
}
