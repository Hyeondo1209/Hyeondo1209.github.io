// @ts-check
import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { unified } from '@astrojs/markdown-remark';
import rehypeFootnotePrefix from './src/lib/rehype-footnote-prefix.mjs';
import remarkHighlight from './src/lib/remark-highlight.mjs';

// ─────────────────────────────────────────────────────────────
// 배포 주소 설정 (GitHub에 올리기 전에 한 번만 고치면 됩니다)
//
// 저장소 이름을 "<아이디>.github.io" 로 만들었다면:
//   site: 'https://<아이디>.github.io',  base: '/'
//
// 저장소 이름을 다른 것(예: "seorap")으로 만들었다면:
//   site: 'https://<아이디>.github.io',  base: '/seorap'
// ─────────────────────────────────────────────────────────────
export default defineConfig({
  site: 'https://kim-hyeondo.github.io',
  base: '/',
  trailingSlash: 'always',
  markdown: {
    // 수식($...$, $$...$$)과 각주를 쓰기 위한 설정
    processor: unified({
      remarkPlugins: [remarkMath, remarkHighlight],
      rehypePlugins: [rehypeKatex, rehypeFootnotePrefix],
      remarkRehype: { footnoteLabel: '각주', footnoteBackLabel: '본문으로 돌아가기' },
    }),
    shikiConfig: { theme: 'github-light' },
  },
});
