// 사이트 전체에 쓰이는 이름과 소개 문구. 여기만 고치면 모든 페이지에 반영됩니다.
export const SITE = {
  title: 'Desk',
  owner: '김현도',
  // 검색 결과나 링크 미리보기에 나오는 한 줄 소개
  intro: '김현도의 글, 논문 노트, 독서 노트.',
};

// 인덱스(포스트잇) 색. 다섯 가지 색을 돌려 씁니다.
// 분류에 색을 고정하고 싶으면 FLAG_COLORS에 "분류 이름: 색" 으로 적어주세요.
// 적지 않은 분류는 이름에 따라 자동으로 색이 정해집니다.
export const FLAG_PALETTE = ['yellow', 'pink', 'blue', 'green', 'orange'] as const;
export const FLAG_COLORS: Record<string, (typeof FLAG_PALETTE)[number]> = {
  과학철학: 'blue',
  광학: 'green',
  독서: 'yellow',
  번역: 'pink',
  사진: 'orange',
};
export function flagColor(tag: string) {
  if (FLAG_COLORS[tag]) return FLAG_COLORS[tag];
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FLAG_PALETTE[h % FLAG_PALETTE.length];
}
