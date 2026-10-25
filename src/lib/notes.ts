import { getCollection, type CollectionEntry } from 'astro:content';

export type Note = CollectionEntry<'notes'>;

export async function getNotes(): Promise<Note[]> {
  const all = await getCollection('notes', ({ data }) => !data.draft);
  // 글의 날짜(원고의 "날짜:" 줄, 미리보기에서 바꾼 날짜, 없으면 처음 올린 날) 기준으로 최신 글이 위.
  // 오래된 글이 위로 오게 하려면 NEWEST_FIRST 를 false 로.
  const NEWEST_FIRST = true;
  return all.sort((a, b) => {
    const d = a.data.date.getTime() - b.data.date.getTime();
    if (d !== 0) return NEWEST_FIRST ? -d : d;
    return a.data.title.localeCompare(b.data.title, 'ko');
  });
}

/** 첫 화면과 글 목록에 보일 글 (목록에서 숨긴 글은 빠지고, 링크로만 열림) */
export async function getListedNotes(): Promise<Note[]> {
  return (await getNotes()).filter((n) => !n.data.unlisted);
}

/** 사이트 안 링크. base 설정(예: /seorap)을 자동으로 붙입니다. */
export function url(path = '/'): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
}

export function noteUrl(note: Note): string {
  return url(`/notes/${note.id}/`);
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

/** 마크다운 본문에서 짧은 발췌를 만듭니다. */
export function excerpt(note: Note, max = 120): string {
  if (note.data.description) return note.data.description;
  const text = (note.body ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ') // 자동 생성 안내 주석
    .replace(/<aside[\s\S]*?<\/aside>/g, ' ') // 여백 메모 묶음 (본문이 아님)
    .replace(/<[^>]+>/g, ' ') // 남은 HTML 태그 (메모 표시, 줄 묶음 등)
    .replace(/&(nbsp|#160|#xa0);/gi, ' ')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]+\](:.*)?/g, ' ')
    .replace(/^#+\s.*$/gm, ' ')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
    .replace(/[*`~#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}
