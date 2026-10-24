// 첫 화면에 여러 글이 이어질 때 각주 번호(#fn-1 등)가 서로 겹치지 않도록
// 글마다 고유한 접두어를 붙입니다.
import path from 'node:path';

export default function rehypeFootnotePrefix() {
  return (tree, file) => {
    const p = file.path || (file.history && file.history[0]) || '';
    let slug = path.basename(p, path.extname(p));
    if (slug === 'index') slug = path.basename(path.dirname(p));
    slug = slug.replace(/[^\w-]/g, '_');
    const fix = (v) => (typeof v === 'string' ? v.replace(/user-content-fn/g, `${slug}-fn`) : v);
    const walk = (node) => {
      if (node.properties) {
        if (node.properties.id) node.properties.id = fix(node.properties.id);
        if (node.properties.href) node.properties.href = fix(node.properties.href);
        if (Array.isArray(node.properties.ariaDescribedBy)) node.properties.ariaDescribedBy = node.properties.ariaDescribedBy.map(fix);
      }
      (node.children || []).forEach(walk);
    };
    walk(tree);
  };
}
