// ─────────────────────────────────────────────────────────────
// 글을 A4 장 단위로 나눕니다.
//
// 서버에서는 글 전체가 한 덩어리(.report__source)로 들어오고,
// 이 스크립트가 화면 폭에 맞춰 A4 비율의 장(.sheet)들로 옮겨 담습니다.
// 기기마다 글꼴 폭이 조금씩 달라서(굴림체 / 백묵 굴림) 미리 자를 수 없기 때문입니다.
//
// data-mode="full"  : 모든 장을 세로로 이어 보여줌 (보고서 페이지)
// data-mode="cover" : 첫 장만 보여주고, 뒷장은 겹친 종이로만 표시 (첫 화면)
// ─────────────────────────────────────────────────────────────

const A4_WIDTH = 794; // 210mm at 96dpi
const A4_RATIO = 297 / 210;

// 좁은 화면(폰)에서 보고서를 어떻게 보여줄지
//  'pages'  : 폰 폭에 맞춘 A4 비율 장으로 나눔 (장 수가 늘어남)
//  'scroll' : 장을 나누지 않고 긴 종이 한 장으로
//  'shrink' : 실제 A4 한 장을 통째로 축소 (글자가 아주 작아짐)
const MOBILE_BREAKPOINT = 760;
const MOBILE_MODE: 'pages' | 'scroll' | 'shrink' =
  ((window as any).__DESK_MOBILE_MODE as 'pages' | 'scroll' | 'shrink') || 'pages';
const isNarrow = () => document.documentElement.clientWidth <= MOBILE_BREAKPOINT;

type Remainder = Element | null | 'all';

const TEXT_LIKE = new Set(['P', 'LI', 'DD', 'DT', 'FIGCAPTION']);
const CONTAINER = new Set(['BLOCKQUOTE', 'OL', 'UL', 'SECTION', 'DL', 'DIV', 'HEADER']);
const HEADING = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER']);

function hasBlockChildren(el: Element) {
  return Array.from(el.children).some((c) => TEXT_LIKE.has(c.tagName) || CONTAINER.has(c.tagName));
}

/** 요소 안의 글자 위치들(문서 순서). 수식(KaTeX) 안은 쪼개지 않도록 건너뜀 */
function textPositions(el: Element): Array<[Text, number]> {
  const out: Array<[Text, number]> = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest('.katex') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    for (let i = 0; i < n.length; i++) out.push([n, i]);
  }
  return out;
}

function charBottom(node: Text, i: number) {
  const r = document.createRange();
  r.setStart(node, i);
  r.setEnd(node, i + 1);
  const rects = r.getClientRects();
  const rect = rects[rects.length - 1] ?? r.getBoundingClientRect();
  return rect.bottom;
}

/** 문단을 limit 높이에서 자르고, 넘친 뒷부분을 새 요소로 돌려줌 */
function splitText(el: Element, limit: number): Remainder {
  const pos = textPositions(el);
  if (pos.length === 0) return 'all';
  // 마지막으로 들어가는 글자를 이분 탐색
  let lo = -1;
  let hi = pos.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    const [n, i] = pos[mid];
    if (charBottom(n, i) <= limit + 0.5) lo = mid;
    else hi = mid - 1;
  }
  if (lo < 0) return 'all';
  if (lo === pos.length - 1) return null;
  const [n, i] = pos[lo + 1];
  const range = document.createRange();
  range.setStart(n, i);
  range.setEnd(el, el.childNodes.length);
  const frag = range.extractContents();
  const rest = el.cloneNode(false) as Element;
  rest.removeAttribute('id');
  rest.classList.add('is-continued');
  el.classList.add('is-split');
  rest.append(frag);
  return rest;
}

/** 요소를 limit에서 자름. null: 다 들어감 / 'all': 하나도 안 들어감 / Element: 넘친 부분 */
function splitNode(el: Element, limit: number): Remainder {
  if (el.getBoundingClientRect().bottom <= limit + 0.5) return null;

  if (TEXT_LIKE.has(el.tagName) && !hasBlockChildren(el)) return splitText(el, limit);

  if (CONTAINER.has(el.tagName) || (el.tagName === 'LI' && hasBlockChildren(el))) {
    const kids = Array.from(el.children);
    const i = kids.findIndex((c) => c.getBoundingClientRect().bottom > limit + 0.5);
    if (i < 0) return null;
    const r = splitNode(kids[i], limit);
    const rest = el.cloneNode(false) as Element;
    rest.removeAttribute('id');
    if (r === 'all') {
      if (i === 0) return 'all';
      kids.slice(i).forEach((c) => rest.append(c));
    } else {
      if (r) rest.append(r);
      kids.slice(i + 1).forEach((c) => rest.append(c));
    }
    // 번호 목록이 다음 장에서 이어지도록
    if (el instanceof HTMLOListElement && rest instanceof HTMLOListElement) {
      const kept = el.children.length;
      const first = rest.firstElementChild;
      rest.start = (el.start || 1) + kept - (first?.classList.contains('is-continued') ? 1 : 0);
    }
    return rest;
  }
  return 'all';
}

function makeSheet(index: number, mode: string) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const body = document.createElement('div');
  body.className = 'sheet__body';
  sheet.append(body);
  if (mode === 'full') {
    const folio = document.createElement('div');
    folio.className = 'sheet__folio';
    folio.textContent = `- ${index + 1} -`;
    sheet.append(folio);
  }
  return { sheet, body };
}

function paginate(report: HTMLElement, template: HTMLElement) {
  const mode = report.dataset.mode || 'full';
  report.classList.remove('is-scaled'); // 첫 화면의 줄임은 다 나눈 뒤에
  const pagesEl = report.querySelector<HTMLElement>('.report__pages')!;
  // 다시 나눌 때(창 크기 변경 등) 첫 장에 붙여 둔 인덱스가 같이 지워지지 않게 먼저 빼 둠
  const keepFlags = report.querySelector('.flags');
  if (keepFlags) report.prepend(keepFlags);
  pagesEl.replaceChildren();

  const narrow = isNarrow();
  const shrink = narrow && MOBILE_MODE === 'shrink';
  const avail = shrink ? A4_WIDTH : Math.min(A4_WIDTH, document.documentElement.clientWidth - 32);
  report.style.setProperty('--sheet-w', `${avail}px`);
  report.style.setProperty('--sheet-h', `${Math.round(avail * A4_RATIO)}px`);
  report.classList.remove('is-shrunk'); // 축소는 나눈 뒤에 적용 (측정이 틀어지지 않게)
  report.style.setProperty('--shrink', shrink ? String((document.documentElement.clientWidth - 32) / A4_WIDTH) : '1');

  if (narrow && MOBILE_MODE === 'scroll') {
    // 긴 종이 한 장: 나누지 않고 원본을 그대로 한 장에
    const one = template.cloneNode(true) as HTMLElement;
    const d = one.querySelector('.report__date');
    d?.remove();
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet--long';
    const body = document.createElement('div');
    body.className = 'sheet__body';
    body.append(...Array.from(one.children));
    sheet.append(body);
    pagesEl.append(sheet);
    report.dataset.pages = '1';
    report.classList.remove('is-stapled');
    const flags = report.querySelector('.flags');
    if (flags) sheet.append(flags);
    if (d) sheet.append(d);
    return;
  }

  const src = template.cloneNode(true) as HTMLElement;
  // 여백 메모는 본문 흐름에서 빼고, 장을 다 나눈 뒤 오른쪽 여백에 붙임
  const memos = src.querySelector('.memos');
  memos?.remove();
  // 날짜는 본문 흐름에서 빼서 첫 장 오른쪽 위에 따로 붙임
  const date = src.querySelector('.report__date');
  date?.remove();
  const blocks = Array.from(src.children);

  let { sheet, body } = makeSheet(0, mode);
  const sheets = [sheet];
  pagesEl.append(sheet);

  const limitOf = (b: HTMLElement) => b.getBoundingClientRect().top + b.clientHeight;

  const newSheet = () => {
    ({ sheet, body } = makeSheet(sheets.length, mode));
    sheets.push(sheet);
    pagesEl.append(sheet);
  };

  let queue: Element[] = blocks;
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const block = queue.shift()!;
    body.append(block);
    const limit = limitOf(body);
    if (block.getBoundingClientRect().bottom <= limit + 0.5) continue;

    const r = HEADING.has(block.tagName) ? 'all' : splitNode(block, limit);
    if (r === null) continue;

    if (r === 'all') {
      if (body.children.length === 1) {
        // 한 장보다 큰 덩어리(큰 그림 등): 그대로 두고 다음 장으로
        newSheet();
        continue;
      }
      block.remove();
      // 제목이 장 끝에 혼자 남지 않도록 같이 넘김
      const carry: Element[] = [block];
      const prev = body.lastElementChild;
      if (prev && HEADING.has(prev.tagName) && body.children.length > 1) carry.unshift(prev);
      carry.forEach((c) => c.remove());
      newSheet();
      queue = [...carry, ...queue];
      continue;
    }
    newSheet();
    queue = [r, ...queue];
  }

  const total = sheets.length;
  report.dataset.pages = String(total);
  report.classList.toggle('is-stapled', total >= 2);

  // 인덱스는 첫 장 오른쪽 가장자리에, 날짜는 첫 장 오른쪽 위에
  const flags = report.querySelector('.flags');
  if (flags) sheets[0].append(flags);
  if (date) sheets[0].append(date);

  if (mode === 'cover') {
    sheets.slice(1).forEach((s) => s.remove());
  }
  report.classList.toggle('is-shrunk', shrink);
  if (mode === 'cover') report.classList.add('is-scaled');
  placeMemos(report, mode === 'full' && !narrow ? memos : null);
}

// ── 여백 메모: 메모가 붙은 문장 높이에, 겹치면 아래로 ──────────────
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** 찢은 종이의 윗변: 메모마다 다르지만 매번 같은 모양 */
function tearEdge(id: string) {
  let seed = hash(id);
  const rand = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  const pts: string[] = [];
  for (let x = 0; x <= 100; x += 1.25) pts.push(`${x}% ${(1 + rand() * 7 + (x % 10 === 0 ? 2 : 0)).toFixed(1)}px`);
  return `polygon(${pts.join(', ')}, 100% 100%, 0% 100%)`;
}
function placeMemos(report: HTMLElement, memos: Element | null) {
  report.querySelector('.report__margin')?.remove();
  if (!memos || !memos.children.length) return;
  const layer = document.createElement('div');
  layer.className = 'report__margin';
  report.append(layer);
  const top0 = report.getBoundingClientRect().top;
  const pages = report.querySelector('.report__pages')!;
  const flags = report.querySelector('.flags');
  let floor = flags ? flags.getBoundingClientRect().bottom - top0 + 20 : 0;

  const items = Array.from(memos.children).map((m) => {
    const id = (m as HTMLElement).dataset.memo || '';
    const at = pages.querySelector(`[data-memo="${CSS.escape(id)}"]`);
    return { m: m.cloneNode(true) as HTMLElement, id, y: at ? at.getBoundingClientRect().top - top0 - 4 : Infinity };
  });
  items.sort((a, b) => a.y - b.y);
  for (const { m, id, y } of items) {
    const h = hash(id);
    m.style.setProperty('--tilt', `${((h % 7) - 3) * 0.45}deg`);
    m.style.setProperty('--nudge', `${(h >> 3) % 14}px`);
    if (m.classList.contains('memo--paper')) m.style.setProperty('--tear', tearEdge(id));
    layer.append(m);
    const top = Math.max(Number.isFinite(y) ? y : floor, floor);
    m.style.top = `${Math.round(top)}px`;
    floor = top + m.offsetHeight + 14;
  }
  // 메모가 마지막 장보다 길게 이어지면 그만큼 자리를 늘림
  report.style.minHeight = floor > report.offsetHeight ? `${Math.ceil(floor + 24)}px` : '';
  // 메모와 문장을 함께 밝히기
  const light = (id: string, on: boolean) =>
    report.querySelectorAll(`[data-memo="${CSS.escape(id)}"]`).forEach((el) => el.classList.toggle('is-lit', on));
  layer.querySelectorAll<HTMLElement>('.memo').forEach((m) => {
    m.addEventListener('mouseenter', () => light(m.dataset.memo!, true));
    m.addEventListener('mouseleave', () => light(m.dataset.memo!, false));
  });
  pages.querySelectorAll<HTMLElement>('.memo-text').forEach((t) => {
    t.addEventListener('mouseenter', () => light(t.dataset.memo!, true));
    t.addEventListener('mouseleave', () => light(t.dataset.memo!, false));
  });
}

function init() {
  const reports = Array.from(document.querySelectorAll<HTMLElement>('.report'));
  const templates = new Map<HTMLElement, HTMLElement>();
  reports.forEach((r) => {
    const src = r.querySelector<HTMLElement>('.report__source');
    if (!src) return;
    src.remove(); // 원본은 화면에서 빼고 보관 (id 중복 방지)
    templates.set(r, src);
  });
  const run = () => reports.forEach((r) => templates.has(r) && paginate(r, templates.get(r)!));
  document.documentElement.classList.add('is-paginated');
  run();
  // 내 컴퓨터의 미리보기에서만 쓰는 표시하기 도구가 원본을 고치고 다시 나눌 수 있게
  (window as any).__deskPages = { templates, run };
  window.dispatchEvent(new Event('desk:paginated'));

  let lastW = document.documentElement.clientWidth;
  let t: number | undefined;
  window.addEventListener('resize', () => {
    const w = document.documentElement.clientWidth;
    if (w === lastW) return;
    lastW = w;
    clearTimeout(t);
    t = window.setTimeout(run, 150);
  });
}

document.fonts.ready.then(init);
