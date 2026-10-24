// 손으로 쓴 마크다운용 표시:
//   ==형광펜==  → <mark>
//   !!빨간 펜!! → <span class="red-pen">
// (Word 원고에서 변환된 글은 변환기가 직접 태그를 넣으므로 이 규칙과 상관없음)
const RULES = [
  { re: /(==[^=\n]+==)/g, test: /^==[^=\n]+==$/, open: '<mark>', close: '</mark>' },
  { re: /(!![^!\n]+!!)/g, test: /^!![^!\n]+!!$/, open: '<span class="red-pen">', close: '</span>' },
];
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export default function remarkHighlight() {
  return (tree) => {
    const walk = (node, parent) => {
      if (node.type === 'text' && parent) {
        for (const rule of RULES) {
          if (!rule.test.test(node.value) && !node.value.match(rule.re)) continue;
          const parts = node.value.split(rule.re).filter(Boolean);
          if (parts.length < 2 && !rule.test.test(node.value)) continue;
          const nodes = parts.map((t) =>
            rule.test.test(t) ? { type: 'html', value: rule.open + esc(t.slice(2, -2)) + rule.close } : { type: 'text', value: t },
          );
          const i = parent.children.indexOf(node);
          parent.children.splice(i, 1, ...nodes);
          nodes.filter((n) => n.type === 'text').forEach((n) => walk(n, parent));
          return;
        }
      }
      if (node.children) [...node.children].forEach((c) => walk(c, node));
    };
    walk(tree, null);
  };
}
