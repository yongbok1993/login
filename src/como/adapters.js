import { normalizePhone } from '../lib/phone.js';

/**
 * 꼬모(https://cco-mho.pages.dev/) 연동 어댑터 인터페이스.
 *
 * 꼬모의 소스코드·DB·API 명세·관리자 권한은 아직 제공되지 않았다. 따라서 실제 연동 어댑터는 없다.
 * 운영자에게 연계 방식이 확인되면 아래 인터페이스를 구현한 어댑터를 추가하고 COMO_ADAPTER로 선택한다.
 * 임의의 API 경로를 실제 API처럼 만들지 않는다.
 *
 * {
 *   kind: string,            // 'none' | 'mock' | (실제 연동 시 추가)
 *   configured: boolean,     // 실제 데이터 조회가 가능한지
 *   source: 'live' | 'mock', // 조회 결과의 출처. mock은 화면에 '개발용 모의 데이터'로 표시한다.
 *   // 정규화된 전화번호로 꼬모 계정을 찾는다. 여러 개면 모두 돌려준다(자동 연결 중단 판단용).
 *   findAccountsByPhone(phone): Promise<Array<{ externalId: string, name?: string }>>,
 *   // 회차 정보만 받는다. 상담 내용·상담사 메모·진단·검사 내용은 받지도 저장하지도 않는다.
 *   getCounselingSummary(externalId): Promise<{
 *     completed: number, total: number|null, nextAt: string|null, updatedAt: string|null
 *   }>
 * }
 */

export class ComoNotConfiguredError extends Error {
  constructor() {
    super('como_not_configured');
  }
}

/** 미연결: 어떤 데이터도 만들지 않는다. */
export function createUnconfiguredAdapter() {
  return {
    kind: 'none',
    configured: false,
    source: 'live',
    async findAccountsByPhone() { throw new ComoNotConfiguredError(); },
    async getCounselingSummary() { throw new ComoNotConfiguredError(); },
  };
}

/**
 * 개발용 모의 어댑터. 운영 환경에서는 설정 단계에서 차단된다.
 * 데이터는 COMO_MOCK_JSON 환경 변수(개발용 .dev.vars)로 넣는다. 형식: { "accounts": [{ "externalId", "phone", "name"?, "completed", "total", "nextAt"? }] }
 */
export function createMockAdapter(data) {
  const accounts = (data.accounts || []).map((a) => ({ ...a, phone: normalizePhone(String(a.phone)) }));
  return {
    kind: 'mock',
    configured: true,
    source: 'mock',
    async findAccountsByPhone(phone) {
      return accounts.filter((a) => a.phone === phone).map((a) => ({ externalId: a.externalId, name: a.name }));
    },
    async getCounselingSummary(externalId) {
      const a = accounts.find((x) => x.externalId === externalId);
      if (!a) throw new Error('account_not_found');
      return { completed: a.completed, total: a.total ?? null, nextAt: a.nextAt ?? null, updatedAt: null };
    },
  };
}

export function createComoAdapter(cfg) {
  if (cfg.comoAdapter === 'mock') {
    if (cfg.isProd) throw new Error('mock adapter is not allowed in production');
    let data = { accounts: [] };
    try {
      data = JSON.parse(cfg.comoMockJson);
    } catch {
      // 모의 데이터가 없으면 빈 목록
    }
    return createMockAdapter(data);
  }
  return createUnconfiguredAdapter();
}
