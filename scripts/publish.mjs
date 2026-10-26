// ─────────────────────────────────────────────────────────────
// 올리기: 원고 폴더의 Word 파일 → 사이트 글 → 미리보기 → 확인 → GitHub에 올림
// desk 폴더의 "올리기.cmd" 를 더블클릭하면 이 파일이 실행됩니다.
// ─────────────────────────────────────────────────────────────
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { convertDocx, toNoteFile, slugify } from './word.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = path.join(ROOT, '원고');
const NOTES = path.join(ROOT, 'src', 'content', 'notes');
const MARKS = path.join(INBOX, '.표시'); // 웹에서 한 표시와 날짜 (원고처럼 내 컴퓨터에만 둠)
const PORT = 4322; // 미리보기 전용 (npm run dev 의 4321 과 겹치지 않게)
const isWin = process.platform === 'win32';

let sayHook = null; // 올리는 중에는 브라우저 미리보기에도 같은 내용을 보여줌
// 검은 창에 나온 내용을 파일에도 남김 (문제가 생기면 Claude가 직접 읽을 수 있게. git에는 안 올라감)
const LOG = path.join(ROOT, '사이트 만들기 기록.txt');
const logLine = (s) => {
  try {
    appendFileSync(LOG, s + '\n');
  } catch {}
};
const say = (s = '') => {
  console.log(s);
  logLine(s);
  sayHook?.(s);
};
const line = () => say('─'.repeat(48));

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function git(args, opts = {}) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts });
}
function openInBrowser(url) {
  const c = isWin
    ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
  c.on('error', () => {});
  c.unref();
}
// 미리보기: 만들어진 dist 폴더를 이 창 안에서 바로 보여주는 작은 서버
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const EDITOR_FILES = { '/__desk/desk-editor.js': 'desk-editor.js', '/__desk/marks-match.mjs': 'marks-match.mjs' };
function servePreview(dir, port, api) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://x');
      let p = decodeURIComponent(u.pathname);
      // 표시하기 도구 (미리보기에서만)
      if (EDITOR_FILES[p]) {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(await readFile(path.join(ROOT, 'scripts', EDITOR_FILES[p])));
      }
      if (p === '/__desk/status') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(JSON.stringify(api.status()));
      }
      if (p === '/__desk/decide' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        let ok = false;
        try {
          ok = api.decide(JSON.parse(body).answer === 'y' ? 'y' : 'n');
        } catch {}
        res.writeHead(ok ? 200 : 409, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok }));
      }
      if (p === '/__desk/settings' && req.method === 'POST') {
        // 보기 설정 (첫 화면 종이 크기, 제목 정렬, 첫 화면 인덱스) → src/settings.json
        let body = '';
        for await (const chunk of req) body += chunk;
        let ok = false;
        try {
          const d = JSON.parse(body);
          const file = path.join(ROOT, 'src', 'settings.json');
          const cur = JSON.parse(await readFile(file, 'utf8'));
          const v = Number(d.coverScale);
          if (v >= 0.3 && v <= 1) cur.coverScale = Math.round(v * 100) / 100;
          if (['left', 'center'].includes(d.titleAlign)) cur.titleAlign = d.titleAlign;
          if (['small', 'big', 'none'].includes(d.coverFlags)) cur.coverFlags = d.coverFlags;
          await writeFile(file, JSON.stringify(cur, null, 2) + '\n', 'utf8');
          ok = true;
        } catch {}
        res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok }));
      }
      if (p === '/__desk/meta' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        let out = { ok: false, error: '저장하지 못했어요.' };
        try {
          const d = JSON.parse(body);
          const data = {};
          for (const k of ['title', 'slug', 'date', 'tags']) if (k in d) data[k] = d[k];
          out = await api.meta(String(d.docx), data);
        } catch {}
        res.writeHead(out.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(out));
      }
      if (p === '/__desk/visibility' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        let ok = false;
        try {
          const d = JSON.parse(body);
          ok = await api.visibility(String(d.docx), String(d.value));
        } catch {}
        res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok }));
      }
      if (p === '/__desk/marks') {
        const slug = u.searchParams.get('slug') || '';
        res.setHeader('cache-control', 'no-store');
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += chunk;
          let ok = false;
          try {
            ok = await api.save(slug, JSON.parse(body));
          } catch {}
          res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok }));
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(await api.get(slug)));
      }
      if (p.endsWith('/')) p += 'index.html';
      let file = path.join(dir, path.normalize(p));
      if (!file.startsWith(dir)) file = path.join(dir, '404.html');
      if (!path.extname(file) && existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
      let status = 200;
      if (!existsSync(file) || !statSync(file).isFile()) { file = path.join(dir, '404.html'); status = 404; }
      try {
        let body = await readFile(file);
        const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
        if (type.startsWith('text/html')) {
          body = body.toString('utf8').replace('</body>', '<script type="module" src="/__desk/desk-editor.js"></script></body>');
        }
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    });
    server.on('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function siteUrl() {
  const cfg = await readFile(path.join(ROOT, 'astro.config.mjs'), 'utf8');
  return (cfg.match(/^\s*site:\s*'([^']+)'/m) || [])[1] || '';
}

/** 이미 사이트에 있는 글들: Word 원고 이름 → { slug, date } */
async function existingNotes() {
  const map = new Map();
  const slugs = new Set();
  if (!existsSync(NOTES)) return { map, slugs };
  for (const ent of await readdir(NOTES, { withFileTypes: true })) {
    const name = ent.name.replace(/\.md$/, '');
    slugs.add(name);
    const file = ent.isDirectory() ? path.join(NOTES, ent.name, 'index.md') : path.join(NOTES, ent.name);
    if (!existsSync(file)) continue;
    const text = await readFile(file, 'utf8');
    const docx = (text.match(/^docx:\s*"(.*)"\s*$/m) || [])[1];
    const date = (text.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m) || [])[1];
    if (docx) map.set(JSON.parse(`"${docx}"`), { slug: name, date });
  }
  return { map, slugs };
}

/** 웹에서 한 표시: { date, marks: [{ id, type, quote, prefix, suffix }] } */
async function loadMarks(docx) {
  try {
    return JSON.parse(await readFile(path.join(MARKS, docx + '.json'), 'utf8'));
  } catch {
    return { date: null, marks: [] };
  }
}
async function saveMarks(docx, data) {
  await mkdir(MARKS, { recursive: true });
  const prev = await loadMarks(docx);
  const clean = {
    ...prev,
    visibility: prev.visibility || 'public',
    date: /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : null,
    marks: (Array.isArray(data.marks) ? data.marks : [])
      .filter((m) => m && ['hl', 'red', 'pencil', 'tape'].includes(m.type) && typeof m.quote === 'string' && m.quote.trim())
      .map((m) => ({ id: String(m.id), type: m.type, quote: m.quote, prefix: String(m.prefix || ''), suffix: String(m.suffix || '') })),
  };
  await writeFile(path.join(MARKS, docx + '.json'), JSON.stringify(clean, null, 2), 'utf8');
}

/** 미리보기에서 정한 주소·날짜·인덱스 (원고의 머리 줄보다 우선) */
async function saveMeta(docx, data) {
  await mkdir(MARKS, { recursive: true });
  const cur = await loadMarks(docx);
  if ('slug' in data) cur.slug = data.slug ? slugify(String(data.slug)) : null;
  if ('title' in data) cur.title = String(data.title || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  if ('date' in data) cur.date = /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : null;
  if ('tags' in data) {
    cur.tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : null;
  }
  await writeFile(path.join(MARKS, docx + '.json'), JSON.stringify(cur, null, 2), 'utf8');
}

/** 올리기 전에 볼 것: 공개되면 곤란할 수 있는 것들 */
function checksFor(r, conv, content, { isNew, dateFrom }) {
  const out = [];
  if (isNew) out.push(`처음 정하는 주소예요: /notes/${r.slug}/ — 링크를 공유한 뒤에는 바꾸지 않는 게 좋아요.`);
  if (isNew && dateFrom === 'today') out.push('날짜가 오늘로 찍혀요. 예전에 쓴 글이면 날짜를 바꾸세요.');
  const text = content.replace(/<span class="tape"[^>]*>[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ' ');
  if (/(?<![\d.-])\d{8,}(?![\d.-])/.test(text)) out.push('8자리 넘는 숫자가 있어요(학번·계좌번호?). 필요하면 수정테이프로 가리세요.');
  if (/\b\d{6}-\d{7}\b/.test(text)) out.push('주민등록번호처럼 보이는 숫자가 있어요.');
  if (/\b01[016789][- .]?\d{3,4}[- .]?\d{4}\b/.test(text)) out.push('전화번호처럼 보이는 숫자가 있어요.');
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) out.push('이메일 주소가 있어요.');
  const memos = (content.match(/class="memo memo--/g) || []).length;
  if (memos) out.push(`Word 메모 ${memos}개도 여백 메모로 공개돼요.`);
  return out;
}

/** 글 보이기: public(공개) / unlisted(목록에서 숨김, 링크로만) / hidden(사이트에서 내림) */
const VISIBILITY = ['public', 'unlisted', 'hidden'];
async function setVisibility(docx, value) {
  if (!VISIBILITY.includes(value)) return false;
  await mkdir(MARKS, { recursive: true });
  const cur = await loadMarks(docx);
  await writeFile(path.join(MARKS, docx + '.json'), JSON.stringify({ ...cur, visibility: value }, null, 2), 'utf8');
  return true;
}

async function convertAll() {
  await mkdir(INBOX, { recursive: true });
  const files = (await readdir(INBOX)).filter((f) => /\.docx$/i.test(f) && !f.startsWith('~$'));
  if (!files.length) return null;

  const { map, slugs } = await existingNotes();
  const results = [];
  const taken = new Set([...slugs].filter((s) => ![...map.values()].some((v) => v.slug === s)));

  for (const file of files.sort()) {
    const r = { file, warnings: [] };
    try {
      const buf = await readFile(path.join(INBOX, file));
      const saved = await loadMarks(file);
      const conv = await convertDocx(buf, { fileName: file, marks: saved.marks });
      const prev = map.get(file);
      if (saved.slug && conv.meta.slug && saved.slug !== conv.meta.slug) {
        conv.warnings.push(`원고의 "주소:" 줄(${conv.meta.slug}) 대신 미리보기에서 정한 주소(${saved.slug})를 써요.`);
      }
      if (Array.isArray(saved.tags)) conv.meta.tags = saved.tags;
      if (saved.title && saved.title !== conv.title) {
        conv.warnings.push(`원고의 제목 대신 미리보기에서 정한 제목을 써요: "${saved.title}"`);
        conv.title = saved.title;
        conv.titleHtml = null; // 원고 제목에 했던 표시는 새 제목에 붙지 않음
      }
      let slug = saved.slug || conv.meta.slug || prev?.slug || slugify(file.replace(/\.docx$/i, ''));
      let n = 2;
      const base = slug;
      while (taken.has(slug)) slug = `${base}-${n++}`;
      taken.add(slug);

      // 주소를 바꿨으면 예전 폴더는 지움 (이 원고에서 만들어진 것이므로 안전)
      if (prev && prev.slug !== slug && existsSync(path.join(NOTES, prev.slug))) {
        await rm(path.join(NOTES, prev.slug), { recursive: true, force: true });
        r.warnings.push(`주소가 바뀌었어요: ${prev.slug} → ${slug} (예전 주소는 없어져요)`);
        r.oldSlug = prev.slug;
      }

      const dir = path.join(NOTES, slug);
      r.visibility = saved.visibility || 'public';
      if (conv.meta.draft || r.visibility === 'hidden') {
        r.hiddenBy = conv.meta.draft ? 'word' : 'web';
        // 초안은 파일을 만들지 않음 (공개 저장소에 올라가지 않도록). 이미 올렸던 글이면 내림.
        const was = existsSync(dir);
        if (was) await rm(dir, { recursive: true, force: true });
        Object.assign(r, { slug, title: conv.title, draft: true, unpublished: was, warnings: [...r.warnings, ...conv.warnings], subtitle: conv.subtitle });
        results.push(r);
        continue;
      }
      if (saved.date && conv.meta.date && saved.date !== conv.meta.date) {
        conv.warnings.push(`원고의 "날짜:" 줄(${conv.meta.date}) 대신 미리보기에서 바꾼 날짜(${saved.date})를 써요.`);
      }
      const date = saved.date || conv.meta.date || prev?.date || today();
      const dateFrom = saved.date ? 'web' : conv.meta.date ? 'word' : prev?.date ? 'before' : 'today';
      const target = path.join(dir, 'index.md');
      const content = toNoteFile(conv, { date, docxName: file, unlisted: r.visibility === 'unlisted' });
      const before = existsSync(target) ? await readFile(target, 'utf8') : null;

      await mkdir(dir, { recursive: true });
      for (const old of await readdir(dir)) if (/^image\d+\./.test(old)) await rm(path.join(dir, old));
      for (const img of conv.images) await writeFile(path.join(dir, img.name), img.data);
      await writeFile(target, content, 'utf8');

      Object.assign(r, {
        slug,
        title: conv.title,
        draft: conv.meta.draft,
        status: before === null ? '새 글' : before === content ? '그대로' : '고침',
        warnings: [...r.warnings, ...conv.warnings],
        subtitle: conv.subtitle,
        date,
        tags: conv.meta.tags,
      });
      r.checks = checksFor(r, conv, content, { isNew: !prev, dateFrom });
    } catch (e) {
      r.status = '실패';
      r.error = e.message;
    }
    results.push(r);
  }

  const orphans = [...map.entries()].filter(([docx]) => !files.includes(docx)).map(([docx, v]) => ({ docx, slug: v.slug }));
  return { results, orphans };
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** 결과마다 새 글 / 고침 / 그대로 를 정함 (사이트에 올라간 것(git)과 비교) */
function markStatus(results) {
  const st = git(['status', '--porcelain', '--untracked-files=all', '--', 'src/content/notes']);
  const changedPaths = (st.stdout || '').split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2), file: l.slice(3).replace(/^"|"$/g, '') }));
  for (const r of results) {
    if (!r.slug || r.draft || r.status === '실패') continue;
    const mine = changedPaths.filter((c) => c.file.startsWith(`src/content/notes/${r.slug}/`));
    if (!mine.length) r.status = '그대로';
    else if (mine.some((c) => c.file.endsWith('/index.md') && c.code.includes('?'))) r.status = '새 글';
    else r.status = '고침';
  }
}

/** Word 원고와 상관없이 바뀐 것들 (직접 지운 글, 사이트 파일 등) */
function otherChanges(results) {
  const mine = new Set(results.flatMap((r) => [r.slug, r.oldSlug]).filter(Boolean)); // 주소를 바꾼 글의 예전 주소도 그 글의 일
  const st = git(['status', '--porcelain', '--untracked-files=all']).stdout || '';
  const removed = new Set();
  let files = 0;
  for (const l of st.split('\n').filter(Boolean)) {
    const file = l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop();
    const m = file.match(/^src\/content\/notes\/([^/]+?)(?:\.md$|\/)/);
    if (m && mine.has(m[1])) continue;
    if (m && l.slice(0, 2).includes('D')) removed.add(m[1]);
    else files++;
  }
  return { removed: [...removed], files };
}

const STATUS_TEXT = {
  '새 글': '새 글 — 아직 사이트에 없어요',
  고침: '고침 — 사이트에 있는 글이 바뀌어요',
  그대로: '그대로 — 이미 사이트에 있고 바뀐 것 없어요',
};

function buildSite() {
  const astro = path.join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');
  const r = spawnSync(process.execPath, [astro, 'build'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // 사이트 만들기 기록을 파일로 남김 (문제가 생기면 Claude가 직접 읽을 수 있게. git에는 안 올라감)
  logLine(['', `── 사이트 만들기 (종료 코드: ${r.status}${r.error ? ', 오류: ' + r.error.message : ''}) ──`, r.stdout || '', r.stderr || '', '── 끝 ──', ''].join('\n'));
  return r;
}

async function main() {
  try {
    writeFileSync(LOG, `올리기 시작: ${new Date().toLocaleString('ko-KR')}\n`);
  } catch {}
  say();
  say('  Desk 올리기');
  line();

  const out = await convertAll();
  if (!out) {
    say('원고 폴더가 비어 있어요.');
    say(`Word 파일을 여기에 넣고 다시 실행하세요: ${INBOX}`);
    if (isWin) spawn('explorer', [INBOX], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return;
  }

  let { results, orphans } = out;
  markStatus(results);
  const siteBase = (await siteUrl()) || '';

  for (const r of results) {
    if (r.status === '실패') {
      say(`✗ ${r.file}`);
      say(`    변환하지 못했어요: ${r.error}`);
      continue;
    }
    const why = r.hiddenBy === 'web' ? '미리보기에서 내린 글' : '초안';
    const mark = r.draft
      ? r.unpublished ? `${why}: 사이트에서 내려가요` : `${why}: 사이트에 없어요`
      : (STATUS_TEXT[r.status] || r.status) + (r.visibility === 'unlisted' ? ' (목록에서 숨김, 링크로만 열림)' : '');
    say(`· ${r.title}`);
    say(`    ${mark}`);
    say(`    원고: ${r.file}`);
    if (!r.draft) say(`    주소: ${siteBase}/notes/${r.slug}/`);
    for (const w of r.warnings) say(`    ! ${w}`);
    if (r.status === '새 글' || r.status === '고침') for (const c of r.checks || []) say(`    ? ${c}`);
  }
  for (const o of orphans) {
    say(`? 원고 폴더에 없는 글: /notes/${o.slug}/ (${o.docx})`);
    say('    사이트에서는 그대로 둬요. 내리려면 그 원고를 다시 넣고 맨 위에 "초안" 이라고 쓰세요.');
  }
  line();

  const status = git(['status', '--porcelain']);
  if (status.error) {
    say('git 을 찾지 못했어요. Git 이 설치돼 있는지 확인하세요.');
    return;
  }
  const nothingNew = !status.stdout.trim();
  if (nothingNew) say('바뀐 원고는 없어요. 미리보기에서 표시하기만 할 수 있어요.');

  // 이번에 만든 변경을 되돌려서, 다음에 다른 글을 올릴 때 같이 올라가지 않게 함
  async function revert() {
    for (const r of results) {
      if (!r.slug) continue;
      const rel = `src/content/notes/${r.slug}`;
      const tracked = git(['ls-files', '--', rel]).stdout.trim();
      if (tracked) git(['checkout', '--', rel]);
      if (r.status === '새 글') await rm(path.join(ROOT, rel), { recursive: true, force: true });
      else if (tracked) git(['clean', '-fdq', '--', rel]);
      if (r.oldSlug) git(['checkout', '--', `src/content/notes/${r.oldSlug}`]);
    }
  }

  // 미리보기: 실제 배포와 똑같이 사이트를 새로 만들어서 보여줌
  say('사이트를 만드는 중... (30초쯤 걸려요)');
  await rm(path.join(ROOT, '.astro'), { recursive: true, force: true });
  await rm(path.join(ROOT, 'node_modules', '.astro'), { recursive: true, force: true });
  const build = buildSite();
  if (build.status !== 0) {
    const log = `${build.stdout || ''}\n${build.stderr || ''}`.trim().split('\n').slice(-25).join('\n');
    say();
    say(log);
    say();
    line();
    say('사이트를 만들다가 문제가 생겨서 올리지 않았어요. 사이트 파일도 원래대로 돌려놨어요.');
    say('위의 메시지를 캡처해서 Claude에게 보여주세요.');
    await revert();
    return;
  }

  const changed = results.find((r) => !r.draft && (r.status === '새 글' || r.status === '고침'));
  const previewPath = changed ? `/notes/${changed.slug}/` : '/';
  let marksDirty = false; // 다시 변환해야 함 (표시, 날짜, 보이기 중 하나라도 바뀜)
  let marksEdited = false; // 표시·날짜가 바뀜
  const bySlug = new Map(results.filter((r) => r.slug && !r.draft && r.status !== '실패').map((r) => [r.slug, r.file]));

  // 브라우저 미리보기에서 "올리기 / 올리지 않기" 를 고를 수 있게
  const web = { phase: 'waiting', log: [], url: '' };
  const visStart = new Map(); // 이번에 보이기를 바꾼 원고 → 바꾸기 전 값 (올리지 않으면 되돌림)
  const visNow = new Map();
  const VIS_TEXT = { public: '다시 공개', unlisted: '목록에서 숨김', hidden: '사이트에서 내림' };
  const metaNow = new Map(); // 이번에 미리보기에서 바꾼 주소·날짜·인덱스
  const metaStart = new Map(); // 바꾸기 전 값 (올리지 않으면 되돌림)
  let decideFromWeb;
  const fromWeb = new Promise((resolve) => (decideFromWeb = resolve));
  const api = {
    async get(slug) {
      const docx = bySlug.get(slug);
      if (!docx) return { editable: false, reason: '이 글은 Word 원고로<br>만든 글이 아니라서<br>표시할 수 없어요.' };
      const r = results.find((x) => x.file === docx);
      const saved = await loadMarks(docx);
      return {
        editable: web.phase === 'waiting',
        docx,
        ...saved,
        visibility: visNow.get(docx) || r?.visibility || 'public',
        meta: { title: saved.title || r?.title, slug: saved.slug || r?.slug, date: saved.date || r?.date, tags: Array.isArray(saved.tags) ? saved.tags : r?.tags || [] },
      };
    },
    async meta(docx, data) {
      const r = results.find((x) => x.file === docx);
      if (!r || web.phase !== 'waiting') return { ok: false, error: '지금은 바꿀 수 없어요.' };
      if ('title' in data && !String(data.title || '').trim()) data.title = null; // 비우면 원고 제목으로
      if ('slug' in data) {
        const want = slugify(String(data.slug || ''));
        if (!want || want === 'untitled') return { ok: false, error: '주소는 영문 소문자, 숫자, - 로 써주세요.' };
        if (results.some((x) => x !== r && x.slug === want)) return { ok: false, error: '다른 글이 이미 쓰는 주소예요.' };
        data.slug = want;
      }
      if (!metaStart.has(docx)) {
        const before = await loadMarks(docx);
        metaStart.set(docx, { title: before.title ?? null, slug: before.slug ?? null, date: before.date ?? null, tags: before.tags ?? null });
      }
      await saveMeta(docx, data);
      metaNow.set(docx, { ...(metaNow.get(docx) || {}), ...data });
      marksDirty = true;
      return { ok: true, slug: data.slug };
    },
    async visibility(docx, value) {
      const r = results.find((x) => x.file === docx);
      if (!r || web.phase !== 'waiting') return false;
      if (!visStart.has(docx)) visStart.set(docx, r.visibility || 'public');
      if (!(await setVisibility(docx, value))) return false;
      visNow.set(docx, value);
      marksDirty = true;
      return true;
    },
    notes() {
      return results
        .filter((r) => r.slug && r.status !== '실패')
        .map((r) => ({
          docx: r.file,
          title: r.title,
          url: `/notes/${r.slug}/`,
          visibility: visNow.get(r.file) || r.visibility || 'public',
          word: r.hiddenBy === 'word',
        }));
    },
    async save(slug, data) {
      const docx = bySlug.get(slug);
      if (!docx || web.phase !== 'waiting') return false;
      await saveMarks(docx, data);
      marksDirty = true;
      marksEdited = true;
      return true;
    },
    status() {
      const changes = results
        .filter((r) => r.draft ? r.unpublished : r.status === '새 글' || r.status === '고침')
        .map((r) => ({ kind: r.draft ? '내림' : r.status, title: r.title, url: r.draft ? '' : `/notes/${r.slug}/`, checks: r.draft ? [] : r.checks || [] }));
      for (const [docx, m] of metaNow) {
        const r = results.find((x) => x.file === docx);
        const what = ['title' in m ? '제목' : '', m.slug && r?.slug !== m.slug ? `주소 → /notes/${m.slug}/` : '', 'date' in m ? '날짜' : '', 'tags' in m ? '인덱스' : ''].filter(Boolean).join(', ');
        if (what) changes.push({ kind: '설정', title: `${r?.title || docx}: ${what}`, url: '' });
      }
      for (const [docx, v] of visNow) {
        if (v === visStart.get(docx)) continue;
        const r = results.find((x) => x.file === docx);
        changes.push({ kind: VIS_TEXT[v], title: r?.title || docx, url: '' });
      }
      const other = otherChanges(results);
      for (const slug of other.removed) changes.push({ kind: '지움', title: slug, url: '' });
      if (other.files) changes.push({ kind: '사이트 파일', title: `${other.files}개 바뀜`, url: '' });
      return { ...web, changes, marksDirty: marksEdited, notes: api.notes() };
    },
    decide(answer) {
      if (web.phase !== 'waiting') return false;
      decideFromWeb({ answer, web: true });
      return true;
    },
  };
  // 미리보기 자리(4322)가 이미 쓰이는 중이면(예전 검은 창이 아직 켜져 있는 등) 옆자리로
  let server = null;
  let port = PORT;
  for (; port < PORT + 10 && !server; port++) server = await servePreview(path.join(ROOT, 'dist'), port, api);
  port -= 1;
  const previewUrl = `http://127.0.0.1:${port}${previewPath}`;
  if (server) {
    openInBrowser(previewUrl);
    say(`브라우저에서 미리보기를 확인하세요: ${previewUrl}`);
    say('올릴지는 미리보기 오른쪽의 버튼으로 고르거나, 여기에 y / n 을 눌러도 돼요.');
  } else {
    say(`미리보기 창을 열지 못했어요(${PORT}~${PORT + 9}번 자리가 모두 쓰이는 중). 켜져 있는 다른 검은 창을 닫고 다시 실행해 주세요.`);
  }
  say();

  const ac = new AbortController();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const fromCmd = rl
    .question('이대로 사이트에 올릴까요? (y/n) ', { signal: ac.signal })
    .then((a) => ({ answer: a.trim().toLowerCase(), web: false }))
    .catch(() => new Promise(() => {}));
  const choice = await Promise.race([fromCmd, fromWeb]);
  ac.abort();
  rl.close();
  if (choice.web) console.log(choice.answer === 'y' ? 'y (미리보기에서 "올리기"를 눌렀어요)' : 'n (미리보기에서 "올리지 않기"를 눌렀어요)');
  logLine(`고른 것: ${choice.answer} (${choice.web ? '미리보기' : '검은 창'})`);
  const yes = choice.answer === 'y' || choice.answer === 'ㅛ';

  // 여기부터는 브라우저 미리보기에도 진행 상황을 보여줌
  web.phase = 'working';
  sayHook = (line) => web.log.push(line);
  let outcome;
  try {
    outcome = await upload(yes);
  } catch (e) {
    say('문제가 생겼어요: ' + (e?.message || e));
    outcome = 'error';
  }
  web.phase = outcome;
  sayHook = null;
  if (server) {
    await new Promise((r) => setTimeout(r, 8000)); // 브라우저가 결과를 읽어갈 시간
    server.close();
  }

  async function upload(yes) {
    if (!yes) {
      await revert();
      for (const [docx, v] of visStart) await setVisibility(docx, v); // 내리기·숨기기는 되돌림
      for (const [docx, m] of metaStart) await saveMeta(docx, m); // 주소·날짜·인덱스도 되돌림
      say();
      say('올리지 않았어요. 사이트 파일도 원래대로 돌려놨어요.');
      if (marksEdited) say('미리보기에서 한 표시는 저장해 뒀어요. 다음에 올릴 때 같이 올라가요.');
      if (visStart.size || metaStart.size) say('이번에 바꾼 제목·주소·날짜·인덱스와 숨기기·내리기는 취소했어요.');
      say('원고를 고친 뒤 올리기를 다시 실행하세요.');
      return 'cancelled';
    }

    if (marksDirty) {
      // 미리보기에서 한 표시를 사이트 파일에 반영하고, 사이트가 문제없이 만들어지는지 다시 확인
      say();
      say('표시를 반영하는 중... (30초쯤 걸려요)');
      ({ results } = await convertAll());
      markStatus(results);
      for (const r of results) for (const w of r.warnings || []) if (/붙을 곳을 잃었어요/.test(w)) say(`    ! ${r.title}: ${w}`);
      if (git(['status', '--porcelain']).stdout.trim()) {
        const b2 = buildSite();
        if (b2.status !== 0) {
          say(`${b2.stdout || ''}\n${b2.stderr || ''}`.trim().split('\n').slice(-25).join('\n'));
          line();
          say('표시를 반영하다가 문제가 생겨서 올리지 않았어요. 사이트 파일도 원래대로 돌려놨어요.');
          say('위의 메시지를 캡처해서 Claude에게 보여주세요.');
          await revert();
          return 'error';
        }
      }
    }
    if (!git(['status', '--porcelain']).stdout.trim()) {
      say();
      say('사이트에 올릴 바뀐 내용이 없어요.');
      return 'nothing';
    }

    const titles = [
      ...results.filter((r) => !r.draft && (r.status === '새 글' || r.status === '고침')).map((r) => r.title),
      ...results.filter((r) => r.draft && r.unpublished).map((r) => `${r.title}(내림)`),
      ...otherChanges(results).removed.map((slug) => `${slug}(지움)`),
    ];
    const msg = titles.length ? `글: ${titles.join(', ')}` : '사이트 수정';
    say();
    say('GitHub에 올리는 중...');
    git(['add', '-A'], { stdio: 'inherit' });
    const c = git(['commit', '-m', msg], { stdio: 'inherit' });
    if (c.status !== 0) {
      say('커밋하지 못했어요. 검은 창의 메시지를 확인하세요.');
      return 'error';
    }
    const p = git(['push'], { stdio: 'inherit' });
    if (p.status !== 0) {
      say();
      say('GitHub에 올리지 못했어요. 인터넷 연결이나 로그인을 확인하고 올리기를 다시 실행하세요.');
      return 'error';
    }
    say();
    line();
    say('올렸어요. 1~2분 뒤 사이트에 반영돼요.');
    const first = results.find((r) => !r.draft && (r.status === '새 글' || r.status === '고침'));
    web.url = siteBase + (first ? `/notes/${first.slug}/` : '/');
    say(web.url);
    return 'done';
  }
}

main().catch((e) => {
  say();
  say('문제가 생겼어요: ' + (e?.message || e));
  logLine(String(e?.stack || ''));
});
