// ─────────────────────────────────────────────────────────────
// 첫 화면에서 보고서를 누르면: 작게 놓인 그 종이가 커지면서 글 페이지 첫 장 자리로 간 뒤 이동.
// 도착한 글 페이지에서는 뒷장과 여백 메모가 뒤따라 나타남 (global.css 의 desk-arrive).
// 움직임을 줄이도록 설정한 기기, 새 탭으로 여는 경우(Ctrl·가운데 클릭)는 그냥 이동.
// ─────────────────────────────────────────────────────────────
const KEY = 'desk-open';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

try {
  if (sessionStorage.getItem(KEY) === '1') {
    sessionStorage.removeItem(KEY);
    document.documentElement.classList.add('desk-arrive');
  }
} catch {}

document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('.report[data-mode="cover"] a.report__open') as HTMLAnchorElement | null;
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || reduced()) return;
  const report = a.closest('.report') as HTMLElement;
  const sheet = report.querySelector('.sheet') as HTMLElement | null;
  const main = document.querySelector('main');
  if (!sheet || !main) return;
  e.preventDefault();

  // 작은 종이를 그대로 복제해 화면 위에 띄움 (확대·크기는 원래 A4 기준)
  const rect = sheet.getBoundingClientRect();
  const scale = rect.width / sheet.offsetWidth || 1;
  const fly = sheet.cloneNode(true) as HTMLElement;
  fly.querySelector('.flags')?.remove();
  fly.classList.add('desk-fly');
  const cs = getComputedStyle(report);
  for (const v of ['--age', '--sheet-w', '--sheet-h', '--pad', '--paper-now']) fly.style.setProperty(v, cs.getPropertyValue(v));
  fly.style.backgroundColor = getComputedStyle(sheet).backgroundColor;
  Object.assign(fly.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${sheet.offsetWidth}px`,
    height: `${sheet.offsetHeight}px`,
    transform: `scale(${scale})`,
  });
  document.body.append(fly);
  sheet.style.visibility = 'hidden';

  // 도착할 자리: 글 페이지는 맨 위에서 시작하므로, 문서 기준 main 의 왼쪽 위
  const m = main.getBoundingClientRect();
  const toX = m.left - rect.left;
  const toY = m.top + window.scrollY - rect.top;
  requestAnimationFrame(() => {
    fly.style.transform = `translate(${toX}px, ${toY}px) scale(1)`;
  });
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {}
  setTimeout(() => (location.href = a.href), 560);
});

// 뒤로 가기로 돌아왔을 때 숨겨 둔 종이를 되살림
window.addEventListener('pageshow', (e) => {
  if (!(e as PageTransitionEvent).persisted) return;
  document.querySelectorAll('.desk-fly').forEach((f) => f.remove());
  document.querySelectorAll<HTMLElement>('.report[data-mode="cover"] .sheet').forEach((s) => (s.style.visibility = ''));
});
