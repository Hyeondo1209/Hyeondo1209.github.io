// ─────────────────────────────────────────────────────────────
// 표시하기: 올리기 미리보기(내 컴퓨터)에서만 붙는 도구.
// 공개 사이트에는 들어가지 않습니다 (publish.mjs 의 미리보기 서버가 페이지에 끼워 넣음).
//
//  - 글자를 드래그 → 형광펜 / 빨간 펜 / 연필 / 수정테이프 / 지우기
//  - 날짜를 누르면 바꿀 수 있음
//  - 표시는 원고 폴더의 .표시 폴더에 저장되고, "올리기"를 누르면 사이트에 반영됨
//  - 오른쪽 여백의 "올리기 / 올리지 않기" 로 사이트에 올릴지 고름
// ─────────────────────────────────────────────────────────────
import { findMark, blankOut } from '/__desk/marks-match.mjs';

const slug = decodeURIComponent((location.pathname.match(/^\/notes\/([^/]+)\/?$/) || [])[1] || '');

const TOOLS = [
  { type: 'hl', label: '형광펜', swatch: 'background:#fff176' },
  { type: 'red', label: '빨간 펜', swatch: 'height:5px;border-bottom:2px solid #d4202c' },
  { type: 'pencil', label: '연필', swatch: 'height:6px;border-bottom:1px solid #4a4a4a' },
  { type: 'tape', label: '수정테이프', swatch: 'background:#111' },
  { type: 'erase', label: '지우기' },
];
const LEAF = 'p, li, h1, h2, h3, h4, h5, h6, td, th';
const SKIP = '.katex, a[data-footnote-ref], a[data-footnote-backref]';

const css = `
.desk-tb{position:absolute;z-index:1000;display:flex;gap:3px;padding:3px;white-space:nowrap;
  font:13px/1 GulimChe,'굴림체','Seorap Gulim',monospace;color:#000;
  background:#c0c0c0;border:1px solid;border-color:#fff #404040 #404040 #fff;box-shadow:1px 1px 0 #000;user-select:none}
.desk-tb button,.desk-btn{all:unset;cursor:default;padding:4px 7px;display:flex;align-items:center;gap:5px;
  background:#c0c0c0;border:1px solid;border-color:#fff #808080 #808080 #fff}
.desk-btn{display:inline-block;font:13px/1 GulimChe,'굴림체','Seorap Gulim',monospace;padding:5px 9px;margin:6px 6px 0 0;box-shadow:1px 1px 0 #000}
.desk-btn[disabled]{color:#808080;pointer-events:none}
.desk-tb button:active,.desk-btn:active{border-color:#808080 #fff #fff #808080}
.desk-tb[hidden]{display:none}
.desk-tb i{display:inline-block;width:12px;height:10px}
.desk-tb .desk-msg{padding:4px 7px}
.desk-panel{position:fixed;top:24px;z-index:999;width:220px;font:13px/20px GulimChe,'굴림체','Seorap Gulim',monospace;color:#000}
.desk-panel a{color:#0000ee;text-decoration:underline;cursor:pointer}
.desk-panel .desk-err{color:#d4202c}
.desk-vis{margin-top:20px}
.desk-vis:empty{display:none}
.desk-decide{margin-top:20px;padding-top:12px;border-top:1px solid #000}
.desk-log{margin-top:8px;font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-all}
html.desk-on .sheet .report__date{cursor:pointer;outline:1px dashed #9a9a9a;outline-offset:3px}
.desk-date-input{font:inherit;font-size:12px;border:1px solid #000;padding:0 2px;background:#fff}
`;

// ── 글자 위치 도우미 ───────────────────────────────────────
function textInfo(el) {
  const pos = [];
  let text = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (let i = 0; i < n.length; i++) pos.push([n, i]);
    text += n.data;
  }
  return { text, pos };
}
function leaves(root) {
  return Array.from(root.querySelectorAll(LEAF)).filter(
    (el) => !el.querySelector(LEAF) && !el.closest('.report__date') && !el.matches('section[data-footnotes] > h2'),
  );
}
const leafOf = (node) => (node?.nodeType === 3 ? node.parentElement : node)?.closest?.(LEAF) || null;

function wrap(positions, m) {
  // 같은 글자 덩어리(text node)끼리 묶어서 각각 감쌈 → 태그가 엇갈리지 않음
  const groups = new Map();
  for (const [n, i] of positions) {
    const g = groups.get(n) || { min: i, max: i };
    g.min = Math.min(g.min, i);
    g.max = Math.max(g.max, i);
    groups.set(n, g);
  }
  for (const [node, { min, max }] of groups) {
    if (max + 1 < node.length) node.splitText(max + 1);
    const mid = min > 0 ? node.splitText(min) : node;
    const el = document.createElement(m.type === 'hl' ? 'mark' : 'span');
    if (m.type === 'red') el.className = 'red-pen';
    if (m.type === 'pencil') el.className = 'pencil';
    if (m.type === 'tape') {
      el.className = 'tape';
      el.dataset.orig = mid.data;
      mid.data = blankOut(mid.data);
    }
    el.dataset.m = m.id;
    mid.replaceWith(el);
    el.append(mid);
  }
}
function unwrap(root, m) {
  const els = Array.from(root.querySelectorAll(`[data-m="${CSS.escape(m.id)}"]`));
  els.forEach((el, k) => {
    if (el.classList.contains('tape')) {
      // 미리보기로 만든 페이지에는 가린 글자가 없으므로 저장된 원래 글자로 되돌림
      const orig = el.dataset.orig ?? (k === 0 ? m.quote : '');
      el.replaceWith(document.createTextNode(orig));
    } else el.replaceWith(...el.childNodes);
  });
  root.normalize();
  return els.length > 0;
}

// ── 시작 ─────────────────────────────────────────────────
async function start() {
  const pages = window.__deskPages;
  const report = document.querySelector('.report[data-mode="full"]');
  const template = report && pages?.templates.get(report);

  document.head.append(Object.assign(document.createElement('style'), { textContent: css }));
  const panel = document.createElement('div');
  panel.className = 'desk-panel';
  const markBox = document.createElement('div');
  const visBox = document.createElement('div');
  visBox.className = 'desk-vis';
  const decideBox = document.createElement('div');
  decideBox.className = 'desk-decide';
  panel.append(markBox, visBox, decideBox);
  document.body.append(panel);
  setupDecide(decideBox, visBox, () => {
    // 올리기를 고르면 더는 표시하지 않음
    window.dispatchEvent(new Event('desk:locked'));
  });
  const placePanel = () => {
    const sheet = document.querySelector('.sheet');
    const right = sheet ? sheet.getBoundingClientRect().right : document.documentElement.clientWidth - 260;
    panel.style.left = `${Math.round(right + 40)}px`;
  };
  placePanel();
  window.addEventListener('resize', () => setTimeout(placePanel, 200));

  if (!slug || !template) {
    markBox.innerHTML = '<b>미리보기</b><br>글을 열면 표시하기를<br>쓸 수 있어요.';
    return;
  }
  let state;
  try {
    state = await (await fetch(`/__desk/marks?slug=${encodeURIComponent(slug)}`)).json();
  } catch {
    markBox.innerHTML = '<span class="desk-err">미리보기 창(검은 창)이<br>꺼져서 표시할 수 없어요.</span>';
    return;
  }
  if (!state.editable) {
    markBox.innerHTML = `<b>표시하기</b><br>${state.reason || '올리는 중이라 표시할 수 없어요.'}`;
    return;
  }
  let marks = state.marks || [];
  let on = true;
  let saved = '';
  let error = '';

  const repaginate = () => {
    const y = window.scrollY;
    pages.run();
    window.scrollTo(0, y);
    placePanel();
  };
  const apply = (m) => {
    const ls = leaves(template);
    const infos = ls.map(textInfo);
    const hit = findMark(infos.map((x) => x.text), m);
    if (!hit) return false;
    wrap(infos[hit.unit].pos.slice(hit.start, hit.end), m);
    return true;
  };

  // 페이지(마지막으로 만든 사이트)와 저장된 표시를 맞춤
  let changed = false;
  const ids = new Set(marks.map((m) => m.id));
  for (const el of template.querySelectorAll('[data-m]')) {
    if (!ids.has(el.dataset.m)) {
      unwrap(template, { id: el.dataset.m, quote: '' });
      changed = true;
    }
  }
  for (const m of marks) {
    if (!template.querySelector(`[data-m="${CSS.escape(m.id)}"]`)) changed = apply(m) || changed;
  }
  if (state.date) changed = setDate(state.date) || changed;
  if (changed) repaginate();

  let locked = false;
  window.addEventListener('desk:locked', () => {
    locked = true;
    on = false;
    hideBar();
    render();
  });
  function render() {
    placePanel();
    if (locked) {
      markBox.innerHTML = '<b>표시하기</b> 끝<br>다시 표시하려면<br>올리기를 다시<br>실행하세요.';
      document.documentElement.classList.remove('desk-on');
      return;
    }
    markBox.innerHTML = on
      ? `<b>표시하기</b> 켜짐<br>글자를 드래그해서<br>표시를 고르세요.<br>날짜를 누르면<br>바꿀 수 있어요.<br><br>${
          error ? `<span class="desk-err">${error}</span>` : saved ? `저장됨 ${saved}` : '&nbsp;'
        }<br><br><a data-act="off">끄기</a>`
      : `<b>표시하기</b> 꺼짐<br><br><a data-act="on">켜기</a>`;
    document.documentElement.classList.toggle('desk-on', on);
  }
  panel.addEventListener('click', (e) => {
    const act = e.target.closest('a')?.dataset.act;
    if (!act) return;
    on = act === 'on';
    hideBar();
    render();
  });
  render();

  async function save() {
    try {
      const res = await fetch(`/__desk/marks?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: state.date || null, marks }),
      });
      if (!res.ok) throw new Error();
      window.dispatchEvent(new Event('desk:saved'));
      const d = new Date();
      saved = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      error = '';
    } catch {
      error = '저장하지 못했어요.<br>검은 창이 켜져 있는지<br>확인하세요.';
    }
    render();
  }

  // ── 도구 막대 ──
  const bar = document.createElement('div');
  bar.className = 'desk-tb';
  bar.hidden = true;
  document.body.append(bar);
  bar.addEventListener('mousedown', (e) => e.preventDefault()); // 고른 글자가 풀리지 않게
  function hideBar() {
    bar.hidden = true;
  }
  let current = null; // { range, leaf, quote, prefix, suffix }

  function showBar(range, content) {
    bar.innerHTML = content;
    bar.hidden = false;
    const rect = range.getClientRects()[0] || range.getBoundingClientRect();
    const top = rect.top + window.scrollY - bar.offsetHeight - 8;
    bar.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    bar.style.top = `${Math.round(Math.max(window.scrollY + 4, top))}px`;
  }
  function message(text) {
    if (!current) return;
    showBar(current.range, `<span class="desk-msg">${text}</span>`);
    setTimeout(() => {
      if (bar.querySelector('.desk-msg')) hideBar();
    }, 2200);
  }

  // 그냥 클릭(끌지 않음)이면 도구 막대를 닫음. 두 번 클릭(낱말 고르기)은 그대로 둠
  let down = null;
  document.addEventListener('mousedown', (e) => {
    down = { x: e.clientX, y: e.clientY, inBar: bar.contains(e.target) };
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideBar();
  });
  document.addEventListener('mouseup', (ev) => {
    const click = down && !down.inBar && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 4 && ev.detail < 2;
    setTimeout(() => {
      if (!on) return;
      if (click) {
        if (!bar.contains(ev.target)) {
          hideBar();
          window.getSelection()?.removeAllRanges();
        }
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return hideBar();
      const range = sel.getRangeAt(0);
      if (bar.contains(range.startContainer)) return;
      const a = leafOf(range.startContainer);
      const b = leafOf(range.endContainer);
      if (!a || !a.closest('.sheet')) return hideBar();
      current = { range };
      if (a !== b) return message('한 문단 안에서만 칠할 수 있어요.');
      const info = textInfo(a);
      const picked = [];
      info.pos.forEach(([n, i], k) => {
        if (range.comparePoint(n, i) === 0 && range.comparePoint(n, i + 1) === 0) picked.push(k);
      });
      if (!picked.length) return hideBar();
      const s = picked[0];
      const e = picked[picked.length - 1] + 1;
      const quote = info.text.slice(s, e);
      if (!quote.trim()) return hideBar();
      current = { range, leaf: a, quote, prefix: info.text.slice(Math.max(0, s - 30), s), suffix: info.text.slice(e, e + 30) };
      showBar(
        range,
        TOOLS.map((t) => `<button data-type="${t.type}">${t.swatch ? `<i style="${t.swatch}"></i>` : ''}${t.label}</button>`).join(''),
      );
    }, 0);
  });
  document.addEventListener('mousedown', (e) => {
    if (!bar.contains(e.target)) hideBar();
  });

  bar.addEventListener('click', (e) => {
    const type = e.target.closest('button')?.dataset.type;
    if (!type || !current?.leaf) return;
    if (type === 'erase') return erase();
    const m = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type,
      quote: current.quote,
      prefix: current.prefix,
      suffix: current.suffix,
    };
    if (!apply(m)) return message('여기는 칠할 수 없어요.');
    marks.push(m);
    window.getSelection()?.removeAllRanges();
    hideBar();
    repaginate();
    save();
  });

  function erase() {
    const { range } = current;
    const root = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
    const scope = root.closest('.sheet') || root;
    const hits = Array.from(scope.querySelectorAll('[data-m]')).filter((el) => range.intersectsNode(el));
    const leafEl = current.leaf;
    const parentMark = leafOf(range.startContainer) && range.startContainer.parentElement?.closest('[data-m]');
    if (parentMark && !hits.includes(parentMark)) hits.push(parentMark);
    const ids = new Set(hits.map((el) => el.dataset.m));
    if (!ids.size) {
      const word = Array.from(leafEl.querySelectorAll('mark, .red-pen')).some((el) => range.intersectsNode(el));
      return message(word ? 'Word에서 칠한 표시는 Word에서 지워주세요.' : '지울 표시가 없어요.');
    }
    for (const id of ids) {
      const m = marks.find((x) => x.id === id) || { id, quote: '' };
      unwrap(template, m);
    }
    marks = marks.filter((m) => !ids.has(m.id));
    window.getSelection()?.removeAllRanges();
    hideBar();
    repaginate();
    save();
  }

  // ── 날짜 ──
  function setDate(v) {
    const el = template.querySelector('.report__date time');
    if (!el || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const [y, mo, d] = v.split('-');
    el.textContent = `${y}.${mo}.${d}`;
    const iso = new Date(Number(y), Number(mo) - 1, Number(d)).toISOString();
    el.setAttribute('datetime', iso);
    report.dataset.date = iso;
    const age = Math.min(1, Math.max(0, (Date.now() - new Date(iso).getTime()) / (4 * 365.25 * 864e5)));
    report.style.setProperty('--age', age.toFixed(3));
    return true;
  }
  document.addEventListener('click', (e) => {
    if (!on) return;
    const dateEl = e.target.closest('.sheet .report__date');
    if (!dateEl || dateEl.querySelector('input')) return;
    const cur = (dateEl.querySelector('time')?.textContent || '').replace(/\./g, '-');
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'desk-date-input';
    input.value = cur;
    dateEl.replaceChildren(input);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (ok && input.value && input.value !== cur) {
        state.date = input.value;
        setDate(input.value);
        save();
      }
      repaginate();
    };
    input.addEventListener('keydown', (k) => {
      if (k.key === 'Enter') finish(true);
      if (k.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.focus();
  });
}

// ── 사이트에 올리기 / 올리지 않기 ─────────────────────────────
function setupDecide(box, visBox, onLock) {
  let st = null;
  let timer = null;
  let lockedOnce = false;
  const lock = () => {
    if (lockedOnce) return;
    lockedOnce = true;
    onLock();
  };
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  async function refresh() {
    try {
      st = await (await fetch('/__desk/status')).json();
    } catch {
      if (st && st.phase !== 'waiting' && st.phase !== 'working') return; // 끝난 뒤 미리보기가 닫힘
      box.innerHTML = '<span class="desk-err">검은 창이 꺼져서<br>여기서는 올릴 수 없어요.</span>';
      clearInterval(timer);
      return;
    }
    if (st.phase !== 'waiting') lock();
    draw();
    drawVis();
    if (st.phase !== 'waiting' && st.phase !== 'working') clearInterval(timer);
  }
  function draw() {
    if (st.phase === 'waiting') {
      const lines = st.changes.map((c) => `· ${esc(c.kind)}: ${c.url ? `<a href="${c.url}">${esc(c.title)}</a>` : esc(c.title)}`);
      if (st.marksDirty) lines.push('· 미리보기에서 한 표시와 날짜');
      box.innerHTML = `<b>사이트에 올리기</b><br>${
        lines.length ? `올라갈 것:<br>${lines.join('<br>')}` : '바뀐 것이 없어요.<br>표시를 하면 여기에<br>나타나요.'
      }<br><button class="desk-btn" data-dec="y"${lines.length ? '' : ' disabled'}>올리기</button><button class="desk-btn" data-dec="n">올리지 않기</button>`;
      return;
    }
    const head = {
      working: '<b>올리는 중...</b>',
      done: '<b>올렸어요.</b><br>1~2분 뒤 사이트에 반영돼요.',
      cancelled: '<b>올리지 않았어요.</b><br>이 창을 닫아도 돼요.',
      nothing: '<b>올릴 바뀐 것이 없어요.</b><br>이 창을 닫아도 돼요.',
      error: '<span class="desk-err"><b>올리지 못했어요.</b></span><br>아래 내용을 확인하세요.',
    }[st.phase] || '';
    const link = st.phase === 'done' && st.url ? `<br><a href="${st.url}" target="_blank" rel="noopener">사이트에서 보기</a>` : '';
    const log = st.log.filter((l) => l.trim() && !/^─+$/.test(l)).slice(-8).map(esc).join('\n');
    box.innerHTML = `${head}${link}${st.phase === 'done' || st.phase === 'cancelled' ? '' : `<div class="desk-log">${log}</div>`}`;
  }
  // ── 글 보이기: 공개 / 목록에서 숨김 / 사이트에서 내림 ──
  const VIS = {
    public: '공개',
    unlisted: '목록에서 숨김<br>(주소를 아는 사람만 열 수 있어요)',
    hidden: '사이트에서 내리기로 함',
  };
  function drawVis() {
    if (!st || st.phase !== 'waiting' || !st.notes) {
      visBox.innerHTML = '';
      return;
    }
    const link = (docx, value, text) => `<a data-docx="${esc(docx)}" data-vis="${value}">${text}</a>`;
    const mine = slug && st.notes.find((n) => n.url === `/notes/${encodeURIComponent(slug)}/` || n.url === `/notes/${slug}/`);
    if (mine) {
      const v = mine.visibility;
      const acts = {
        public: [link(mine.docx, 'unlisted', '목록에서 숨기기'), link(mine.docx, 'hidden', '사이트에서 내리기')],
        unlisted: [link(mine.docx, 'public', '다시 목록에 보이기'), link(mine.docx, 'hidden', '사이트에서 내리기')],
        hidden: [link(mine.docx, 'public', '내리지 않기')],
      }[v];
      visBox.innerHTML = `<b>이 글은</b> ${VIS[v]}<br>${acts.join('<br>')}`;
      return;
    }
    if (slug) {
      visBox.innerHTML = '';
      return;
    }
    // 첫 화면·글 목록: 숨기거나 내린 글을 여기서 다시 보이게
    const rows = st.notes
      .filter((n) => n.word || n.visibility !== 'public')
      .map((n) =>
        n.word
          ? `· ${esc(n.title)}<br>&nbsp;&nbsp;초안(Word 원고의 "초안" 줄)`
          : `· ${n.visibility === 'unlisted' ? `<a href="${n.url}">${esc(n.title)}</a>` : esc(n.title)}<br>&nbsp;&nbsp;${
              n.visibility === 'hidden' ? '내림' : '목록에서 숨김'
            } — ${link(n.docx, 'public', '다시 공개')}`,
      );
    visBox.innerHTML = rows.length ? `<b>숨기거나 내린 글</b><br>${rows.join('<br>')}` : '';
  }
  visBox.addEventListener('click', async (e) => {
    const a = e.target.closest('a[data-vis]');
    if (!a) return;
    await fetch('/__desk/visibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docx: a.dataset.docx, value: a.dataset.vis }),
    }).catch(() => {});
    refresh();
  });

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-dec]');
    if (!b) return;
    const answer = b.dataset.dec;
    box.querySelectorAll('button').forEach((x) => (x.disabled = true));
    lock();
    await fetch('/__desk/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer }) }).catch(() => {});
    clearInterval(timer);
    timer = setInterval(refresh, 1000);
    refresh();
  });
  window.addEventListener('desk:saved', refresh);
  refresh();
  timer = setInterval(refresh, 3000); // 검은 창에서 y/n 을 눌렀을 때도 따라감
}

if (window.__deskPages) start();
else window.addEventListener('desk:paginated', start, { once: true });
