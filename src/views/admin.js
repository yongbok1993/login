import { html } from '../lib/html.js';
import { formatPhone, maskPhone } from '../lib/phone.js';
import { formatDate, formatDateTime, formatSeconds, formatTimeRange } from '../lib/time.js';
import { LINK_STATUS } from '../como/mapping.js';
import { ASSIGN_MODES } from '../services/programs.js';
import { APPLICATION_STATUS, applicationStatus, INTERNAL_STATUS, ROLES } from '../services/users.js';
import { applicationSummary, REVIEW_NOTICE } from './application.js';
import { SELECTION } from '../services/enrollments.js';
import { THEMES } from '../site.js';
import { csrfField, errorSummary, field, layout, textInput, themeMark } from './layout.js';

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
      ${isManager(ctx) ? html`<a class="tile" href="/admin/participants?status=received"><span>승인 대기 신청</span><b>${counts.received}</b></a>
      <a class="tile" href="/admin/participants?status=selected"><span>승인된 참여자</span><b>${counts.selected} / ${counts.cap}</b></a>` : ''}
      <a class="tile" href="/admin/grow"><span>Grow 선정 대기</span><b>${counts.growPending}</b></a>
      <a class="tile" href="/board/qna"><span>담당자 답변 대기 질문</span><b>${counts.unanswered}</b></a>
      <a class="tile" href="/board/notice"><span>공지사항</span><b>${counts.notices}</b></a>
      <a class="tile" href="/admin/programs"><span>프로그램</span><b>${counts.programs}</b></a>
      ${isManager(ctx) ? html`<a class="tile" href="/admin/como"><span>꼬모 확인 필요</span><b>${counts.comoAttention}</b></a>` : ''}
    </div>`);
}

// ── 참여자 ─────────────────────────────────────────────

export function participantsPage(ctx, { rows, status, approved, cap }) {
  return page(ctx, '신청자', html`
    <h1 class="page-title">신청자</h1>
    <p>승인된 참여자 <b>${approved} / ${cap}명</b> · 최초 신청 시각 순서입니다. ${REVIEW_NOTICE}
      먼저 신청한 순서로 자동 확정하지 않으며, 담당자가 확인한 뒤 한 명씩 승인합니다.</p>
    <form method="get" action="/admin/participants" class="filter">
      <label for="status">상태</label>
      <select id="status" name="status">
        <option value="">전체</option>
        ${Object.entries(INTERNAL_STATUS).map(([k, v]) => html`<option value="${k}"${status === k ? html` selected` : ''}>${v}</option>`)}
      </select>
      <button type="submit" class="btn small ghost">보기</button>
    </form>
    ${table(['접수순서', '신청 시각', '이름', '전화번호', '신청 상태', '접수번호', '꼬모'], rows.map((u) => html`<tr>
      <td>${u.order_no}</td>
      <td class="mono">${formatSeconds(u.registered_at)}</td>
      <td><a href="/admin/participants/${u.id}">${u.name}</a></td>
      <td>${formatPhone(u.phone)}</td>
      <td>${APPLICATION_STATUS[applicationStatus(u, u.internal_status)]}</td>
      <td>${u.receipt_no}</td>
      <td>${u.como_status ? LINK_STATUS[u.como_status] : '미확인'}</td>
    </tr>`), '신청자가 없습니다.')}`);
}

export function participantPage(ctx, { user, app, approved, cap, consents, enrollments, link, comoConfigured, counseling }) {
  const candidates = link?.candidates ? JSON.parse(link.candidates) : [];
  const legacy = user.address || user.birth_date;
  return page(ctx, user.name, html`
    <p class="crumb"><a href="/admin/participants">신청자</a></p>
    <h1 class="page-title">${user.name}</h1>
    <div class="card">
      ${applicationSummary(app)}
      <p class="small muted">연락처 ${user.phone_confirmed_at ? html`확인 ${formatDateTime(user.phone_confirmed_at)}` : '미확인'}
        · 승인된 참여자 ${approved} / ${cap}명</p>
      <div class="actions">
        ${user.is_selected
          ? postButton(ctx, `/admin/participants/${user.id}/select`, '승인 해제', { cls: 'btn small ghost', hidden: { selected: '0' } })
          : html`${postButton(ctx, `/admin/participants/${user.id}/select`, '승인', { hidden: { selected: '1' } })}
            <form method="post" action="/admin/participants/${user.id}/status" class="inline-form">
              ${csrfField(ctx)}
              <label class="sr-only" for="istatus">상태 변경</label>
              <select id="istatus" name="status">
                ${['received', 'reviewing', 'not_selected'].map((k) => html`<option value="${k}"${app.internal_status === k ? html` selected` : ''}>${INTERNAL_STATUS[k]}</option>`)}
              </select>
              <button type="submit" class="btn small ghost">상태 저장</button>
            </form>`}
        ${user.account_status === 'suspended'
          ? postButton(ctx, `/admin/participants/${user.id}/account`, '이용 재개', { cls: 'btn small ghost', hidden: { account_status: 'active' } })
          : postButton(ctx, `/admin/participants/${user.id}/account`, '이용 중지', { cls: 'btn small ghost', hidden: { account_status: 'suspended' } })}
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">계정</h2>
      <p class="small muted">전화번호는 로그인 아이디입니다. 본인 확인 후에만 바꿔 주세요. 바꾸면 그 사람의 로그인이 모두 끊기고 새 번호와 기존 비밀번호로 다시 로그인합니다.</p>
      <form method="post" action="/admin/participants/${user.id}/phone" class="inline-form role-form">
        ${csrfField(ctx)}
        <label for="new-phone">새 전화번호</label>
        <input id="new-phone" name="phone" type="tel" inputmode="tel" maxlength="20" autocomplete="off">
        <button type="submit" class="btn small ghost">본인 확인 후 변경</button>
      </form>
      <p class="small muted">비밀번호를 잊은 경우: 본인 확인 후 재설정 코드를 발급해 전달하면 본인이 새 비밀번호를 정합니다. 담당자는 비밀번호를 볼 수 없습니다.</p>
      <div class="actions">
        ${user.phone_confirmed_at ? '' : postButton(ctx, `/admin/participants/${user.id}/confirm-phone`, '연락처 확인', { cls: 'btn small ghost' })}
        ${postButton(ctx, `/admin/users/${user.id}/reset-code`, '재설정 코드 발급', { cls: 'btn small ghost' })}
      </div>
      <p class="small muted">로그인 방식: ${user.password_hash ? '비밀번호' : user.pin_hash ? '기존 PIN(다음 로그인 때 비밀번호로 전환)' : '미설정'}</p>
      <form method="post" action="/admin/users/${user.id}/role" class="inline-form role-form">
        ${csrfField(ctx)}
        <label for="role">관리자 지정</label>
        <select id="role" name="role">
          <option value="staff">운영 담당</option>
          <option value="manager">전체 관리자</option>
        </select>
        <button type="submit" class="btn small ghost">지정</button>
      </form>
      <p class="small muted">관리자로 지정하면 참여자 승인이 해제되고 신청자 목록에서 빠집니다.</p>
    </div>

    ${legacy ? html`<div class="card">
      <h2 class="card-title">이전 등록 방식으로 받은 정보</h2>
      <p class="small muted">현재 신청서에서는 받지 않는 항목입니다. 보관·파기 여부는 기관에서 정해 주세요.</p>
      <dl class="summary">
        ${user.address ? html`<dt>주소</dt><dd>${user.postcode ? `(${user.postcode}) ` : ''}${user.address} ${user.address_detail || ''}</dd>` : ''}
        ${user.birth_date ? html`<dt>생년월일</dt><dd>${formatDate(user.birth_date)}</dd>` : ''}
      </dl>
    </div>` : ''}

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
      <td><span class="theme-tag ${THEMES[p.theme].key}">${themeMark(p.theme)}</span></td>
      <td><a href="/admin/programs/${p.id}">${p.name}</a>${p.archived_at ? html` <span class="chip muted-chip">지난 계획(보관)</span>` : ''}</td>
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
        <option value="${k}"${p.theme === k ? html` selected` : ''}>${t.letter} : ${t.en} — ${t.ko}</option>`)}</select>` })}
    ${field({ id: 'name', label: '프로그램명', error: errors.name,
      input: (d) => textInput({ id: 'name', value: p.name, maxlength: 80, required: true, error: errors.name, describedBy: d }) })}
    ${field({ id: 'detail', label: '세부 내용', input: (d) => textInput({ id: 'detail', value: p.detail, maxlength: 200, describedBy: d }) })}
    ${field({ id: 'schedule_label', label: '운영 계획 표기', hint: '예: 2~11월 · 총 10회',
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
      ${program.assign_mode === 'auto' ? html`<p class="small muted">추가하면 승인된 참여자 전원에게 배정됩니다.</p>` : ''}
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
      ${session.assign_mode === 'select' && session.pending_count ? html`<p class="small">선정 대기 ${session.pending_count}명</p>` : ''}
      ${table(['이름', '전화번호', '구분', '상태', '출석', ''], roster.map((r) => html`<tr>
        <td>${r.name}</td>
        <td>${phoneFor(ctx, r.phone)}</td>
        <td>${{ auto: '자동 배정', select: '희망 신청', manual: '관리자 배정' }[r.source]}</td>
        <td>${r.status === 'active' ? (r.selection ? html`${SELECTION[r.selection]}
          ${r.selection !== 'selected' ? postButton(ctx, `/admin/enrollments/${r.id}/selection`, '선정', { hidden: { decision: 'selected' } }) : ''}
          ${r.selection !== 'not_selected' && !r.attendance ? postButton(ctx, `/admin/enrollments/${r.id}/selection`, '미선정', { cls: 'btn small ghost', hidden: { decision: 'not_selected' } }) : ''}` : '유효')
          : `취소${r.cancel_reason === 'self' ? '(본인)' : r.cancel_reason === 'deselected' ? '(승인 해제)' : ''}`}</td>
        <td>${r.status === 'active' && (!r.selection || r.selection === 'selected') ? html`<form method="post" action="/admin/enrollments/${r.id}/attendance" class="inline-form">
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
      </form>` : html`<p class="muted">배정할 수 있는 승인된 참여자가 없습니다.</p>`}
    </div>` : ''}`);
}

export function linkPage(ctx, { programs, result }) {
  return page(ctx, '관계망 자동 배정', html`
    <h1 class="page-title">관계망 자동 배정</h1>
    <div class="card">
      <p>승인된 참여자 전원을 O 관계망 형성의 전체 참여 프로그램(요리교실·절기행사·나들이·김장나눔활동·자조모임) 모든 회차에 배정합니다. 이미 배정된 회차는 다시 만들지 않습니다.</p>
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
        ${postButton(ctx, '/admin/como/check-all', '승인된 참여자 매핑 확인', { cls: 'btn small' })}
        ${postButton(ctx, '/admin/como/sync-all', '연결된 참여자 현황 갱신', { cls: 'btn small ghost' })}
      </div>` : ''}
    </div>
    <h2 class="sub-title">승인된 참여자</h2>
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

// ── Grow 선정 ─────────────────────────────────────────

const GROW_TABS = { pending: '선정 대기', selected: '선정', not_selected: '미선정', all: '전체' };

export function growAdminPage(ctx, { rows, status }) {
  const back = `/admin/grow?status=${status}`;
  return page(ctx, 'Grow 선정', html`
    <h1 class="page-title">Grow 희망 신청 선정</h1>
    <p class="small muted">참여자가 희망 신청한 성장(Grow) 활동입니다. 선정한 참여자만 일정에 표시됩니다. 정원은 선정 인원 기준입니다.</p>
    <nav class="tabs" aria-label="상태">${Object.entries(GROW_TABS).map(([k, v]) => html`
      <a href="/admin/grow?status=${k}"${k === status ? html` aria-current="page"` : ''}>${v}</a>`)}</nav>
    ${table(['프로그램', '일정', '참여자', '전화번호', '신청일', '선정/정원', '상태', '처리'], rows.map((r) => html`<tr>
      <td><a href="/admin/sessions/${r.session_id}">${r.program_name}${r.round_no ? ` ${r.round_no}회차` : ''}</a></td>
      <td>${when(r)}</td>
      <td>${r.name}</td>
      <td>${phoneFor(ctx, r.phone)}</td>
      <td>${formatDateTime(r.created_at).replace(/ \(.\) \d\d:\d\d$/, '')}</td>
      <td>${r.selected_count}${r.capacity !== null ? ` / ${r.capacity}` : ''}</td>
      <td>${SELECTION[r.selection]}</td>
      <td><div class="row-actions">
        ${r.selection !== 'selected' ? postButton(ctx, `/admin/enrollments/${r.id}/selection`, '선정', { hidden: { decision: 'selected', back } }) : ''}
        ${r.selection !== 'not_selected' ? postButton(ctx, `/admin/enrollments/${r.id}/selection`, '미선정', { cls: 'btn small ghost', hidden: { decision: 'not_selected', back } }) : ''}
        ${r.selection !== 'pending' ? postButton(ctx, `/admin/enrollments/${r.id}/selection`, '대기로', { cls: 'btn small ghost', hidden: { decision: 'pending', back } }) : ''}
      </div></td>
    </tr>`), status === 'pending' ? '선정 대기 중인 희망 신청이 없습니다.' : '없음')}`);
}

// ── 공지 ─────────────────────────────────────────────

export function staffPage(ctx, list) {
  return page(ctx, '관리자', html`
    <h1 class="page-title">관리자</h1>
    <p class="small muted">관리자 지정은 참여자 상세 화면에서 합니다. 새 관리자는 처음 한 번 휴대전화 번호와 비밀번호(기존 PIN 계정은 PIN)로 로그인한 뒤 관리자 아이디·비밀번호를 만듭니다. 운영 담당은 프로그램·회차·출석·게시판·Grow 선정을, 전체 관리자는 신청자 정보·승인·권한까지 관리합니다.</p>
    ${table(['이름', '아이디', '전화번호', '권한', ''], list.map((u) => html`<tr>
      <td>${u.name}</td>
      <td>${u.login_id || html`<span class="muted">미설정</span>`}${u.password_must_change ? html` <span class="small muted">(임시 비밀번호)</span>` : ''}</td>
      <td>${formatPhone(u.phone)}</td>
      <td>${ROLES[u.role]}</td>
      <td><div class="row-actions">
        ${u.id !== ctx.user.id ? postButton(ctx, `/admin/users/${u.id}/reset-code`, '재설정 코드 발급', { cls: 'btn small ghost', hidden: { back: 'staff' } }) : ''}
        ${u.role === 'staff' ? postButton(ctx, `/admin/users/${u.id}/role`, '전체 관리자로', { cls: 'btn small ghost', hidden: { role: 'manager', back: 'staff' } }) : ''}
        ${u.role === 'manager' ? postButton(ctx, `/admin/users/${u.id}/role`, '운영 담당으로', { cls: 'btn small ghost', hidden: { role: 'staff', back: 'staff' } }) : ''}
        ${postButton(ctx, `/admin/users/${u.id}/role`, '권한 해제', { cls: 'btn small ghost', hidden: { role: 'participant', back: 'staff' } })}
      </div></td>
    </tr>`))}`);
}

export function setupPage(ctx, { values = {}, errors = {}, notReady = false }) {
  const input = (id, label, opts = {}) => field({ id, label, error: errors[id], hint: opts.hint,
    input: (d) => textInput({ id, value: opts.secret ? '' : values[id], type: opts.type || 'text', autocomplete: opts.autocomplete || 'off',
      inputmode: opts.inputmode, maxlength: opts.maxlength, required: true, error: errors[id], describedBy: d }) });
  return layout(ctx, {
    title: '첫 관리자 지정',
    area: 'me',
    body: html`<section class="sec narrow"><div class="wrap">
      <h1 class="page-title">첫 관리자 지정</h1>
      ${notReady ? html`<p class="error-summary" role="alert">사용할 수 있는 설정 코드가 없습니다. 기관 담당자에게 문의해 주세요.</p>` : ''}
      ${errorSummary(errors)}
      <form method="post" action="/admin/setup" class="form card" novalidate>
        ${csrfField(ctx)}
        <p class="small muted">전체 관리자가 아직 없을 때 한 번만 사용합니다. 설정 코드와 관리자 정보를 입력하면 전체 관리자 계정이 만들어집니다. 이미 신청한 번호면 그 계정이 관리자가 되고 비밀번호가 새로 정해집니다.</p>
        ${input('secret', '설정 코드', { type: 'password', secret: true, hint: '전달받은 1회용 설정 코드(또는 SESSION_SECRET). 대소문자·하이픈은 구분하지 않습니다.' })}
        ${input('name', '이름', { autocomplete: 'name', maxlength: 40 })}
        ${input('phone', '휴대전화 번호', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 20, hint: '숫자만 입력해도 됩니다.' })}
        ${input('password', '새 비밀번호', { type: 'password', secret: true, autocomplete: 'new-password', maxlength: 64,
          hint: '8자 이상, 영문과 숫자를 함께 사용해 주세요.' })}
        ${input('password_confirm', '새 비밀번호 확인', { type: 'password', secret: true, autocomplete: 'new-password', maxlength: 64 })}
        <button type="submit" class="btn">관리자 지정</button>
      </form>
    </div></section>`,
  });
}
