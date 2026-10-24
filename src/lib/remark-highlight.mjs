// ==형광펜== 문법을 <mark>로 바꿉니다.
export default function remarkHighlight() {
  return (tree) => {
    const walk = (node, parent) => {
      if (node.type === 'text' && parent && node.value.includes('==')) {
        const parts = node.value.split(/(==[^=\n]+==)/g).filter(Boolean);
        if (parts.length > 1) {
          const nodes = parts.map((t) =>
            /^==[^=\n]+==$/.test(t)
              ? { type: 'html', value: `<mark>${t.slice(2, -2).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</mark>` }
              : { type: 'text', value: t },
          );
          const i = parent.children.indexOf(node);
          parent.children.splice(i, 1, ...nodes);
          return;
        }
      }
      if (node.children) [...node.children].forEach((c) => walk(c, node));
    };
    walk(tree, null);
  };
}
