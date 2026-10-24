// ─────────────────────────────────────────────────────────────
// 웹에서 한 표시(형광펜, 빨간 펜, 연필, 수정테이프)를 글 속에서 다시 찾는 규칙.
// 표시는 "어느 문장의 어느 부분"으로 저장됩니다:
//   { quote: 표시한 글자, prefix: 바로 앞 글자들, suffix: 바로 뒤 글자들 }
// 띄어쓰기·줄바꿈 차이는 무시하고 찾습니다.
// 변환기(word.mjs)와 화면 편집기(desk-editor.js)가 같은 규칙을 씁니다.
// ─────────────────────────────────────────────────────────────

export const MARK_TYPES = ['hl', 'red', 'pencil', 'tape'];

const isSpace = (c) => /\s/.test(c);

/** 공백을 뺀 글자들과, 각 글자가 원래 몇 번째였는지 */
export function squeeze(text) {
  let s = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text[i])) continue;
    s += text[i];
    map.push(i);
  }
  return { s, map };
}

function commonTail(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonHead(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * texts: 문단들의 글자 (배열). mark: { quote, prefix, suffix }
 * 돌려줌: { unit, start, end } (원래 글자 기준 위치) 또는 null
 */
export function findMark(texts, mark) {
  const q = squeeze(mark.quote || '').s;
  if (!q) return null;
  const pre = squeeze(mark.prefix || '').s;
  const suf = squeeze(mark.suffix || '').s;
  let best = null;
  texts.forEach((text, unit) => {
    const { s, map } = squeeze(text);
    let from = 0;
    for (;;) {
      const at = s.indexOf(q, from);
      if (at < 0) break;
      from = at + 1;
      const score = commonTail(s.slice(0, at), pre) + commonHead(s.slice(at + q.length), suf);
      if (!best || score > best.score) best = { unit, score, start: map[at], end: map[at + q.length - 1] + 1 };
    }
  });
  return best && { unit: best.unit, start: best.start, end: best.end };
}

/** 수정테이프: 글자를 지우고 폭만 남김 (한글·한자 등 넓은 글자는 두 칸) */
export function blankOut(text) {
  let out = '';
  for (const ch of text) {
    if (/\s/.test(ch)) out += ' ';
    else out += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? '  ' : ' ';
  }
  return out;
}
