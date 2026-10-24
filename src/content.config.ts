import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// src/content/notes/ 안의 모든 .md 파일이 하나의 "낱장"이 됩니다.
// 파일 이름이 주소가 됩니다: notes/my-first-note.md → /notes/my-first-note/
// 사진이 여러 장인 글은 폴더로 만들어도 됩니다: notes/gwangju/index.md + 사진들
const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      // 부제 줄들 (Word 원고에서 제목 아래 가운데 정렬 문단)
      subtitle: z.array(z.string()).default([]),
      // 웹에서 표시(형광펜, 수정테이프 등)를 한 제목·부제. 올리기가 만들어 넣습니다.
      titleHtml: z.string().optional(),
      subtitleHtml: z.array(z.string()).optional(),
      date: z.coerce.date(),
      type: z.enum(['essay', 'paper', 'reading', 'photo', 'project']).default('essay'),
      // 책상 위 낱장에 보일 짧은 소개. 비우면 본문 앞부분을 씁니다.
      description: z.string().optional(),
      // 논문/책 정보. 예: "존 버거, 『모든 것을 소중히 하라』, 열화당, 2008"
      source: z.string().optional(),
      // 원문 링크(논문 arXiv, 번역 원문 등)
      link: z.string().url().optional(),
      // 대표 사진. 사진 글이라면 꼭 넣어주세요.
      cover: image().optional(),
      // 글에 붙일 인덱스(분류). 여러 개 붙일 수 있어요. 예: [과학철학, 광학]
      tags: z.array(z.string()).default([]),
      lang: z.enum(['ko', 'en']).default('ko'),
      // true면 사이트에 나타나지 않습니다(쓰는 중인 글).
      draft: z.boolean().default(false),
      // Word 원고에서 만들어진 글이면 원고 파일 이름
      docx: z.string().optional(),
    }),
});

export const collections = { notes };
