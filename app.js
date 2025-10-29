window.addEventListener('DOMContentLoaded', () => {
  // -------- SHORTHANDS --------
  const $ = sel => document.querySelector(sel);
  const root = document.documentElement;
  const q = $('#q'), worldSel = $('#world'), list = $('#list'),
        statusEl = $('#status'), pagerEl = $('#pager'),
        buyBtn = $('#buyBtn'), sellBtn = $('#sellBtn'), bossBtn = $('#bossBtn'), cashBtn = $('#cashBtn'),
        themeToggle = $('#themeToggle');

  // -------- THEME --------
  const THEME_KEY = 'chatlog-theme';
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) root.setAttribute('data-theme', saved);
  themeToggle.checked = root.getAttribute('data-theme') === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', themeToggle.checked ? 'dark' : 'light');
  themeToggle.addEventListener('change', () => {
    const mode = themeToggle.checked ? 'dark' : 'light';
    root.setAttribute('data-theme', mode);
    localStorage.setItem(THEME_KEY, mode);
  });

  // -------- STATE --------
  let rows = [];
  let modeView = 'all';

  // Pagination
  const MAX_ITEMS  = 10000;  // 60개 상한
  const PAGE_SIZE  = 24;  // 1페이지 표시 개수
  let currentPage  = 1;

  // -------- HELPERS --------
  const escapeHTML = s => (s||'').replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  function parseTSV(text){
    const out = [];
    for (const raw of text.split(/\r?\n/)){
      if (!raw.trim()) continue;
      const cols = raw.split(/\t+/);
      let i = 0;
      if (/^\d+$/.test(cols[i])) i++; // 앞 인덱스 제거(있을 경우)
      const time = cols[i++]||'', author = cols[i++]||'', msg = cols[i++]||'', world = cols[i++]||'', place = cols[i++]||'';
      out.push({ time, author, msg, world, place });
    }
    return out;
  }

  const unique = (list, key) => [...new Set(list.map(x => (x[key]||'').trim()))].filter(Boolean).sort((a,b)=>a.localeCompare(b));

  const highlightHTML = (escapedText, kw) =>
    !kw ? escapedText :
    escapedText.replace(new RegExp(escapeRegExp(kw), 'gi'), m => `<mark class="hl">${m}</mark>`);

  // -------- 분류 정규식 --------
  const buyRegex  = /구매|구입|삽니다|사요|사겠습니다|구해요|구합니다|매입|알.*구매/i;
  const sellRegex = /판매|팝니다|양도|대여(?:합니다)?|자리팝니다/i;
  const bossRegex = /자쿰|쿰|블루머쉬맘|블머|파풀라투스|파풀|피아누스|혼테일/i;
  const cashRegex = /캐시|월코|월드코인|생물|펫|호부|슬롯|고확/i;
  const warnRegex = /(사고|주의|조심|경고|사기)/i;

  const classify = msg => ({
    trade: buyRegex.test(msg||'') || sellRegex.test(msg||'') || bossRegex.test(msg||'') || cashRegex.test(msg||''),
    warning: warnRegex.test(msg||'')
  });

  // -------- FILTERS --------
  function fill(sel, items){
    const [first, ...rest] = items;
    sel.innerHTML = `<option value="">${first}</option>` +
      rest.map(v => `<option>${escapeHTML(v)}</option>`).join('');
  }

  function buildFilters(){
    fill(worldSel, ['지역(월드) 전체', ...unique(rows, 'world')]);
    worldSel.selectedIndex = 0;
  }

  function matches(r){
    const kw = (q.value || '').trim().toLowerCase();
    const w  = worldSel.value;

    if (modeView === 'buy'  && !buyRegex.test(r.msg || ''))  return false;
    if (modeView === 'sell' && !sellRegex.test(r.msg || '')) return false;
    if (modeView === 'boss' && !bossRegex.test(r.msg || '')) return false;
    if (modeView === 'cash' && !cashRegex.test(r.msg || '')) return false;
    if (w && r.world !== w) return false;

    if (kw){
      const blob = `${r.time} ${r.author} ${r.msg} ${r.world} ${r.place}`.toLowerCase();
      if (!blob.includes(kw)) return false;
    }
    return true;
  }

  // -------- CARD --------
  function card(r, kw){
    const tag = classify(r.msg);
    const classes = ['card'];
    if (tag.trade) classes.push('trade');
    if (tag.warning) classes.push('warning');

    const escAuthor = escapeHTML(r.author);
    const escMsg    = escapeHTML(r.msg);
    const escWorld  = escapeHTML(r.world || '');
    const escPlace  = escapeHTML(r.place || '');

    return `
    <article class="${classes.join(' ')}">
      <div class="head">
        <button class="who" data-name="${escAuthor}" type="button">${highlightHTML(escAuthor, q.value)}</button>
        <span class="chip">${highlightHTML(escWorld, q.value)}</span>
      </div>
      <div class="msg">${highlightHTML(escMsg, q.value)}</div>
      <div class="meta">
        <span class="time">${escapeHTML(timeAgo(r.time))}</span>
        <div class="loc"><span class="tag">${highlightHTML(escPlace, q.value)}</span></div>
      </div>
    </article>`;
  }

  function timeAgo(text){
    const d = new Date(text.replace(/-/g,'/'));
    if (isNaN(d)) return text;
    let diff = Date.now() - d.getTime();
    if (diff < 0) diff = 0;
    const min = Math.floor(diff/60000);
    const h   = Math.floor(min/60);
    const day = Math.floor(h/24);
    if (min < 1) return '방금 전';
    if (min < 60) return `${min}분 전`;
    if (h < 24) return `${h}시간 전`;
    return `${day}일 전`;
  }

  // -------- PAGINATION --------
  function buildPager(totalPages){
    if (!pagerEl) return;

    if (totalPages <= 1){
      pagerEl.innerHTML = '';
      return;
    }

    const MAX_BTN = 7;
    let start = Math.max(1, currentPage - Math.floor(MAX_BTN/2));
    let end   = start + MAX_BTN - 1;
    if (end > totalPages){
      end = totalPages;
      start = Math.max(1, end - MAX_BTN + 1);
    }

    const btn = (label, page, {disabled=false, active=false}={}) =>
      `<button class="pbtn${active ? ' active':''}" data-page="${page}" ${disabled?'disabled':''}>${label}</button>`;

    let html = '';
    html += btn('« 처음', 1, {disabled: currentPage===1});
    html += btn('‹ 이전', currentPage-1, {disabled: currentPage===1});
    for(let p=start; p<=end; p++){
      html += btn(p, p, {active:p===currentPage});
    }
    html += btn('다음 ›', currentPage+1, {disabled: currentPage===totalPages});
    html += btn('마지막 »', totalPages, {disabled: currentPage===totalPages});

    pagerEl.innerHTML = html;
  }

  pagerEl.addEventListener('click', e => {
    const b = e.target.closest('.pbtn'); if (!b) return;
    const p = parseInt(b.dataset.page, 10);
    if (!isNaN(p) && p !== currentPage){
      currentPage = p;
      render();
    }
  });


document.querySelector('.brand').addEventListener('click', () => {
  location.reload();
});


  // -------- RENDER --------
  function render(){
    const filteredFull = rows.filter(matches);
    const capped = filteredFull.slice(0, MAX_ITEMS);

    const totalPages = Math.max(1, Math.ceil(capped.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = capped.slice(startIdx, startIdx + PAGE_SIZE);

    list.innerHTML =
      pageItems.map(r => card(r, q.value)).join('') ||
      `<div class="status">조건에 맞는 항목이 없습니다.</div>`;

    const shownFrom = capped.length ? (startIdx + 1) : 0;
    const shownTo   = startIdx + pageItems.length;
    buildPager(totalPages);
  }

  // -------- EVENT: 필터 & 검색 --------
  const debounce = (fn, ms=150) =>{
    let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
  };

  const renderDebouncedResetPage = debounce(() => {
    currentPage = 1;
    render();
  }, 150);

  [q, worldSel].forEach(el => el && el.addEventListener('input', renderDebouncedResetPage));

  function setMode(m){
    modeView = (modeView === m) ? 'all' : m;
    buyBtn.classList.toggle('active', modeView === 'buy');
    sellBtn.classList.toggle('active', modeView === 'sell');
    bossBtn.classList.toggle('active', modeView === 'boss');
    cashBtn.classList.toggle('active', modeView === 'cash');
    currentPage = 1;
    render();
  }

  buyBtn.addEventListener('click', () => setMode('buy'));
  sellBtn.addEventListener('click', () => setMode('sell'));
  bossBtn.addEventListener('click', () => setMode('boss'));
  cashBtn.addEventListener('click', () => setMode('cash'));

  document.getElementById('resetBtn').addEventListener('click', () => {
    q.value = '';
    worldSel.selectedIndex = 0;
    modeView = 'all';
    buyBtn.classList.remove('active');
    sellBtn.classList.remove('active');
    bossBtn.classList.remove('active');
    cashBtn.classList.remove('active');
    currentPage = 1;
    render();
  });

  // -------- 닉네임 클릭: 복사 --------
  list.addEventListener('click', async (e) => {
    const who = e.target.closest('.who'); if (!who) return;
    const name = who.dataset.name || who.textContent.trim();
    const text = `/귓 ${name}`;
    try{
      await navigator.clipboard.writeText(text);
    }catch{
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  });

  // -------- 툴팁: 호버할 때 문구 주입 --------
  const setTip = el => {
    if (!el) return;
    const name = (el.dataset.name || el.textContent || '').trim();
    el.dataset.tip = `/귓 ${name} 복사`;
  };
  
  list.addEventListener('mouseover', e => setTip(e.target.closest('.who')));
  list.addEventListener('focusin',  e => setTip(e.target.closest('.who')));

  // -------- LOAD DEFAULT DATA --------
  async function loadDefault(){
    try{
      const res = await fetch('chat_logs.txt', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = parseTSV(text);
      rows = data;
      buildFilters();
      render();
    }catch(e){
      console.error(e);
      statusEl.textContent = `기본 데이터 로드 실패: ${e.message}`;
    }
  }

  // -------- INIT --------
  loadDefault();
});
