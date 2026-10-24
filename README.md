# Desk

김현도의 글, 논문 노트, 독서 노트를 A4 보고서처럼 놓아두는 사이트.
[Astro](https://astro.build)로 만들고 GitHub Pages로 올립니다. 주소: https://hyeondo1209.github.io

---

## 1. 내 컴퓨터에서 미리보기

PowerShell에서 (`desk` 폴더 안에서):

```powershell
cd ~\desk
npm install      # 처음 한 번만
npm run dev      # 미리보기 시작
```

브라우저에서 http://localhost:4321 을 열면 사이트가 보입니다. 파일을 고치고 저장하면 바로 반영됩니다. 끝낼 때는 PowerShell에서 `Ctrl + C`.

---

## 2. 글 쓰기

`src/content/notes/` 에 `.md` 파일을 하나 만듭니다. **파일 이름이 주소가 됩니다.** 영어 소문자와 `-` 로 지으세요.

`src/content/notes/grgic-pyrrhonism.md` → `https://hyeondo1209.github.io/notes/grgic-pyrrhonism/`

```markdown
---
title: 그르기치의 퓌론주의 읽기
date: 2026-10-24
type: paper
tags: [철학]
---

여기부터 본문.
```

### 맨 위 칸에 쓰는 것

| 항목 | 필수 | 설명 |
|---|---|---|
| `title` | ✓ | 제목 |
| `date` | ✓ | `2026-10-24` 형식. 첫 장 오른쪽 위에 찍히고, 오래될수록 종이가 바랩니다 |
| `type` | ✓ | `essay` · `paper` · `reading` · `photo` · `project` 중 하나 (지금은 화면에 영향 없음) |
| `tags` |  | 인덱스(포스트잇). 예: `[철학, 독서]` |
| `cover` |  | 사진 글의 대표 사진. 예: `./cover.jpg` |
| `lang` |  | 영어 글이면 `en` |
| `draft` |  | `true` 면 사이트에 안 보입니다(쓰는 중) |

### 본문에서 쓰는 것

| 쓰는 법 | 보이는 모습 | 언제 |
|---|---|---|
| `## 제목` | 굵은 검정 | 큰 제목 |
| `### 소제목` | 밑줄 | 소제목 |
| `==문장==` | 노란 형광펜 | 읽은 것(인용, 남의 글)에서 건진 곳 |
| `**문장**` | 빨간 펜 밑줄 | 내 글에서 내 주장, 결론 |
| `> 문장` | 들여쓴 인용 | 인용 |
| `[^1]` / `[^1]: 내용` | `[1]` 각주 | 출처, 덧붙임 |
| `$x^2$`, `$$ ... $$` | 수식 | |
| `[글자](주소)` | 파란 링크 | |
| `![](./사진.jpg)` | 그림 | 사진은 글 파일과 같은 폴더에 |

글이 길면 화면에서 자동으로 A4 여러 장으로 나뉘고, 두 장 이상이면 호치키스가 박힙니다.

사진이 있는 글은 폴더로 만드세요: `src/content/notes/gwangju/index.md` + 사진 파일들.

---

## 3. 사이트에 올리기

```powershell
cd ~\desk
git add .
git commit -m "그르기치 글 추가"
git push
```

1~2분 뒤 사이트에 반영됩니다. 진행 상황은 GitHub 저장소의 **Actions** 탭에서 볼 수 있어요.

---

## 4. 고치고 싶을 때

| 무엇을 | 어디서 |
|---|---|
| 사이트 이름, 소개 | `src/site.config.ts` |
| 인덱스 색 | `src/site.config.ts` 의 `FLAG_COLORS` |
| 색, 글꼴, 간격 | `src/styles/global.css` 맨 위 `:root` |
| A4 나누기, 호치키스 조건 | `src/scripts/paginate.ts` |

`example-` 로 시작하는 파일과 폴더는 예시입니다. 내 글을 넣고 나면 지워 주세요.

---

## 글꼴 라이선스

- 윈도우에서는 컴퓨터에 설치된 굴림체를 씁니다(사이트에 포함하지 않음).
- 굴림체가 없는 기기에서는 백묵 굴림(한글)과 나눔고딕코딩(영문, 숫자)을 씁니다. 각각의 라이선스는 `public/fonts/` 에 있습니다.
- Baekmuk Batang, Baekmuk Dotum, Baekmuk Gulim, and Baekmuk Headline are registered trademarks owned by Kim Jeong-Hwan.
