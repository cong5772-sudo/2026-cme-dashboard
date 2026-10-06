// 간호국 보수교육 이수 대시보드 — 설정
// 이 파일만 고치면 연결 주소·부서 구분·비교 기준을 바꿀 수 있습니다.
window.CME_CONFIG = {
  // Apps Script 웹앱 주소 (README 2단계에서 복사, 끝이 /exec). 비워 두면 sample.json(익명 샘플)을 표시합니다.
  API_URL: 'https://script.google.com/macros/s/AKfycbyGyb9wnfPgaMcjcY3TYOJgzZ6rjYJFuSoKiEXI9bJ5pnu5jn1qa_che8Ia5MSvUvl6Wg/exec',

  // 자동 새로고침 주기(분)
  REFRESH_MIN: 5,

  // 온라인 이수 관리 기준 (30% 초과 시 경고색)
  ONLINE_LIMIT: 0.30,

  // 부서 구분 (신규간호사 대시보드 기준). 여기에 없는 부서는 자동으로 '기타'에 들어갑니다.
  GROUPS: [
    ['일반병동', ['12A', '12B', '11B', '10A', '10B', '8A', '8B', '7B', '6A']],
    ['통합병동', ['14A', '14B', '13A', '13B', '11A', '9A', '9B', '7A']],
    ['중환자',   ['MICU', 'SICU', 'EICU', 'NICU', 'MFI']],
    ['수술회복', ['수술실', '회복실']],
    ['응급',     ['ERD']],
    ['기타',     []]
  ],

  // 시트 표기가 다른 부서명 통일 (왼쪽 → 오른쪽)
  DEPT_ALIAS: { 'ER': 'ERD', '응급실': 'ERD', 'MFICU': 'MFI' },

  // 시트에 아직 없는 과거 연도 실적 (시트에 그 연도 데이터가 쌓이면 시트 값이 우선)
  // total = 면제 제외 이수건수, exempt = 보수교육 면제자
  PREV_STATIC: {
    2025: { total: 1393, face: 763, online: 630, exempt: 19, faceIn: 616, faceOut: 147,
            note: '2025학년도 보수교육 현황' }
  }
};
