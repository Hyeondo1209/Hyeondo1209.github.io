// ─────────────────────────────────────────────────────────────
// 올리기: 원고 폴더의 Word 파일 → 사이트 글 → 미리보기 → 확인 → GitHub에 올림
// desk 폴더의 "올리기.cmd" 를 더블클릭하면 이 파일이 실행됩니다.
// ─────────────────────────────────────────────────────────────
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { convertDocx, toNoteFile, slugify } from './word.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = path.join(ROOT, '원고');
const NOTES = path.join(ROOT, 'src', 'content', 'notes');
const PORT = 4322; // 미리보기 전용 (npm run dev 의 4321 과 겹치지 않게)
const isWin = process.platform === 'win32';

const say = (s = '') => console.log(s);
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
function servePreview(dir, port) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      let file = path.join(dir, path.normalize(p));
      if (!file.startsWith(dir)) file = path.join(dir, '404.html');
      if (!path.extname(file) && existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
      let status = 200;
      if (!existsSync(file) || !statSync(file).isFile()) { file = path.join(dir, '404.html'); status = 404; }
      try {
        const body = await readFile(file);
        res.writeHead(status, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
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
      const conv = await convertDocx(buf, { fileName: file });
      const prev = map.get(file);
      let slug = conv.meta.slug || prev?.slug || slugify(file.replace(/\.docx$/i, ''));
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
      if (conv.meta.draft) {
        // 초안은 파일을 만들지 않음 (공개 저장소에 올라가지 않도록). 이미 올렸던 글이면 내림.
        const was = existsSync(dir);
        if (was) await rm(dir, { recursive: true, force: true });
        Object.assign(r, { slug, title: conv.title, draft: true, unpublished: was, warnings: [...r.warnings, ...conv.warnings], subtitle: conv.subtitle });
        results.push(r);
        continue;
      }
      const date = conv.meta.date || prev?.date || today();
      const target = path.join(dir, 'index.md');
      const content = toNoteFile(conv, { date, docxName: file });
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
      });
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

async function main() {
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

  const { results, orphans } = out;

  // 사이트에 올라간 것(git)과 비교해서 새 글 / 고침 / 그대로 를 정함
  const st = git(['status', '--porcelain', '--untracked-files=all', '--', 'src/content/notes']);
  const changedPaths = (st.stdout || '').split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2), file: l.slice(3).replace(/^"|"$/g, '') }));
  for (const r of results) {
    if (!r.slug || r.draft) continue;
    const mine = changedPaths.filter((c) => c.file.startsWith(`src/content/notes/${r.slug}/`));
    if (!mine.length) r.status = '그대로';
    else if (mine.some((c) => c.file.endsWith('/index.md') && c.code.includes('?'))) r.status = '새 글';
    else r.status = '고침';
  }

  for (const r of results) {
    if (r.status === '실패') {
      say(`✗ ${r.file}`);
      say(`    변환하지 못했어요: ${r.error}`);
      continue;
    }
    const mark = r.draft ? (r.unpublished ? '초안: 사이트에서 내림' : '초안: 안 올라감') : r.status;
    say(`· [${mark}] ${r.title}`);
    say(`    ${r.file} → /notes/${r.slug}/`);
    for (const w of r.warnings) say(`    ! ${w}`);
    if (r.subtitle?.some((s) => /\b\d{8}\b/.test(s))) say('    ! 부제 줄에 학번처럼 보이는 숫자가 있어요. 공개해도 괜찮은지 확인하세요.');
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
  if (!status.stdout.trim()) {
    say('사이트에 올릴 바뀐 내용이 없어요.');
    return;
  }

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
  const astro = path.join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');
  await rm(path.join(ROOT, '.astro'), { recursive: true, force: true });
  await rm(path.join(ROOT, 'node_modules', '.astro'), { recursive: true, force: true });
  const build = spawnSync(process.execPath, [astro, 'build'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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
  const local = `http://127.0.0.1:${PORT}`;
  const previewUrl = local + (changed ? `/notes/${changed.slug}/` : '/');
  const server = await servePreview(path.join(ROOT, 'dist'), PORT);
  if (server) {
    openInBrowser(previewUrl);
    say(`브라우저에서 미리보기를 확인하세요: ${previewUrl}`);
  } else {
    say(`미리보기 창을 열지 못했어요(${PORT}번 자리가 이미 쓰이는 중). 사이트는 문제없이 만들어졌으니 올려도 괜찮아요.`);
  }
  say();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('이대로 사이트에 올릴까요? (y/n) ')).trim().toLowerCase();
  rl.close();
  server?.close();

  if (answer !== 'y' && answer !== 'ㅛ') {
    await revert();
    say();
    say('올리지 않았어요. 사이트 파일도 원래대로 돌려놨어요.');
    say('원고를 고친 뒤 올리기를 다시 실행하세요.');
    return;
  }

  const titles = results.filter((r) => r.status === '새 글' || r.status === '고침').map((r) => r.title);
  const msg = titles.length ? `글: ${titles.join(', ')}` : '사이트 수정';
  say();
  git(['add', '-A'], { stdio: 'inherit' });
  const c = git(['commit', '-m', msg], { stdio: 'inherit' });
  if (c.status !== 0) {
    say('커밋하지 못했어요. 위의 메시지를 확인하세요.');
    return;
  }
  const p = git(['push'], { stdio: 'inherit' });
  if (p.status !== 0) {
    say();
    say('GitHub에 올리지 못했어요. 인터넷 연결이나 로그인을 확인하고 올리기를 다시 실행하세요.');
    return;
  }
  say();
  line();
  say('올렸어요. 1~2분 뒤 사이트에 반영돼요.');
  const url = await siteUrl();
  if (url && changed) say(`${url}/notes/${changed.slug}/`);
}

main().catch((e) => {
  say();
  say('문제가 생겼어요: ' + (e?.message || e));
});
