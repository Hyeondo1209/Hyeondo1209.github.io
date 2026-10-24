// ─────────────────────────────────────────────────────────────
// Word(.docx) 원고 → 사이트 글(마크다운) 변환기
//
// 원고 맨 위 (모두 생략 가능, 제목보다 위에):
//   날짜: 2026-10-24      안 쓰면: 이미 올린 글이면 그 날짜, 처음이면 오늘
//   인덱스: 철학, 독서     포스트잇 인덱스
//   주소: grgic-pyrrhonism 글 주소. 안 쓰면 파일 이름을 로마자로 바꿔서 씀
//   초안                  이 줄이 있으면 사이트에 올리지 않음
//
// Word에서 쓴 것 → 사이트에서
//   첫 가운데 정렬 문단들     → 제목, 부제 (첫 줄이 제목)
//   (가운데 정렬이 아니면 첫 문단이 제목)
//   제목 1 스타일            → 큰 제목
//   제목 2 스타일            → 밑줄 소제목
//   제목 3 스타일 / 문단 전체 굵게 → 작은 굵은 제목
//   양쪽(또는 왼쪽) 들여쓴 문단 → 인용
//   내어쓰기 문단            → 대화문, 항목, 참고문헌처럼 줄 단위로
//   Word 번호/글머리 목록     → 목록
//   각주                    → [1] 각주
//   표                      → 표
//   굵게, 기울임             → 굵게, 기울임
//   형광펜(색 상관없음)       → 노란 형광펜
//   빨간 글자               → 빨간 펜 밑줄
//   그림                    → 그림
//   수식 편집기             → 수식 (흔한 구조만. 안 되면 원고에 $...$ 로 직접)
//   하이퍼링크              → 링크
// ─────────────────────────────────────────────────────────────
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  v: 'urn:schemas-microsoft-com:vml',
};

// ── XML 도우미 ─────────────────────────────────────────────
const kids = (el) => (el ? Array.from(el.childNodes).filter((n) => n.nodeType === 1) : []);
const isW = (el, name) => el && el.namespaceURI === NS.w && el.localName === name;
const isM = (el, name) => el && el.namespaceURI === NS.m && el.localName === name;
const child = (el, ns, name) => kids(el).find((c) => c.namespaceURI === ns && c.localName === name) || null;
const wChild = (el, name) => child(el, NS.w, name);
const mChild = (el, name) => child(el, NS.m, name);
const wAttr = (el, name) => (el ? el.getAttributeNS(NS.w, name) || el.getAttribute('w:' + name) || '' : '');
const mAttr = (el, name) => (el ? el.getAttributeNS(NS.m, name) || el.getAttribute('m:' + name) || '' : '');
const descendants = (el, ns, name) => (el ? Array.from(el.getElementsByTagNameNS(ns, name)) : []);
const onOff = (el) => {
  if (!el) return false;
  const v = wAttr(el, 'val');
  return v === '' || v === '1' || v === 'true' || v === 'on';
};

// ── 마크다운 이스케이프 ─────────────────────────────────────
// $ 는 일부러 그대로 둡니다: 원고에 $...$ 로 쓴 LaTeX 수식을 살리기 위해서.
function escInline(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([*_`\[\]~|])/g, '\\$1');
}
function escLineStart(s) {
  return s
    .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*)([-+])(\s)/, '$1\\$2$3')
    .replace(/^(\s*)(\d+)([.)])(\s|$)/, '$1$2\\$3$4');
}
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// ── 한글 → 로마자 (글 주소용, 단순 음절 단위) ─────────────────
const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
export function slugify(name) {
  let out = '';
  for (const ch of name) {
    const c = ch.codePointAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) {
      const i = c - 0xac00;
      out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
    } else if (/[a-zA-Z0-9]/.test(ch)) out += ch.toLowerCase();
    else out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

// ── 스타일 정보 ───────────────────────────────────────────
function readStyles(doc) {
  const map = {};
  if (!doc) return map;
  for (const st of descendants(doc, NS.w, 'style')) {
    const id = wAttr(st, 'styleId');
    const name = (wAttr(wChild(st, 'name'), 'val') || '').toLowerCase();
    const basedOn = wAttr(wChild(st, 'basedOn'), 'val');
    const ppr = wChild(st, 'pPr');
    const rpr = wChild(st, 'rPr');
    const outline = ppr ? wAttr(wChild(ppr, 'outlineLvl'), 'val') : '';
    map[id] = { name, basedOn, outline, ppr, rpr };
  }
  return map;
}
function headingLevel(styleId, styles) {
  let id = styleId;
  for (let i = 0; i < 6 && id; i++) {
    const s = styles[id];
    if (!s) break;
    let m = s.name.match(/^heading\s*(\d)$/) || s.name.match(/^제목\s*(\d)$/);
    if (m) return Number(m[1]);
    if (s.name === 'title' || s.name === '제목') return 0;
    if (s.name === 'subtitle' || s.name === '부제') return -1;
    if (s.name === 'quote' || s.name === 'intense quote' || s.name === '인용' || s.name === '강한 인용') return -2;
    if (s.outline !== '') return Number(s.outline) + 1;
    id = s.basedOn;
  }
  return null;
}
/** 문단 속성: 스타일 → 문단 직접 서식 순서로 덮어씀 */
function paraProps(p, styles) {
  const ppr = wChild(p, 'pPr');
  const styleId = ppr ? wAttr(wChild(ppr, 'pStyle'), 'val') : '';
  const chain = [];
  let id = styleId;
  for (let i = 0; i < 6 && id && styles[id]; i++) {
    chain.unshift(styles[id]);
    id = styles[id].basedOn;
  }
  const props = { styleId, left: 0, right: 0, hanging: 0, firstLine: 0, jc: '', numPr: null, bold: false };
  const apply = (pp) => {
    if (!pp) return;
    const ind = wChild(pp, 'ind');
    if (ind) {
      const num = (n) => {
        const v = wAttr(ind, n);
        return v === '' ? null : Number(v);
      };
      const left = num('left') ?? num('start');
      const right = num('right') ?? num('end');
      if (left !== null) props.left = left;
      if (right !== null) props.right = right;
      if (num('hanging') !== null) { props.hanging = num('hanging'); props.firstLine = 0; }
      if (num('firstLine') !== null) { props.firstLine = num('firstLine'); props.hanging = 0; }
      // 글자 단위 들여쓰기(leftChars 등)는 100 = 1글자
      const lc = num('leftChars') ?? num('startChars');
      if (lc !== null && left === null) props.left = lc * 2;
      const hc = num('hangingChars');
      if (hc !== null && num('hanging') === null) props.hanging = hc * 2;
    }
    const jc = wChild(pp, 'jc');
    if (jc) props.jc = wAttr(jc, 'val');
    const numPr = wChild(pp, 'numPr');
    if (numPr) props.numPr = numPr;
  };
  chain.forEach((s) => apply(s.ppr));
  apply(ppr);
  props.heading = headingLevel(styleId, styles);
  props.styleBold = chain.some((s) => s.rpr && onOff(wChild(s.rpr, 'b')));
  return props;
}

// ── 글자 서식 ─────────────────────────────────────────────
function isRed(hex) {
  if (!hex || hex === 'auto' || hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return r >= 0xb0 && g <= 0x60 && b <= 0x60;
}
function runFormat(r, paraStyleBold) {
  const rpr = wChild(r, 'rPr');
  const f = { b: paraStyleBold, i: false, hl: false, red: false, sup: false, sub: false };
  if (!rpr) return f;
  const b = wChild(rpr, 'b');
  if (b) f.b = onOff(b);
  f.i = onOff(wChild(rpr, 'i'));
  const hl = wChild(rpr, 'highlight');
  if (hl && wAttr(hl, 'val') && wAttr(hl, 'val') !== 'none') f.hl = true;
  const shd = wChild(rpr, 'shd');
  if (shd) {
    const fill = wAttr(shd, 'fill');
    if (fill && fill !== 'auto' && fill.toUpperCase() !== 'FFFFFF') f.hl = true;
  }
  f.red = isRed(wAttr(wChild(rpr, 'color'), 'val'));
  const va = wAttr(wChild(rpr, 'vertAlign'), 'val');
  f.sup = va === 'superscript';
  f.sub = va === 'subscript';
  return f;
}
const sameFmt = (a, b) => a.b === b.b && a.i === b.i && a.hl === b.hl && a.red === b.red && a.sup === b.sup && a.sub === b.sub;

/** 서식이 같은 글자 조각들을 HTML 태그로 감쌈 (한국어 문장부호 옆에서도 안전하도록 마크다운 기호 대신 태그) */
function renderSegments(segs) {
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (s.kind === 'text' && last && last.kind === 'text' && sameFmt(last.f, s.f)) last.text += s.text;
    else merged.push({ ...s });
  }
  let out = '';
  for (const s of merged) {
    if (s.kind !== 'text') {
      out += s.md;
      continue;
    }
    let t = s.text;
    if (!t) continue;
    const lead = t.match(/^\s*/)[0];
    const trail = t.match(/\s*$/)[0];
    let core = t.slice(lead.length, t.length - trail.length);
    if (!core) {
      out += t;
      continue;
    }
    core = escInline(core);
    const f = s.f;
    if (f.sup) core = `<sup>${core}</sup>`;
    if (f.sub) core = `<sub>${core}</sub>`;
    if (f.i) core = `<em>${core}</em>`;
    if (f.b) core = `<strong>${core}</strong>`;
    if (f.red) core = `<span class="red-pen">${core}</span>`;
    if (f.hl) core = `<mark>${core}</mark>`;
    out += lead + core + trail;
  }
  return out;
}

// ── 수식(OMML) → LaTeX : 흔한 구조만 ─────────────────────────
const GREEK = {
  α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\epsilon', ϵ: '\\epsilon', ζ: '\\zeta', η: '\\eta', θ: '\\theta',
  ι: '\\iota', κ: '\\kappa', λ: '\\lambda', μ: '\\mu', ν: '\\nu', ξ: '\\xi', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau',
  υ: '\\upsilon', φ: '\\phi', ϕ: '\\phi', χ: '\\chi', ψ: '\\psi', ω: '\\omega', Γ: '\\Gamma', Δ: '\\Delta', Θ: '\\Theta',
  Λ: '\\Lambda', Ξ: '\\Xi', Π: '\\Pi', Σ: '\\Sigma', Φ: '\\Phi', Ψ: '\\Psi', Ω: '\\Omega', '∞': '\\infty', '∂': '\\partial',
  '∇': '\\nabla', '×': '\\times', '·': '\\cdot', '⋅': '\\cdot', '±': '\\pm', '∓': '\\mp', '≤': '\\le', '≥': '\\ge', '≠': '\\ne',
  '≈': '\\approx', '≡': '\\equiv', '→': '\\to', '←': '\\leftarrow', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow', '∈': '\\in',
  '∉': '\\notin', '⊂': '\\subset', '⊆': '\\subseteq', '∪': '\\cup', '∩': '\\cap', '∀': '\\forall', '∃': '\\exists', '¬': '\\neg',
  '∧': '\\wedge', '∨': '\\vee', '…': '\\ldots', '⋯': '\\cdots', 'ℏ': '\\hbar', '∝': '\\propto', '°': '^{\\circ}', '−': '-',
};
const NARY = { '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap' };
const ACC = { '̂': '\\hat', '̃': '\\tilde', '̄': '\\bar', '⃗': '\\vec', '̇': '\\dot', '̈': '\\ddot' };
function texText(s) {
  let out = '';
  for (const ch of s) out += GREEK[ch] ? GREEK[ch] + ' ' : ch === '{' || ch === '}' ? '\\' + ch : ch;
  return out;
}
function omml(el) {
  const all = (e) => kids(e).map(omml).join('');
  const arg = (e, name) => all(mChild(e, name));
  if (!el) return '';
  if (el.namespaceURI !== NS.m) return '';
  const pr = (name) => mChild(el, name + 'Pr');
  const chr = (prName, def) => {
    const c = pr(prName) && mChild(pr(prName), 'chr');
    return c ? mAttr(c, 'val') : def;
  };
  switch (el.localName) {
    case 'oMathPara':
    case 'oMath':
      return all(el);
    case 'r':
      return texText(descendants(el, NS.m, 't').map((t) => t.textContent).join(''));
    case 'f':
      return `\\frac{${arg(el, 'num')}}{${arg(el, 'den')}}`;
    case 'sSup':
      return `{${arg(el, 'e')}}^{${arg(el, 'sup')}}`;
    case 'sSub':
      return `{${arg(el, 'e')}}_{${arg(el, 'sub')}}`;
    case 'sSubSup':
      return `{${arg(el, 'e')}}_{${arg(el, 'sub')}}^{${arg(el, 'sup')}}`;
    case 'rad': {
      const deg = arg(el, 'deg');
      return deg ? `\\sqrt[${deg}]{${arg(el, 'e')}}` : `\\sqrt{${arg(el, 'e')}}`;
    }
    case 'd': {
      const dpr = pr('d');
      const beg = dpr && mChild(dpr, 'begChr') ? mAttr(mChild(dpr, 'begChr'), 'val') : '(';
      const end = dpr && mChild(dpr, 'endChr') ? mAttr(mChild(dpr, 'endChr'), 'val') : ')';
      const fix = (c) => (c === '' ? '.' : c === '{' ? '\\{' : c === '}' ? '\\}' : c === '|' ? '|' : c === '‖' ? '\\|' : c === '⟨' ? '\\langle' : c === '⟩' ? '\\rangle' : c);
      const es = kids(el).filter((c) => isM(c, 'e')).map(all).join(', ');
      return `\\left${fix(beg)} ${es} \\right${fix(end)}`;
    }
    case 'nary': {
      const op = NARY[chr('nary', '∫')] || '\\int';
      const sub = arg(el, 'sub');
      const sup = arg(el, 'sup');
      return `${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${arg(el, 'e')}`;
    }
    case 'func':
      return `\\operatorname{${arg(el, 'fName').replace(/\\/g, '')}}{${arg(el, 'e')}}`;
    case 'acc':
      return `${ACC[chr('acc', '̂')] || '\\hat'}{${arg(el, 'e')}}`;
    case 'bar':
      return `\\overline{${arg(el, 'e')}}`;
    case 'limLow':
      return `${arg(el, 'e')}_{${arg(el, 'lim')}}`;
    case 'limUpp':
      return `${arg(el, 'e')}^{${arg(el, 'lim')}}`;
    case 'eqArr':
      return `\\begin{aligned}${kids(el).filter((c) => isM(c, 'e')).map(all).join(' \\\\ ')}\\end{aligned}`;
    case 'm':
      return `\\begin{matrix}${kids(el).filter((c) => isM(c, 'mr')).map((mr) => kids(mr).filter((c) => isM(c, 'e')).map(all).join(' & ')).join(' \\\\ ')}\\end{matrix}`;
    case 'box':
    case 'borderBox':
    case 'groupChr':
    case 'phant':
      return arg(el, 'e');
    case 'sPre':
      return `{}_{${arg(el, 'sub')}}^{${arg(el, 'sup')}}${arg(el, 'e')}`;
    default:
      if (/Pr$/.test(el.localName)) return '';
      return all(el);
  }
}

// ── 변환 본체 ─────────────────────────────────────────────
export async function convertDocx(buffer, { fileName = '원고.docx' } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (path) => {
    const f = zip.file(path);
    return f ? new DOMParser().parseFromString(await f.async('string'), 'text/xml') : null;
  };
  const doc = await read('word/document.xml');
  if (!doc) throw new Error('Word 문서가 아닌 것 같아요 (document.xml 없음)');
  const styles = readStyles(await read('word/styles.xml'));
  const rels = {};
  const relDoc = await read('word/_rels/document.xml.rels');
  if (relDoc) for (const r of Array.from(relDoc.getElementsByTagName('Relationship'))) rels[r.getAttribute('Id')] = { target: r.getAttribute('Target'), mode: r.getAttribute('TargetMode') };
  const numbering = await read('word/numbering.xml');
  const fnDoc = await read('word/footnotes.xml');
  const enDoc = await read('word/endnotes.xml');

  const warnings = [];
  const images = []; // { name, data }
  const notes = []; // 각주 본문 (등장 순서)
  const noteIndex = new Map();

  // 번호 목록 종류
  const numFmt = (numId, ilvl) => {
    if (!numbering) return 'decimal';
    const num = descendants(numbering, NS.w, 'num').find((n) => wAttr(n, 'numId') === numId);
    if (!num) return 'decimal';
    const absId = wAttr(wChild(num, 'abstractNumId'), 'val');
    const abs = descendants(numbering, NS.w, 'abstractNum').find((a) => wAttr(a, 'abstractNumId') === absId);
    const lvl = abs && descendants(abs, NS.w, 'lvl').find((l) => wAttr(l, 'ilvl') === String(ilvl));
    return lvl ? wAttr(wChild(lvl, 'numFmt'), 'val') || 'decimal' : 'decimal';
  };

  async function imageMd(blip) {
    const id = blip.getAttributeNS(NS.r, 'embed') || blip.getAttributeNS(NS.r, 'id') || blip.getAttribute('r:embed') || blip.getAttribute('r:id');
    const rel = rels[id];
    if (!rel || rel.mode === 'External') return '';
    const path = 'word/' + rel.target.replace(/^\.?\//, '').replace(/^word\//, '');
    const f = zip.file(path);
    if (!f) return '';
    const ext = (path.split('.').pop() || 'png').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
      warnings.push(`그림 형식(${ext})은 사이트에서 쓸 수 없어서 뺐어요. PNG나 JPG로 넣어주세요.`);
      return '';
    }
    const name = `image${images.length + 1}.${ext === 'jpeg' ? 'jpg' : ext}`;
    images.push({ name, data: await f.async('nodebuffer') });
    return `![](./${name})`;
  }

  // 문단 안의 글자들을 조각으로
  async function inlineSegs(p, ctx) {
    const segs = [];
    const paraBold = ctx.paraBold;
    async function walk(node, link) {
      for (const n of kids(node)) {
        if (isW(n, 'r')) {
          const f = runFormat(n, paraBold);
          for (const c of kids(n)) {
            if (isW(c, 't')) segs.push({ kind: 'text', text: c.textContent, f });
            else if (isW(c, 'tab')) segs.push({ kind: 'text', text: ' ', f });
            else if (isW(c, 'br') || isW(c, 'cr')) {
              if (wAttr(c, 'type') === 'page') continue;
              segs.push({ kind: 'raw', md: '<br>' });
            } else if (isW(c, 'noBreakHyphen')) segs.push({ kind: 'text', text: '-', f });
            else if (isW(c, 'sym')) {
              const code = parseInt(wAttr(c, 'char'), 16);
              if (!Number.isNaN(code)) segs.push({ kind: 'text', text: String.fromCodePoint(code > 0xf000 ? code - 0xf000 : code), f });
            } else if (isW(c, 'footnoteReference') || isW(c, 'endnoteReference')) {
              const kind = isW(c, 'footnoteReference') ? 'f' : 'e';
              const id = kind + wAttr(c, 'id');
              if (!noteIndex.has(id)) {
                noteIndex.set(id, notes.length + 1);
                notes.push({ kind, id: wAttr(c, 'id') });
              }
              segs.push({ kind: 'raw', md: `[^${noteIndex.get(id)}]` });
            } else if (isW(c, 'drawing') || isW(c, 'pict') || isW(c, 'object')) {
              for (const blip of [...descendants(c, NS.a, 'blip'), ...descendants(c, NS.v, 'imagedata')]) {
                const md = await imageMd(blip);
                if (md) segs.push({ kind: 'raw', md: `\n\n${md}\n\n` });
              }
            }
          }
        } else if (isW(n, 'hyperlink')) {
          const rid = n.getAttributeNS(NS.r, 'id') || n.getAttribute('r:id');
          const href = rid && rels[rid] ? rels[rid].target : '';
          if (href) {
            const inner = [];
            const save = segs.length;
            await walk(n, href);
            const part = segs.splice(save);
            inner.push(...part);
            segs.push({ kind: 'raw', md: `<a href="${escAttr(href)}">${renderSegments(inner)}</a>` });
          } else await walk(n, link);
        } else if (isW(n, 'ins') || isW(n, 'smartTag') || isW(n, 'fldSimple') || isW(n, 'customXml') || isW(n, 'dir') || isW(n, 'bdo')) {
          await walk(n, link);
        } else if (isW(n, 'sdt')) {
          await walk(wChild(n, 'sdtContent'), link);
        } else if (isM(n, 'oMath')) {
          segs.push({ kind: 'raw', md: `$${omml(n).trim()}$` });
          ctx.hadMath = true;
        } else if (isM(n, 'oMathPara')) {
          segs.push({ kind: 'raw', md: `\n\n$$\n${omml(n).trim()}\n$$\n\n` });
          ctx.hadMath = true;
        }
        // w:del(지운 글), w:pPr, 책갈피 등은 건너뜀
      }
    }
    await walk(p);
    return segs;
  }
  const plain = (segs) => segs.filter((s) => s.kind === 'text').map((s) => s.text).join('');

  // ── 1단계: 문단들을 블록 목록으로 ──
  const body = descendants(doc, NS.w, 'body')[0];
  const blocks = [];
  async function collect(container) {
    for (const el of kids(container)) {
      if (isW(el, 'p')) {
        const props = paraProps(el, styles);
        const runs = descendants(el, NS.w, 'r').filter((r) => descendants(r, NS.w, 't').some((t) => t.textContent.trim()));
        const allBold = runs.length > 0 && runs.every((r) => runFormat(r, props.styleBold).b);
        const ctx = { paraBold: props.styleBold, hadMath: false };
        const segs = await inlineSegs(el, ctx);
        blocks.push({ type: 'p', props, segs, text: plain(segs).trim(), allBold, hasRaw: segs.some((s) => s.kind === 'raw') });
      } else if (isW(el, 'tbl')) {
        const rows = [];
        for (const tr of kids(el).filter((c) => isW(c, 'tr'))) {
          const cells = [];
          for (const tc of kids(tr).filter((c) => isW(c, 'tc'))) {
            const parts = [];
            for (const p of kids(tc).filter((c) => isW(c, 'p'))) {
              const s = await inlineSegs(p, { paraBold: false });
              const md = renderSegments(s).trim();
              if (md) parts.push(md);
            }
            cells.push(parts.join('<br>'));
          }
          rows.push(cells);
        }
        blocks.push({ type: 'table', rows });
      } else if (isW(el, 'sdt')) {
        await collect(wChild(el, 'sdtContent'));
      }
    }
  }
  await collect(body);

  // ── 2단계: 맨 위 머리 줄 (날짜, 인덱스, 주소, 초안) ──
  const meta = { date: null, tags: [], slug: null, draft: false, lang: null };
  while (blocks.length) {
    const b = blocks[0];
    if (b.type !== 'p') break;
    if (!b.text && !b.hasRaw) {
      blocks.shift();
      continue;
    }
    const m = b.text.match(/^(날짜|인덱스|주소|언어)\s*[:：]\s*(.*)$/);
    if (m) {
      const v = m[2].trim();
      if (m[1] === '날짜') {
        const d = v.replace(/[./년월]\s*/g, '-').replace(/일$/, '').replace(/\s+/g, '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (d) meta.date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`;
        else warnings.push(`날짜를 읽지 못했어요: "${v}" (2026-10-24 처럼 써주세요)`);
      } else if (m[1] === '인덱스') meta.tags = v.split(/[,，、]/).map((t) => t.trim()).filter(Boolean);
      else if (m[1] === '주소') meta.slug = slugify(v);
      else if (m[1] === '언어') meta.lang = /영|en/i.test(v) ? 'en' : 'ko';
      blocks.shift();
      continue;
    }
    if (/^초안$/.test(b.text)) {
      meta.draft = true;
      blocks.shift();
      continue;
    }
    break;
  }

  // ── 3단계: 제목과 부제 ──
  let title = '';
  const subtitle = [];
  const firstP = blocks.findIndex((b) => b.type === 'p' && (b.text || b.hasRaw));
  if (firstP >= 0) {
    // 첫 문단이 제목. 이어지는 가운데 정렬 문단이나 부제 스타일 문단은 부제 줄.
    const centered = (x) => x && x.type === 'p' && x.props.jc === 'center' && x.props.heading === null;
    title = blocks[firstP].text;
    blocks.splice(0, firstP + 1);
    while (blocks.length) {
      const n = blocks[0];
      if (n.type !== 'p') break;
      if (!n.text && !n.hasRaw) {
        blocks.shift();
        continue;
      }
      if (centered(n) || n.props.heading === -1) {
        subtitle.push(n.text);
        blocks.shift();
      } else break;
    }
  }
  if (!title) title = fileName.replace(/\.docx$/i, '');

  // ── 4단계: 본문 블록 → 마크다운 ──
  const out = [];
  let group = null; // { kind: 'quote' | 'lines' | 'list', items: [], ... }
  const flush = () => {
    if (!group) return;
    if (group.kind === 'quote') out.push(group.items.map((t) => '> ' + t).join('\n>\n'));
    else if (group.kind === 'lines') {
      out.push(`<div class="lines" style="--first:${group.first}ch;--rest:${group.rest}ch">\n\n${group.items.join('\n\n')}\n\n</div>`);
    } else if (group.kind === 'list') out.push(group.items.join('\n'));
    group = null;
  };
  const toCh = (twips) => Math.max(0, Math.round(twips / 100));

  for (const b of blocks) {
    if (b.type === 'table') {
      flush();
      const rows = b.rows.filter((r) => r.length);
      if (!rows.length) continue;
      const w = Math.max(...rows.map((r) => r.length));
      const cell = (c) => (c || ' ').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const line = (r) => '| ' + Array.from({ length: w }, (_, i) => cell(r[i])).join(' | ') + ' |';
      out.push([line(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n'));
      continue;
    }
    if (!b.text && !b.hasRaw) {
      flush();
      continue;
    }
    const p = b.props;
    let md = renderSegments(b.segs).trim();

    // 제목들
    if (p.heading !== null && p.heading >= 1) {
      flush();
      const lvl = Math.min(4, p.heading + 1); // 제목 1 → ##, 제목 2 → ###, 제목 3 이하 → ####
      out.push(`${'#'.repeat(lvl)} ${md.replace(/<\/?strong>/g, '')}`);
      continue;
    }
    if (p.heading === 0) {
      flush();
      out.push(`## ${md.replace(/<\/?strong>/g, '')}`);
      continue;
    }
    if (b.allBold && !p.numPr && b.text.length <= 80 && !/[.。]$/.test(b.text) && p.hanging === 0) {
      flush();
      out.push(`#### ${md.replace(/<\/?strong>/g, '')}`);
      continue;
    }
    // 목록
    if (p.numPr) {
      const ilvl = Number(wAttr(wChild(p.numPr, 'ilvl'), 'val') || 0);
      const numId = wAttr(wChild(p.numPr, 'numId'), 'val');
      const fmt = numFmt(numId, ilvl);
      if (group?.kind !== 'list') {
        flush();
        group = { kind: 'list', items: [] };
      }
      group.items.push(`${'   '.repeat(ilvl)}${fmt === 'bullet' ? '-' : '1.'} ${md}`);
      continue;
    }
    // 인용
    if (p.heading === -2 || (p.left >= 200 && p.hanging === 0 && p.firstLine <= 0)) {
      if (group?.kind !== 'quote') {
        flush();
        group = { kind: 'quote', items: [] };
      }
      group.items.push(escLineStart(md));
      continue;
    }
    // 내어쓰기 줄들 (대화문, 항목, 참고문헌)
    if (p.hanging > 0) {
      const first = toCh(p.left - p.hanging);
      const rest = toCh(p.left);
      if (group?.kind !== 'lines' || group.first !== first || group.rest !== rest) {
        flush();
        group = { kind: 'lines', items: [], first, rest };
      }
      group.items.push(escLineStart(md));
      continue;
    }
    // 보통 문단
    flush();
    if (p.jc === 'center') out.push(`<p class="center">${md}</p>`);
    else if (p.jc === 'right' || p.jc === 'end') out.push(`<p class="right">${md}</p>`);
    else out.push(escLineStart(md));
  }
  flush();

  // ── 5단계: 각주 ──
  const noteMd = [];
  for (const [i, n] of notes.entries()) {
    const src = n.kind === 'f' ? fnDoc : enDoc;
    const el = src && descendants(src, NS.w, n.kind === 'f' ? 'footnote' : 'endnote').find((x) => wAttr(x, 'id') === n.id);
    let text = '';
    if (el) {
      const parts = [];
      for (const p of kids(el).filter((c) => isW(c, 'p'))) {
        const segs = await inlineSegs(p, { paraBold: false });
        parts.push(renderSegments(segs).trim());
      }
      text = parts.filter(Boolean).join(' ');
    }
    noteMd.push(`[^${i + 1}]: ${text || ' '}`);
  }

  const bodyMd = out.join('\n\n') + (noteMd.length ? '\n\n' + noteMd.join('\n') : '') + '\n';
  return { title, subtitle, meta, body: bodyMd, images, warnings };
}

/** 사이트 글 파일(frontmatter + 본문) 만들기 */
export function toNoteFile({ title, subtitle, meta, body }, { date, docxName }) {
  const q = (s) => JSON.stringify(s);
  const lines = ['---', `title: ${q(title)}`];
  if (subtitle.length) lines.push(`subtitle: [${subtitle.map(q).join(', ')}]`);
  lines.push(`date: ${date}`);
  if (meta.tags.length) lines.push(`tags: [${meta.tags.map(q).join(', ')}]`);
  if (meta.lang === 'en') lines.push('lang: en');
  if (meta.draft) lines.push('draft: true');
  lines.push(`docx: ${q(docxName)}`);
  lines.push('---', '', '<!-- 이 파일은 원고 폴더의 Word 파일에서 자동으로 만들어졌어요. 고치려면 Word 원고를 고치고 다시 올리세요. -->', '');
  return lines.join('\n') + body;
}
