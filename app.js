'use strict';
const CFG = window.CME_CONFIG || {};
const LIMIT = CFG.ONLINE_LIMIT ?? 0.3;
const GROUPS = CFG.GROUPS || [['전체', []]];
const NOW = new Date();
const THIS_Y = NOW.getFullYear();
const TODAY = `${THIS_Y}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;
const CACHE_KEY = 'cme.cache.v1';
const svg = (p, n = 18) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  p1: '<path d="M4 20V11M10 20V5M16 20v-8M21 20H3"/>',
  p2: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  p3: '<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5V8h4M9 12.5h6M9 16h6"/>',
  p4: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17.5" cy="9" r="2.4"/><path d="M17 14.6c2.6.2 4.5 2 4.5 4.9"/>',
  p5: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3.5h6v1M8.8 13l2.4 2.4 4-4.6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
};
const PAGES = [['p1', '보수교육 현황', false], ['p2', '부서별 분석', false], ['p3', '기타교육', true], ['p4', '간호조무사', false], ['p5', '관리점검', true]];

const S = { page: 'p1', year: null, ms: [], sub: 'all', grp: 'all', dept: 'all', view: 'list', search: '',
  kind: { rp: true, at: false, ins: false, err: false }, pw: '', pwErr: '' };
try { S.pw = sessionStorage.getItem('cme.pw') || ''; } catch (e) {}
let RAW = null, REC = [], LOCKED = true, SAMPLE = false;

/* ---------- 접근 구분 ---------- */
// admin: 간호교육팀(비밀번호) 전체 / all: 간호국(구글, 전체 부서) / mgr: 간호단위 파트장(구글, 본인 부서만)
const GCID = CFG.GOOGLE_CLIENT_ID || '';
S.idt = ''; S.me = null; S.rv = 'list'; S.rg = 'all';
try { S.idt = sessionStorage.getItem('cme.idt') || ''; } catch (e) {}
const role = () => S.me ? (S.me.all ? 'all' : 'mgr') : (RAW && !LOCKED ? 'admin' : null);
const ROLE_PAGES = { admin: ['p1', 'p2', 'p3', 'p4', 'p5'], all: ['p1', 'p2', 'p4'], mgr: ['p2'] };
const ROLE_LOCKED = { all: ['p3', 'p5'] }; // 메뉴에는 보이지만 🔒 (간호교육팀 전용)
const roleLabel = () => ({ admin: '관리자 (간호교육팀)', all: '관리자 (간호국)', mgr: '관리자 (간호단위 파트장)' })[role()] + (S.me ? ' · ' + S.me.name : '');
const canGo = id => (ROLE_PAGES[role()] || []).includes(id);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n, d) => d ? (n / d * 100).toFixed(1) + '%' : '–';
const num = n => Number(n).toLocaleString('ko-KR');
// 구글 웹앱은 첫 호출에 일시 오류(HTML)가 나는 경우가 있어 읽기 요청은 한 번 더 시도
async function fetchJson(url, opts, retry) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, opts), t = await r.text();
      try { return JSON.parse(t); } catch (_) { throw new Error('서버가 일시적으로 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.'); }
    } catch (e) { if (!retry || i >= 1) throw e; await new Promise(res => setTimeout(res, 2000)); }
  }
}

/* ---------- 정규화 ---------- */
function pdate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], iso: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
  m = s.match(/^(\d{4})/);
  return m ? { y: +m[1], m: null, iso: null, partial: true } : null;
}
function normalize(raw) {
  const A = CFG.DEPT_ALIAS || {};
  return raw.rows.map(o => {
    const dept0 = String(o.d || '').trim(), dept = A[dept0] || dept0;
    const g = ['보수', '기타', '필수'].includes(String(o.g || '').trim()) ? o.g.trim() : null;
    const f = ['대면', '온라인'].includes(String(o.f || '').trim()) ? o.f.trim() : null;
    const st = pdate(o.s), en = pdate(o.en);
    const issues = [];
    if (!g) issues.push('교육구분 오류');
    if (!f) issues.push('교육형태 오류');
    if (!st) issues.push('교육일 없음');
    else if (st.partial) issues.push('교육일 형식 오류(연도만 입력)');
    else if (st.y > THIS_Y + 1) issues.push(`교육일 오기 의심(${st.y}년)`);
    const future = !!st && st.y > THIS_Y + 1;
    return {
      id: o.n, dept, sub: String(o.sd || '').trim(), emp: o.e || '', name: o.nm || '', title: String(o.t || '').trim(),
      g, f, y: st && !future ? st.y : null, m: st && !future ? st.m : null, iso: st?.iso || null, endIso: en?.iso || null,
      rp: /^y$/i.test(String(o.rp || '').trim()), at: String(o.at || '').trim(), ins: String(o.ins || '').trim(),
      j: o.j === 1 || /조무사/.test(o.jk || ''), jkOnly: o.j !== 1 && /조무사/.test(o.jk || ''), issues
    };
  });
}
const grpOf = d => (GROUPS.find(([, l]) => l.includes(d)) || [GROUPS.at(-1)[0]])[0];

/* ---------- 필터/집계 ---------- */
// 선택한 월(분기 칩은 해당 3개월을 한꺼번에 선택) → '1·2분기' 또는 '3·5·8월'
function msText() {
  const ms = [...S.ms].sort((a, b) => a - b); if (!ms.length) return '';
  const qs = [1, 2, 3, 4].filter(q => [0, 1, 2].every(k => ms.includes(q * 3 - 2 + k)));
  if (qs.length * 3 === ms.length) return qs.join('·') + '분기';
  const parts = []; for (let i = 0; i < ms.length;) { let j = i; while (ms[j + 1] === ms[j] + 1) j++; parts.push(j - i >= 2 ? `${ms[i]}~${ms[j]}` : ms.slice(i, j + 1).join('·')); i = j + 1; }
  return parts.join(', ') + '월';
}
const deptOk = r => (S.dept === 'all' || r.dept === S.dept) && (S.sub === 'all' || r.sub === S.sub);
const deptText = () => S.dept === 'all' ? '' : S.dept + (S.sub !== 'all' && S.sub !== S.dept ? `(${S.sub})` : '');
const inP = r => r.y != null && (S.year === 'all' || r.y === S.year) &&
  (!S.ms.length || (r.m && S.ms.includes(r.m))) && deptOk(r);
const bo = () => REC.filter(r => !r.j && r.g === '보수' && r.f && r.y != null);
const cnt = rows => ({ t: rows.length, f: rows.filter(r => r.f === '대면').length, o: rows.filter(r => r.f === '온라인').length });
const years = () => [...new Set(REC.filter(r => r.y != null).map(r => r.y))].sort((a, b) => b - a);

function prevOf() {
  if (S.year === 'all') return null;
  const y = S.year - 1;
  const rows = bo().filter(r => r.y === y && deptOk(r) && (!S.ms.length || (r.m && S.ms.includes(r.m))));
  if (rows.length) { const c = cnt(rows); return { y, total: c.t, face: c.f, online: c.o, src: '시트 데이터' }; }
  const p = (CFG.PREV_STATIC || {})[y];
  if (p && !S.ms.length && S.dept === 'all') return { y, ...p, src: p.note || '고정 실적' };
  return null;
}

/* ---------- 공통 UI ---------- */
function chart(items, h = 190) {
  const max = Math.max(1, ...items.map(i => i.f + i.o));
  const cols = items.map(it => {
    const t = it.f + it.o, bh = t ? Math.max(4, t / max * h) : 0;
    const fh = t ? it.f / t * 100 : 0;
    return `<div class="cc" title="${it.label}: 대면 ${it.f}명 · 온라인 ${it.o}명"><div class="cv">${t || ''}</div><div class="cb" style="height:${bh.toFixed(1)}px"><i class="o" style="height:${(100 - fh).toFixed(1)}%"></i><i class="f" style="height:${fh.toFixed(1)}%"></i></div><div class="cl">${it.label}</div></div>`;
  }).join('');
  return `<div class="chart" style="height:${h + 46}px" role="img" aria-label="대면·온라인 이수 추이">${cols}</div>
    <div class="legend"><span><i style="background:var(--face)"></i>대면</span><span><i style="background:var(--online)"></i>온라인</span></div>`;
}
const kpi = (l, v, s, cls = '', top = '') => `<div class="card ${top}"><div class="lbl">${l}</div><div class="big ${cls}">${v}</div><div class="sub">${s || ''}</div></div>`;
const bar2 = (f, o, over) => { const t = f + o; return `<div class="bar" title="대면 ${f} · 온라인 ${o}"><i class="b-face" style="width:${t ? f / t * 100 : 0}%"></i><i class="${over ? 'b-crit' : 'b-online'}" style="width:${t ? o / t * 100 : 0}%"></i></div>`; };
const dshort = r => r.iso ? `${+r.iso.slice(5, 7)}/${+r.iso.slice(8)}` + (r.endIso && r.endIso !== r.iso ? `~${+r.endIso.slice(5, 7) === +r.iso.slice(5, 7) ? '' : +r.endIso.slice(5, 7) + '/'}${+r.endIso.slice(8)}` : '') : '–';
const deptLabel = r => r.sub && r.sub !== r.dept ? `${esc(r.dept)} · ${esc(r.sub)}` : esc(r.dept);

function gate(title) {
  return `<div class="card lock"><h2 style="justify-content:center">${svg(ICON.lock, 17)} ${title}</h2><p class="hint">이름·사원번호가 표시되는 페이지입니다. 비밀번호를 입력하세요.</p>
  <input type="password" id="pw" placeholder="비밀번호" autocomplete="current-password" value="">
  <div class="err" id="pwerr">${esc(S.pwErr)}</div><button class="go" data-act="unlock">확인</button></div>`;
}

/* ---------- 페이지 1 ---------- */
function p1() {
  const rows = bo().filter(inP), c = cnt(rows), pv = prevOf();
  const lbl = S.year === 'all' ? '전체 누적' : `${S.year}년${msText() ? ' ' + msText() : ''}${deptText() ? ' · ' + deptText() : ''}`;
  const over = c.t && c.o / c.t > LIMIT;
  const dl = (now, was) => { const d = (now - was) * 100; return Math.abs(d) < 0.05 ? '전년과 동일' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%p vs ${pv.y}`; };
  const pb = pv ? pv.total + (pv.exempt || 0) : 0;
  let cmp = '';
  if (pv) {
    const ex = pv.exempt ?? null, base = pv.total + (ex || 0);
    const pf = pv.face / base * 100, po = pv.online / base * 100, pe = ex ? ex / base * 100 : 0;
    cmp = `<section class="card ref"><h2>전년도 비교 · ${pv.y}년</h2><p class="hint">출처: ${esc(pv.src)}</p>
    <div class="cmp"><b>${pv.y}</b><div class="bar"><i class="b-face" style="width:${pf}%"></i><i class="b-online" style="width:${po}%"></i><i class="b-ex" style="width:${pe}%"></i></div>
      <div class="v">총 ${num(pv.total)}명${ex ? ` (+면제 ${ex})` : ''}</div></div>
    <div class="cmp"><b>${S.year}</b><div class="bar"><i class="b-face" style="width:${c.t ? c.f / c.t * 100 : 0}%"></i><i class="b-online" style="width:${c.t ? c.o / c.t * 100 : 0}%"></i></div>
      <div class="v">총 ${num(c.t)}명${S.year === THIS_Y ? ' (진행중)' : ''}</div></div>
    <div class="grid k3 refk" style="margin:10px 0 0">
      ${kpi(`${pv.y}년 대면 이수자`, `${num(pv.face)}명`, `${pct(pv.face, base)}${pv.faceIn ? ` · 본원 ${pv.faceIn}명 / 외부 ${pv.faceOut}명` : ''}`, 'c-face')}
      ${kpi(`${pv.y}년 온라인 이수자`, `${num(pv.online)}명`, pct(pv.online, base), 'c-online')}
      ${kpi(`${pv.y}년 면제자`, ex != null ? `${num(ex)}명` : '–', ex != null ? pct(ex, base) : '시트 데이터에 면제 구분 없음')}
    </div>
    <div class="note">${pv.y}년 비율은 면제자 포함 ${num(base)}명 기준입니다. 온라인 비율 변화: ${pct(pv.online, base)} → ${pct(c.o, c.t)}</div></section>`;
  }
  const items = S.year === 'all'
    ? years().slice().reverse().map(y => { const r = bo().filter(x => x.y === y); const k = cnt(r); return { label: String(y), f: k.f, o: k.o }; })
    : Array.from({ length: 12 }, (_, i) => { const k = cnt(rows.filter(r => r.m === i + 1)); return { label: `${i + 1}월`, f: k.f, o: k.o }; });
  const noMonth = rows.filter(r => !r.m).length;
  const qrows = [1, 2, 3, 4].map(q => { const k = cnt(rows.filter(r => r.m && Math.ceil(r.m / 3) === q)); return `<tr><td>${q}분기</td><td class="num">${k.t}</td><td class="num">${k.f} (${pct(k.f, k.t)})</td><td class="num">${k.o} (${pct(k.o, k.t)})</td></tr>`; }).join('');
  return `<div class="grid k4 hero">
    ${kpi('보수교육 총 이수', `${num(c.t)}명`, `${lbl} · 간호조무사 제외`, '', 't-main')}
    ${kpi('대면 이수자', `${num(c.f)}명`, `<b>${pct(c.f, c.t)}</b>${pv && c.t ? ' · ' + dl(c.f / c.t, pv.face / pb) : ''}`, 'c-face', 't-face')}
    ${kpi('온라인 이수자', `${num(c.o)}명`, `<b>${pct(c.o, c.t)}</b>${pv && c.t ? ' · ' + dl(c.o / c.t, pv.online / pb) : ''}`, 'c-online', 't-online')}
    ${kpi('온라인 관리기준', over ? '초과' : '이내', `기준 ${Math.round(LIMIT * 100)}% · 현재 ${pct(c.o, c.t)}`, over ? 'c-crit' : 'c-ok', over ? 't-crit' : 't-ok')}
  </div>${cmp ? `<div style="margin-bottom:12px">${cmp}</div>` : ''}
  <section class="card" style="margin-bottom:12px"><h2>${S.year === 'all' ? '연도별' : '월별'} 이수 추이</h2><p class="hint">${lbl}${noMonth ? ` · 교육일 미상 ${noMonth}건은 월별에서 제외` : ''}</p>${chart(items)}</section>
  <section class="card qt"><h2>분기별 현황</h2><div class="tw"><table><thead><tr><th>분기</th><th class="num">이수(명)</th><th class="num">대면(명/비율)</th><th class="num">온라인(명/비율)</th></tr></thead><tbody>${qrows}</tbody><tfoot><tr><td>합계${noMonth ? ` <span class="tag">월 미상 ${noMonth}건 포함</span>` : ''}</td><td class="num">${c.t}</td><td class="num">${c.f} (${pct(c.f, c.t)})</td><td class="num">${c.o} (${pct(c.o, c.t)})</td></tr></tfoot></table></div></section>`;
}

/* ---------- 페이지 2 ---------- */
const periodLabel = () => (S.year === 'all' ? '전체 기간(누적)' : `${S.year}년`) + (S.ms.length ? ' ' + msText() : (S.year !== 'all' ? ' 1월~' + (S.year === THIS_Y ? (NOW.getMonth() + 1) : 12) + '월' : ''));
const printStamp = () => `${THIS_Y}.${String(NOW.getMonth() + 1).padStart(2, '0')}.${String(NOW.getDate()).padStart(2, '0')} ${String(NOW.getHours()).padStart(2, '0')}:${String(NOW.getMinutes()).padStart(2, '0')}`;
function p2() {
  const rows = REC.filter(r => !r.j && r.y != null && r.dept && inP(r));
  const D = {};
  rows.forEach(r => {
    const d = D[r.dept] = D[r.dept] || { f: 0, o: 0, etc: 0, req: 0 };
    if (r.g === '보수' && r.f) r.f === '대면' ? d.f++ : d.o++;
    else if (r.g === '기타') d.etc++;
    else if (r.g === '필수') d.req++;
  });
  const gs = GROUPS.map(([g, list]) => {
    const present = Object.keys(D).filter(d => grpOf(d) === g);
    const ordered = list.filter(d => D[d]).concat(present.filter(d => !list.includes(d)).sort((a, b) => (D[b].f + D[b].o) - (D[a].f + D[a].o)));
    const sum = ordered.reduce((s, d) => ({ f: s.f + D[d].f, o: s.o + D[d].o, etc: s.etc + D[d].etc, req: s.req + D[d].req }), { f: 0, o: 0, etc: 0, req: 0 });
    return { g, ds: ordered, sum };
  }).filter(x => x.ds.length);
  const show = gs.filter(x => S.grp === 'all' || x.g === S.grp);
  const cell = (f, o) => `<td class="num">${f + o}</td><td class="num">${f} (${pct(f, f + o)})</td><td class="num">${o} (${pct(o, f + o)})</td>`;
  let body = '', tot = { f: 0, o: 0, etc: 0, req: 0 }, nOver = 0;
  show.forEach(({ g, ds, sum }, gi) => {
    body += `<tbody class="grp${gi === 3 ? ' pbreak' : ''}"><tr class="gh"><td colspan="7">${esc(g)} <span class="tag">${ds.length}개 부서</span></td></tr>`;
    ds.forEach(d => {
      const x = D[d], t = x.f + x.o, over = t > 0 && x.o / t > LIMIT; if (over) nOver++;
      body += `<tr class="${over ? 'over' : ''}"><td>${esc(d)}</td>${cell(x.f, x.o)}<td>${bar2(x.f, x.o, over)}</td><td class="num np">${x.etc || '–'} / ${x.req || '–'}</td></tr>`;
    });
    body += `<tr class="sub"><td>${esc(g)} 소계</td>${cell(sum.f, sum.o)}<td></td><td class="num np">${sum.etc} / ${sum.req}</td></tr></tbody>`;
    Object.keys(tot).forEach(k => tot[k] += sum[k]);
  });
  const cards = gs.map(({ g, sum }) => kpi(esc(g), `${num(sum.f + sum.o)}명`, `대면 ${sum.f} · 온라인 ${sum.o} (${pct(sum.o, sum.f + sum.o)})`)).join('');
  return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${cards}</div>
  <section class="card"><div class="tools"><span class="fl">구분</span>${[['all', '전체'], ...GROUPS.map(([g]) => [g, g])].map(([v, l]) => `<button class="chip" data-act="grp" data-v="${esc(v)}" aria-pressed="${S.grp === v}">${esc(l)}</button>`).join('')}
    ${nOver ? `<span class="tag crit">온라인 ${Math.round(LIMIT * 100)}% 초과 ${nOver}곳</span>` : '<span class="tag good">온라인 기준 이내</span>'}</div>
  <div class="printhead"><h1>부서별 보수교육 이수 현황</h1><div class="pmeta"><span><b>기준일시</b> ${periodLabel()}</span><span><b>${S.dept === 'all' ? '구분' : '부서'}</b> ${S.dept !== 'all' ? esc(deptText()) : S.grp === 'all' ? '전체' : esc(S.grp)}</span><span><b>출력일시</b> ${printStamp()}</span></div>
  <div class="psum">총 이수 <b>${num(tot.f + tot.o)}명</b> · 대면 <b>${num(tot.f)}명</b> (${pct(tot.f, tot.f + tot.o)}) · 온라인 <b>${num(tot.o)}명</b> (${pct(tot.o, tot.f + tot.o)})</div></div>
  <div class="screen-only tools" style="justify-content:flex-end"><button class="chip" data-act="print" style="background:var(--accent);color:var(--accent-ink);border-color:var(--accent)">🖨 PDF 출력 (A4 1장)</button></div>
  <h2 class="screen-only">부서별 보수교육 이수 현황</h2><p class="hint">부서 구분은 신규간호사 대시보드 기준 · 간호조무사 제외 · 교육 당시 부서 기준</p>
  <div class="tw"><table><thead><tr><th>간호단위</th><th class="num">이수(명)</th><th class="num">대면 명(%)</th><th class="num">온라인 명(%)</th><th>대면/온라인</th><th class="num np">기타 / 필수(명)</th></tr></thead>
  ${body || '<tbody><tr><td colspan="7" class="msg">해당 기간 데이터가 없습니다.</td></tr></tbody>'}
  <tfoot><tr><td>전체 합계</td>${cell(tot.f, tot.o)}<td></td><td class="num np">${tot.etc} / ${tot.req}</td></tr></tfoot></table></div>
  <div class="printfoot">※ 대면·온라인 비율은 부서별 보수교육 이수 건수 기준, 간호조무사 제외, 교육 당시 부서 기준입니다.<br>※ 분홍색 행은 온라인 이수 비율이 ${Math.round(LIMIT * 100)}%를 초과한 부서입니다.<div style="margin-top:3mm;text-align:right;color:#333;font-weight:600">인제대학교 해운대백병원 간호국 · 관리자(교육파트장)</div></div></section>${missingSec()}${rosterSec()}`;
}

/* ---------- 페이지 3 ---------- */
function p3() {
  if (LOCKED) return gate('기타교육 이수 명단');
  const all = REC.filter(r => !r.j && r.g === '기타' && inP(r));
  const q = S.search.trim();
  const rows = all.filter(r => (!q || r.name.includes(q) || r.title.includes(q) || r.emp.includes(q)))
    .sort((a, b) => (a.iso || '9').localeCompare(b.iso || '9') || a.dept.localeCompare(b.dept));
  const edu = new Set(rows.map(r => r.title + '|' + r.iso)).size;
  const th = '<thead><tr><th>교육일</th><th>부서</th><th>이름</th><th>사원번호</th><th>교육명</th></tr></thead>';
  const tr = r => `<tr><td>${dshort(r)}</td><td>${deptLabel(r)}</td><td>${esc(r.name)}</td><td>${esc(r.emp)}</td><td class="wrap">${esc(r.title)}</td></tr>`;
  let tbl;
  if (S.view === 'edu') {
    const m = new Map(); rows.forEach(r => { const k = r.title + '|' + r.iso; (m.get(k) || m.set(k, []).get(k)).push(r); });
    tbl = th + '<tbody>' + [...m.values()].map(l => `<tr class="gh"><td colspan="5">${dshort(l[0])} · ${esc(l[0].title)} <span class="tag">${l.length}명</span></td></tr>${l.map(tr).join('')}`).join('') + '</tbody>';
  } else tbl = th + `<tbody>${rows.map(tr).join('') || '<tr><td colspan="5" class="msg">해당 조건의 명단이 없습니다.</td></tr>'}</tbody>`;
  return `<div class="grid k2">${kpi('기타교육 참석', `${rows.length}명`, '간호조무사 제외')}${kpi('교육 건수', `${edu}건`, '교육명·일자 기준')}</div>
  <section class="card"><div class="tools"><input type="search" id="q" placeholder="이름·사번·교육명 검색" value="${esc(S.search)}">
    <button class="chip" data-act="view" data-v="list" aria-pressed="${S.view === 'list'}">목록</button><button class="chip" data-act="view" data-v="edu" aria-pressed="${S.view === 'edu'}">교육별</button></div>
  <div class="tw"><table>${tbl}</table></div></section>`;
}

/* ---------- 페이지 4 ---------- */
function p4() {
  const rows = REC.filter(r => r.j && r.g === '보수' && r.f && inP(r)), c = cnt(rows);
  const D = {}; rows.forEach(r => { const d = D[r.dept] = D[r.dept] || { f: 0, o: 0 }; r.f === '대면' ? d.f++ : d.o++; });
  const ds = Object.keys(D).sort((a, b) => (D[b].f + D[b].o) - (D[a].f + D[a].o));
  const items = S.year === 'all' ? [] : Array.from({ length: 12 }, (_, i) => { const k = cnt(rows.filter(r => r.m === i + 1)); return { label: `${i + 1}월`, f: k.f, o: k.o }; });
  const excl = REC.filter(r => r.j).length, jkOnly = REC.filter(r => r.jkOnly).length;
  return `<div class="grid k3">${kpi('간호조무사 보수교육', `${num(c.t)}명`, '조무사만 별도 집계')}${kpi('대면', `${num(c.f)}명`, pct(c.f, c.t), 'c-face')}${kpi('온라인', `${num(c.o)}명`, pct(c.o, c.t), 'c-online')}</div>
  ${items.length ? `<section class="card" style="margin-bottom:12px"><h2>월별 이수</h2>${chart(items)}</section>` : ''}
  <section class="card" style="margin-bottom:12px"><h2>간호단위별 현황</h2><div class="tw"><table><thead><tr><th>간호단위</th><th class="num">이수(명)</th><th class="num">대면 명(%)</th><th class="num">온라인 명(%)</th><th>대면/온라인</th></tr></thead><tbody>
  ${ds.map(d => { const x = D[d], t = x.f + x.o; return `<tr><td>${esc(d)}</td><td class="num">${t}</td><td class="num">${x.f} (${pct(x.f, t)})</td><td class="num">${x.o} (${pct(x.o, t)})</td><td>${bar2(x.f, x.o, false)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="msg">해당 기간 데이터가 없습니다.</td></tr>'}</tbody></table></div></section>
  <section class="card"><h2>제외 검증</h2><p class="hint">다른 페이지에서 제외된 간호조무사 교육 기록입니다.</p>
  <div class="grid k3" style="margin:0">${kpi('주소록 조무사 사번', RAW.jomusaRoster ? `${num(RAW.jomusaRoster)}명` : '미연동', RAW.jomusaRoster ? '조무사사번 탭 기준' : '직종 열 표시만 사용 중')}${kpi('제외된 교육 기록', `${excl}건`, '전체 기간·전체 구분')}${kpi('직종 열만 표시된 건', `${jkOnly}건`, '주소록과 불일치 → 확인 필요')}</div></section>`;
}

/* ---------- 페이지 5 ---------- */
function p5() {
  if (LOCKED) return gate('관리점검 (미제출자 확인)');
  const base = REC.filter(r => !r.j && (r.y != null ? inP(r) : S.year === 'all' && !S.ms.length));
  const due = r => !r.iso || (r.endIso || r.iso) <= TODAY;
  const tags = r => { const t = [];
    if (S.kind.rp && !r.rp) t.push('결과보고서');
    if (S.kind.at && !r.at) t.push('근태 미확인');
    if (S.kind.ins && r.ins !== '일치') t.push('검수 확인');
    if (S.kind.err && r.issues.length) t.push(...r.issues);
    return t; };
  const q = S.search.trim();
  const upcoming = base.filter(r => !due(r) && !r.rp).length;
  const rows = base.filter(r => due(r) && tags(r).length && (!q || r.name.includes(q) || r.emp.includes(q) || r.title.includes(q)))
    .sort((a, b) => a.dept.localeCompare(b.dept) || (a.iso || '').localeCompare(b.iso || ''));
  const D = {}; rows.forEach(r => D[r.dept] = (D[r.dept] || 0) + 1);
  const top = Object.entries(D).sort((a, b) => b[1] - a[1]).slice(0, 8), mx = top[0]?.[1] || 1;
  const kinds = [['rp', '결과보고서 미제출'], ['at', '근태 미확인'], ['ins', '검수 확인필요'], ['err', '데이터 오류']];
  const lbl = S.year === 'all' ? '전체' : `${S.year}년${msText() ? ' ' + msText() : ''}`;
  return `<div class="grid k3">${kpi('점검 대상', `${rows.length}건`, `${lbl} · 오늘(${TODAY}) 이전 교육`, rows.length ? '' : '')}${kpi('해당 부서', `${Object.keys(D).length}곳`, top.slice(0, 3).map(([d, n]) => `${esc(d)} ${n}`).join(' · '))}${kpi('교육 예정(제외)', `${upcoming}건`, '교육일이 아직 안 지난 보고서 미제출')}</div>
  <section class="card" style="margin-bottom:12px"><div class="tools"><span class="fl">점검 항목</span>${kinds.map(([k, l]) => `<button class="chip" data-act="kind" data-v="${k}" aria-pressed="${S.kind[k]}">${l}</button>`).join('')}
    <input type="search" id="q" placeholder="이름·사번·교육명 검색" value="${esc(S.search)}"></div>
  <p class="hint">상단 기준일시(연도·월)를 바꿔 월별 미제출자를 확인하세요. 근태확인 열은 시트에서 일부만 입력되어 기본으로는 끕니다.</p>
  ${top.length ? top.map(([d, n]) => `<div class="cmp" style="grid-template-columns:70px 1fr 50px"><b>${esc(d)}</b><div class="bar"><i class="b-crit" style="width:${n / mx * 100}%"></i></div><div class="v">${n}건</div></div>`).join('') : ''}</section>
  <section class="card"><h2>${lbl} 점검 명단</h2><div class="tw"><table><thead><tr><th>부서</th><th>이름</th><th>사원번호</th><th>교육일</th><th>구분</th><th>교육명</th><th>미비 항목</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${deptLabel(r)}</td><td>${esc(r.name)}</td><td>${esc(r.emp)}</td><td>${dshort(r)}</td><td>${esc(r.g || '–')}</td><td class="wrap">${esc(r.title)}</td><td>${tags(r).map(t => `<span class="tag crit">${esc(t)}</span>`).join(' ')}</td></tr>`).join('') || '<tr><td colspan="7" class="msg">✔ 해당 조건의 미비 건이 없습니다.</td></tr>'}</tbody></table></div></section>`;
}

/* ---------- 렌더링 ---------- */
// 부서 콤보 목록: 부서군 순서대로, 세부부서는 선택한 부서의 것만
function deptOptions() {
  const rows = REC.filter(r => r.dept && r.y != null);
  const ds = role() === 'mgr' ? S.me.depts.slice() : [...new Set(rows.map(r => r.dept))];
  const groups = GROUPS.map(([g, list]) => [g, list.filter(d => ds.includes(d)).concat(ds.filter(d => grpOf(d) === g && !list.includes(d)).sort())]).filter(([, l]) => l.length);
  const subs = S.dept === 'all' ? [] : [...new Set(rows.filter(r => r.dept === S.dept && r.sub).map(r => r.sub))].sort();
  return { groups, subs };
}
// 간호단위 파트장: 본인 부서 밖의 선택은 허용하지 않음(서버도 본인 부서 데이터만 내려줌)
const mgrDepts = () => role() === 'mgr' ? S.me.depts : null;
function enforceDept() {
  const md = mgrDepts(); if (!md) return;
  if (md.length === 1) S.dept = md[0];
  else if (S.dept !== 'all' && !md.includes(S.dept)) { S.dept = 'all'; S.sub = 'all'; }
}
function filters() {
  enforceDept();
  const md = mgrDepts(), lockOne = !!md && md.length === 1;
  const ys = years();
  const dp = deptOptions();
  const sumTxt = (S.year === 'all' ? '전체 기간' : S.year + '년') + (msText() ? ' · ' + msText() : ' · 월 전체') + ((deptText() || (md ? '내 부서' : '')) ? ' · ' + (deptText() || '내 부서') : '');
  $('filters').classList.toggle('open', !!S.fopen);
  $('filters').innerHTML = `<button class="fsum" data-act="ftoggle" aria-expanded="${!!S.fopen}"><span class="fs-l">기준일시</span><span class="fs-v">${esc(sumTxt)}</span><span class="fs-h">${S.fopen ? '접기' : '조절'}</span><span class="fs-c">▾</span></button><div class="fbody"><div class="fg"><span class="fl">기준일시</span>${[['all', '전체'], ...ys.map(y => [y, y + '년'])].map(([v, l]) => `<button class="chip" data-act="year" data-v="${v}" aria-pressed="${S.year === (v === 'all' ? 'all' : +v)}">${l}</button>`).join('')}</div>
  <div class="fg"><span class="fl">분기</span><button class="chip" data-act="qall" aria-pressed="${!S.ms.length}">전체</button>${[1, 2, 3, 4].map(q => `<button class="chip" data-act="q" data-v="${q}" aria-pressed="${[0, 1, 2].every(k => S.ms.includes(q * 3 - 2 + k))}">${q}분기</button>`).join('')}</div>
  <div class="fg mo"><span class="fl">월</span>${Array.from({ length: 12 }, (_, i) => `<button class="chip" data-act="mo" data-v="${i + 1}" aria-pressed="${S.ms.includes(i + 1)}">${i + 1}월</button>`).join('')}</div>
  <div class="fg dp"><span class="fl">부서${md ? ' <span class="lockt">· 본인 부서만 조회</span>' : ''}</span><select data-act="dept" aria-label="부서 선택" ${lockOne ? 'disabled' : ''}>${lockOne ? '' : `<option value="all">${md ? '내 부서 전체' : '전체 부서'}</option>`}${dp.groups.map(([g, ds]) => `<optgroup label="${esc(g)}">${ds.map(d => `<option value="${esc(d)}" ${S.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</optgroup>`).join('')}</select>
  <span class="fl">세부부서</span><select data-act="sub" aria-label="세부부서 선택" ${dp.subs.length > 1 ? '' : 'disabled'}><option value="all">${S.dept === 'all' ? '부서를 먼저 선택' : dp.subs.length > 1 ? '전체 세부부서' : '세부부서 없음'}</option>${dp.subs.map(x => `<option value="${esc(x)}" ${S.sub === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div></div>`;
}
function nav() {
  const r = role(), ok = ROLE_PAGES[r] || [], lk = ROLE_LOCKED[r] || [];
  const show = PAGES.filter(([id]) => ok.includes(id) || lk.includes(id));
  const lock = svg(ICON.lock, 12);
  $('navtop').innerHTML = show.map(([id, l]) => { const d = lk.includes(id); return `<button class="navbtn${d ? ' lkd' : ''}" data-act="page" data-v="${id}" ${S.page === id ? 'aria-current="page"' : ''}${d ? ' title="간호교육팀 관리자만 사용할 수 있습니다"' : ''}><span class="ic">${svg(ICON[id], 18)}</span><span class="tx">${l}</span>${d ? `<span class="lk" title="간호교육팀 전용">${lock}</span>` : ''}</button>`; }).join('');
  $('navbot').innerHTML = show.map(([id, l]) => { const d = lk.includes(id); return `<button class="${d ? 'lkd' : ''}" data-act="page" data-v="${id}" ${S.page === id ? 'aria-current="page"' : ''}><b>${svg(ICON[id], 21)}</b>${l}${d ? ' ' + lock : ''}</button>`; }).join('');
}
function applyAuth() {
  const r = role(), ok = ROLE_PAGES[r] || [];
  $('login').hidden = !!r; document.body.classList.toggle('locked', !r);
  $('role').hidden = $('logout').hidden = $('edulink').hidden = !r;
  if (r) { $('role').textContent = roleLabel(); if (!ok.includes(S.page)) { S.page = ok[0]; try { history.replaceState(null, '', '#' + S.page); } catch (e) {} } }
  else { $('lgerr').textContent = S.pwErr || ''; }
}
function render() {
  applyAuth();
  if (!role()) { $('view').innerHTML = ''; return; }
  nav();
  if (!REC.length && !RAW) return;
  if (S.year == null) { const ys = years().filter(y => y <= THIS_Y); S.year = ys[0] ?? 'all'; }
  filters();
  const banner = SAMPLE ? '<div class="banner">미리보기용 익명 샘플 데이터입니다. config.js 의 API_URL 을 연결하면 구글시트 실데이터로 바뀝니다.</div>' : '';
  $('view').innerHTML = banner + ({ p1, p2, p3, p4, p5 })[S.page]();
}
function setState(kind, text) { $('dot').dataset.s = kind; if (text) $('upd').textContent = text; }

/* ---------- 데이터 로드 ---------- */
function apply(data, state) {
  RAW = data; SAMPLE = !!data.sample; LOCKED = SAMPLE ? false : data.locked !== false;
  REC = normalize(data); setState(state, '갱신 ' + String(data.lastUpdate || '').slice(5).replace('-', '/'));
  render();
}
async function load(pw) {
  try {
    let url = 'sample.json';
    if (CFG.API_URL) url = CFG.API_URL + (CFG.API_URL.includes('?') ? '&' : '?') + 'app=cme' + (pw ? '&pw=' + encodeURIComponent(pw) : '');
    const data = await fetchJson(url, { cache: 'no-store' }, true);
    if (data.error) throw new Error(data.error);
    if (pw && data.pwError) { S.pwErr = '비밀번호가 올바르지 않습니다.'; S.pw = ''; try { sessionStorage.removeItem('cme.pw'); } catch (e) {} }
    else if (pw && data.locked === false) { S.pwErr = ''; try { sessionStorage.setItem('cme.pw', pw); } catch (e) {} }
    apply(data, 'live');
  } catch (err) {
    S.pwErr = '서버에 연결하지 못했습니다: ' + String(err.message || err);
    if (RAW) setState('error', '불러오기 실패 · 이전 데이터 표시 중'); else render();
    setState('error');
  }
}
// 구글 로그인(간호국·파트장): 서버가 이메일을 확인해 허용된 부서의 명단만 내려줌
async function loadGoogle(cred) {
  try {
    const url = CFG.API_URL + (CFG.API_URL.includes('?') ? '&' : '?') + 'app=cme&idt=' + encodeURIComponent(cred);
    const data = await fetchJson(url, { cache: 'no-store' }, true);
    if (data.error) throw new Error(data.error);
    S.idt = cred; S.me = data.me; S.pw = ''; S.pwErr = '';
    try { sessionStorage.setItem('cme.idt', cred); sessionStorage.removeItem('cme.pw'); } catch (e) {}
    apply(data, 'live'); $('lgerr2').textContent = '';
    return true;
  } catch (err) {
    const msg = String(err.message || err);
    if (!S.me || /만료|올바르지|등록되지|대시보드용|발급자|인증되지|로그인 정보/.test(msg)) { resetData(); $('lgerr2').textContent = msg; render(); }
    else setState('error', '불러오기 실패 · 이전 데이터 표시 중');
    return false;
  }
}
function resetData() {
  S.pw = ''; S.idt = ''; S.me = null; RAW = null; REC = []; LOCKED = true;
  ['cme.pw', 'cme.idt'].forEach(k => { try { sessionStorage.removeItem(k); } catch (e) {} });
}
function logout() {
  resetData(); S.pwErr = ''; S.search = ''; $('lgerr2').textContent = '';
  try { google.accounts.id.disableAutoSelect(); } catch (e) {}
  render(); initGoogle();
}
const reload = () => S.idt ? loadGoogle(S.idt) : (S.pw ? load(S.pw) : (CFG.API_URL ? null : load('')));

/* ---------- 구글 로그인 버튼 ---------- */
let GIS_P = null, GIS_INIT = false;
const loadGIS = () => (window.google && google.accounts && google.accounts.id) ? Promise.resolve() : (GIS_P ||= new Promise((res, rej) => {
  const el = document.createElement('script'); el.src = 'https://accounts.google.com/gsi/client'; el.async = true; el.onload = res;
  el.onerror = () => { GIS_P = null; rej(new Error('구글 로그인 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); }; document.head.appendChild(el);
}));
async function initGoogle() {
  if (role()) return;
  if (!GCID || !CFG.API_URL) { $('lgerr2').textContent = '구글 로그인이 설정되지 않았습니다. 교육팀에 문의하세요.'; return; }
  try {
    await loadGIS();
    if (!GIS_INIT) { google.accounts.id.initialize({ client_id: GCID, callback: r => { $('lgerr2').textContent = '확인 중… (처음에는 30초 정도 걸릴 수 있습니다)'; loadGoogle(r.credential); }, auto_select: false }); GIS_INIT = true; }
    $('lgbtn').innerHTML = ''; google.accounts.id.renderButton($('lgbtn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ko', width: 260 });
  } catch (e) { $('lgerr2').textContent = String(e.message || e); }
}

/* ---------- 세부 이수 명단 (이름·사번 포함) + 엑셀 · PDF ---------- */
function rosterRows(useSearch) {
  const q = useSearch ? S.search.trim() : '';
  return REC.filter(r => !r.j && r.g && (S.rg === 'all' || r.g === S.rg) && r.y != null && r.name && inP(r) && (!q || r.name.includes(q) || String(r.emp).includes(q) || r.title.includes(q)))
    .sort((a, b) => (a.iso || '9').localeCompare(b.iso || '9') || a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name, 'ko'));
}
function rosterPeople(rows) {
  const m = new Map();
  rows.forEach(r => { const k = r.emp || r.name; const o = m.get(k) || m.set(k, { name: r.name, emp: r.emp, dept: r.dept, sub: r.sub, n: 0, f: 0, o: 0, g: { 보수: 0, 기타: 0, 필수: 0 } }).get(k); o.n++; o.g[r.g]++; if (r.f === '대면') o.f++; else if (r.f === '온라인') o.o++; });
  return [...m.values()].sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name, 'ko'));
}
/* ---------- 결과보고서 미제출 명단 (교육이 끝났는데 결과보고서 제출여부가 Y가 아닌 대상자) ---------- */
function missingRows() {
  const due = r => !r.iso || (r.endIso || r.iso) <= TODAY;
  return REC.filter(r => !r.j && r.name && !r.rp && due(r) && (r.y != null ? inP(r) : S.year === 'all' && !S.ms.length))
    .sort((a, b) => (a.iso || '9').localeCompare(b.iso || '9') || a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name, 'ko'));
}
function missingSec() {
  if (LOCKED && !S.me) return '';
  const rows = missingRows();
  const body = rows.map(r => `<tr><td class="c-d">${dshort(r)}</td><td class="c-u">${deptLabel(r)}</td><td class="c-n">${esc(r.name)}</td><td class="c-s">${esc(r.emp)}</td><td class="c-g">${esc(r.g || '')}</td><td class="wrap c-t">${esc(r.title)}</td><td class="c-f ${r.f === '대면' ? 'f' : 'o'}">${esc(r.f || '')}</td></tr>`).join('');
  return `<section class="card screen-only" id="missing" style="margin-top:12px">
    <h2>결과보고서 미제출 명단 <span class="tag ${rows.length ? 'warn' : ''}">${num(rows.length)}건</span></h2>
    <p class="hint np">${esc(periodLabel())} · 교육이 끝났지만 시트의 결과보고서 제출여부가 <b>Y</b>로 표시되지 않은 대상자입니다. 제출을 잊은 분께 안내해 주세요. 제출 후 시트에 반영되면 목록에서 사라집니다.</p>
    ${rows.length ? `<div class="rs-tools np"><span class="sp"></span><button class="btn" data-act="xlmiss">엑셀 다운로드</button></div>
    <div class="rs-scroll tw"><table class="rl"><thead><tr><th>교육일</th><th>부서</th><th>성명</th><th>사번</th><th>구분</th><th>교육명</th><th>형태</th></tr></thead><tbody>${body}</tbody></table></div>`
      : '<div class="msg" style="padding:14px">조회 조건에 결과보고서 미제출 대상자가 없습니다. 👍</div>'}
  </section>`;
}
async function exportMissing() {
  try {
    const rows = missingRows(); if (!rows.length) { alert('미제출 대상자가 없습니다.'); return; }
    const X = await loadXLSX(), wb = X.utils.book_new();
    const ws = X.utils.aoa_to_sheet([['교육일', '부서', '성명', '사번', '구분', '교육명', '형태'], ...rows.map(r => [r.iso || '', r.sub && r.sub !== r.dept ? r.dept + ' · ' + r.sub : r.dept, r.name, r.emp, r.g || '', r.title, r.f || ''])]);
    ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 56 }, { wch: 8 }]; ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    X.utils.book_append_sheet(wb, ws, '결과보고서 미제출');
    const scope = S.me ? (S.me.all ? '전체부서' : S.me.depts.join('_')) : (S.dept === 'all' ? '전체부서' : S.dept);
    X.writeFile(wb, `결과보고서_미제출_${periodLabel().replace(/\s+/g, '')}_${scope}.xlsx`.replace(/[\/:*?"<>|]/g, ''));
  } catch (e) { alert(e.message || e); }
}

function rosterSec() {
  if (LOCKED && !S.me) return '';
  const all = rosterRows(false), rows = rosterRows(true), people = rosterPeople(rows), c = cnt(rows), gc = { 보수: 0, 기타: 0, 필수: 0 };
  rows.forEach(r => gc[r.g]++);
  const scope = S.me ? (S.me.all ? '전체 부서' : S.me.depts.join('·')) : (S.dept === 'all' ? '전체 부서' : deptText());
  const list = S.rv === 'list'
    ? `<thead><tr><th>교육일</th><th>부서</th><th>성명</th><th>사번</th><th>구분</th><th>교육명</th><th>형태</th></tr></thead><tbody>${rows.map(r => `<tr><td class="c-d">${dshort(r)}</td><td class="c-u">${deptLabel(r)}</td><td class="c-n">${esc(r.name)}</td><td class="c-s">${esc(r.emp)}</td><td class="c-g"><span class="gt gt-${esc(r.g)}">${esc(r.g)}</span></td><td class="wrap c-t">${esc(r.title)}</td><td class="c-f ${r.f === '대면' ? 'f' : 'o'}">${esc(r.f || '–')}</td></tr>`).join('') || '<tr><td colspan="7" class="msg">조회 조건에 해당하는 이수 명단이 없습니다.</td></tr>'}</tbody>`
    : `<thead><tr><th>성명</th><th>사번</th><th>부서</th><th class="num">이수(건)</th><th class="num">보수</th><th class="num">기타</th><th class="num">필수</th></tr></thead><tbody>${people.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.emp)}</td><td>${esc(p.sub && p.sub !== p.dept ? p.dept + ' · ' + p.sub : p.dept)}</td><td class="num">${p.n}</td><td class="num">${p.g.보수 || '–'}</td><td class="num">${p.g.기타 || '–'}</td><td class="num">${p.g.필수 || '–'}</td></tr>`).join('') || '<tr><td colspan="7" class="msg">조회 조건에 해당하는 이수 명단이 없습니다.</td></tr>'}</tbody>`;
  return `<section class="card screen-only" id="roster" style="margin-top:12px">
    <h2>세부 이수 명단 <span class="tag">${esc(scope)}</span></h2>
    <p class="hint np">${esc(periodLabel())} · 보수·기타·필수교육(간호조무사 제외) · 상단 조회 조건(기간·부서)이 그대로 적용됩니다. 구분 버튼으로 교육 종류를 골라 볼 수 있습니다. 이름·사번이 포함된 개인정보이니 부서 내에서만 사용하세요.</p>
    <div class="rs-tools np"><div class="tg2" role="group" aria-label="보기"><button data-act="rv" data-v="list" aria-pressed="${S.rv === 'list'}">교육별 명단</button><button data-act="rv" data-v="person" aria-pressed="${S.rv === 'person'}">직원별 요약</button></div>
      <div class="tg2" role="group" aria-label="교육 구분">${[['all', '전체'], ['보수', '보수'], ['기타', '기타'], ['필수', '필수']].map(([v, l]) => `<button data-act="rg" data-v="${v}" aria-pressed="${S.rg === v}">${l}</button>`).join('')}</div>
      <input type="search" id="q" placeholder="이름·사번·교육명 검색" value="${esc(S.search)}"><span class="note">이수 <b>${num(c.t)}</b>건${S.rv === 'person' ? ` · 직원 <b>${num(people.length)}</b>명` : ''}${rows.length !== all.length ? ` (검색 전 ${num(all.length)}건)` : ''}</span><span class="sp"></span>
      <button class="btn pri" data-act="xl">엑셀 다운로드</button><button class="btn" data-act="printroster">PDF 출력</button></div>
    <div class="printhead"><h1>부서별 세부 이수 명단</h1><div class="pmeta"><span><b>기준일시</b> ${esc(periodLabel())}</span><span><b>부서</b> ${esc(scope)}</span><span><b>구분</b> ${S.rg === 'all' ? '보수·기타·필수' : esc(S.rg)}</span><span><b>출력일시</b> ${printStamp()}</span></div>
      <div class="psum">이수 <b>${num(rows.length)}건</b> · 보수 <b>${num(gc.보수)}</b> · 기타 <b>${num(gc.기타)}</b> · 필수 <b>${num(gc.필수)}</b>${S.rv === 'person' ? ` · 직원 <b>${num(people.length)}명</b>` : ''}</div></div>
    <div class="rs-scroll tw"><table class="${S.rv === 'list' ? 'rl' : ''}">${list}</table></div>
    <div class="printfoot">※ 간호조무사 제외, 교육 당시 부서 기준입니다. 이름·사번이 포함되어 있으므로 외부로 공유하지 마세요.<div style="margin-top:3mm;text-align:right;color:#333;font-weight:600">인제대학교 해운대백병원 간호국 · ${esc(roleLabel())}</div></div></section>`;
}
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => {
    const el = document.createElement('script'); el.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    el.onload = () => res(window.XLSX); el.onerror = () => rej(new Error('엑셀 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
    document.head.appendChild(el);
  });
}
async function exportRoster() {
  try {
    const rows = rosterRows(false); if (!rows.length) { alert('조회 조건에 해당하는 이수 명단이 없습니다.'); return; }
    const X = await loadXLSX(), wb = X.utils.book_new(), people = rosterPeople(rows);
    const scope = S.me ? (S.me.all ? '전체부서' : S.me.depts.join('_')) : (S.dept === 'all' ? '전체부서' : S.dept);
    const byD = {}; rows.forEach(r => { const o = byD[r.dept] || (byD[r.dept] = { n: 0, b: 0, e: 0, q: 0, p: new Set() }); o.n++; if (r.g === '보수') o.b++; else if (r.g === '기타') o.e++; else o.q++; o.p.add(r.emp || r.name); });
    const gt = { n: rows.length, b: rows.filter(r => r.g === '보수').length, e: rows.filter(r => r.g === '기타').length, q: rows.filter(r => r.g === '필수').length };
    const sum = X.utils.aoa_to_sheet([[`부서별 세부 이수 명단(보수·기타·필수) · ${periodLabel()} · ${scope} · ${printStamp()} 출력`], [], ['부서', '이수(건)', '보수', '기타', '필수', '직원(명)'],
      ...Object.keys(byD).sort().map(d => [d, byD[d].n, byD[d].b, byD[d].e, byD[d].q, byD[d].p.size]), ['합계', gt.n, gt.b, gt.e, gt.q, people.length]]);
    sum['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }]; X.utils.book_append_sheet(wb, sum, '요약');
    const pw = X.utils.aoa_to_sheet([['성명', '사번', '부서', '이수(건)', '보수', '기타', '필수'], ...people.map(p => [p.name, p.emp, p.sub && p.sub !== p.dept ? p.dept + ' · ' + p.sub : p.dept, p.n, p.g.보수, p.g.기타, p.g.필수])]);
    pw['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 9 }, { wch: 7 }, { wch: 7 }, { wch: 7 }]; pw['!freeze'] = { xSplit: 0, ySplit: 1 }; X.utils.book_append_sheet(wb, pw, '직원별');
    const lw = X.utils.aoa_to_sheet([['교육일', '부서', '성명', '사번', '구분', '교육명', '형태'], ...rows.map(r => [r.iso || '', r.sub && r.sub !== r.dept ? r.dept + ' · ' + r.sub : r.dept, r.name, r.emp, r.g, r.title, r.f || ''])]);
    lw['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 56 }, { wch: 8 }]; lw['!freeze'] = { xSplit: 0, ySplit: 1 }; X.utils.book_append_sheet(wb, lw, '이수 명단');
    X.writeFile(wb, `보수교육_세부명단_${periodLabel().replace(/\s+/g, '')}_${scope}.xlsx`.replace(/[\\/:*?"<>|]/g, ''));
  } catch (e) { alert(e.message || e); }
}
function printRoster() {
  document.body.classList.add('print-roster');
  const done = () => { document.body.classList.remove('print-roster'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); window.print();
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT') return;
  const v = b.dataset.v, a = b.dataset.act;
  if (a === 'page') { if (!canGo(v)) return; S.page = v; S.search = ''; history.replaceState(null, '', '#' + v); window.scrollTo({ top: 0 }); }
  else if (a === 'year') S.year = v === 'all' ? 'all' : +v;
  else if (a === 'qall') S.ms = [];
  else if (a === 'q') { const mm = [0, 1, 2].map(k => +v * 3 - 2 + k), all = mm.every(x => S.ms.includes(x)); S.ms = all ? S.ms.filter(x => !mm.includes(x)) : [...new Set([...S.ms, ...mm])]; }
  else if (a === 'mo') { const n = +v; S.ms = S.ms.includes(n) ? S.ms.filter(x => x !== n) : [...S.ms, n]; }
  else if (a === 'grp') S.grp = v;
  else if (a === 'view') S.view = v;
  else if (a === 'print') { window.print(); return; }
  else if (a === 'rv') S.rv = v;
  else if (a === 'rg') S.rg = v;
  else if (a === 'ftoggle') { S.fopen = !S.fopen; $('filters').classList.toggle('open', !!S.fopen); const b2 = $('filters').querySelector('.fsum'); if (b2) { b2.setAttribute('aria-expanded', !!S.fopen); b2.querySelector('.fs-h').textContent = S.fopen ? '접기' : '조절'; } return; }
  else if (a === 'xl') { exportRoster(); return; }
  else if (a === 'xlmiss') { exportMissing(); return; }
  else if (a === 'printroster') { printRoster(); return; }
  else if (a === 'kind') S.kind[v] = !S.kind[v];
  else if (a === 'unlock') { const pw = $('pw').value; if (!pw) return; S.pw = pw; if (SAMPLE) { LOCKED = false; render(); return; } load(pw); return; }
  render();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.act === 'dept') { if (mgrDepts() && t.value !== 'all' && !mgrDepts().includes(t.value)) return; S.dept = t.value; S.sub = 'all'; }
  else if (t.dataset.act === 'sub') S.sub = t.value;
  else return;
  render();
});
document.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  S.search = e.target.value; const pos = e.target.selectionStart; render();
  const q = $('q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'pw') document.querySelector('[data-act=unlock]').click(); });
$('refresh').onclick = () => reload();
$('logout').onclick = () => logout();
$('lgf').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('lgpw').value.trim(); if (!pw) return;
  $('lgok').disabled = true; S.pwErr = ''; $('lgerr').textContent = '확인 중… (처음에는 30초 정도 걸릴 수 있습니다)';
  S.pw = pw; S.idt = ''; S.me = null;
  await load(pw);
  if (role() === 'admin') { $('lgpw').value = ''; $('lgerr').textContent = ''; } else { $('lgerr').textContent = S.pwErr || '로그인하지 못했습니다. 잠시 후 다시 시도하세요.'; }
  $('lgok').disabled = false;
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(); });
setInterval(() => reload(), (CFG.REFRESH_MIN || 5) * 60000);
{ const h = location.hash.slice(1); if (PAGES.some(p => p[0] === h)) S.page = h; }
nav(); render();
if (S.idt) loadGoogle(S.idt); else if (S.pw) load(S.pw); else if (!CFG.API_URL) load('');
initGoogle();

/* 고정 헤더 높이 → --hh (줌 배율 보정) */
(function () {
  const h = document.querySelector('header'); if (!h) return;
  const set = () => { const z = parseFloat(getComputedStyle(document.body).zoom) || 1; document.documentElement.style.setProperty('--hh', (h.getBoundingClientRect().height / z).toFixed(1) + 'px'); };
  set(); window.addEventListener('resize', set);
  if (window.ResizeObserver) new ResizeObserver(set).observe(h);
})();
