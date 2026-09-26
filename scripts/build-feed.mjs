// sources.json의 각 소스를 한 번씩 읽어 feed.json 하나를 만든다.
// 앱은 feed.json만 읽으므로 사용자 수와 상관없이 원본 사이트에는 실행마다 한 번 요청한다.
//
// 사용법: node scripts/build-feed.mjs --out public/feed.json [--previous <url-or-path>]
//   --previous  마지막으로 배포한 feed.json이다. 소스 요청이 실패하면 이전 항목을 유지한다.
// 종료 코드 0이면 항상 파일을 쓴다. GITHUB_OUTPUT에는 changed=true|false를 기록한다.

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const USER_AGENT = 'PetitAronaFeed/1.0 (+https://github.com/neruu00/Feed)';
const ITEMS_PER_SOURCE = 20;
const TIMEOUT_MS = 20_000;

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const outPath = args.out ?? 'public/feed.json';

async function get(url, accept) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// --- 소스 ------------------------------------------------------------------

async function nexonForum(src) {
  const q = new URLSearchParams({
    alias: src.alias,
    pageNo: '1',
    paginationType: 'PAGING',
    pageSize: String(ITEMS_PER_SOURCE),
    blockSize: '5',
    hideType: 'WEB',
  });
  const res = await get(`https://forum.nexon.com/api/v1/board/${src.board}/threads?${q}`, 'application/json');
  const body = await res.json();
  if (!Array.isArray(body.threads)) throw new Error(`unexpected response: ${JSON.stringify(body).slice(0, 200)}`);
  return body.threads
    .filter((t) => !t.isDelete && t.release === 'ON' && !t.isWebHide)
    .map((t) => ({
      id: `${src.id}:${t.threadId}`,
      source: src.id,
      title: t.title,
      url: `https://forum.nexon.com/${src.alias}/board_view?thread=${t.threadId}`,
      publishedAt: new Date(t.createDate * 1000).toISOString(),
      thumbnail: t.thumbnailImageUrl || null,
    }));
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : (XML_ENTITIES[e] ?? m),
  );
const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];
const attr = (xml, name, a) => xml.match(new RegExp(`<${name}[^>]*\\s${a}="([^"]*)"`))?.[1];

async function youtube(src) {
  const res = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${src.channelId}`, 'application/atom+xml');
  const xml = await res.text();
  const entries = xml.split('<entry>').slice(1);
  if (entries.length === 0 && !xml.includes('<feed')) throw new Error('not an Atom feed');
  return entries.slice(0, ITEMS_PER_SOURCE).map((e) => {
    const videoId = tag(e, 'yt:videoId');
    return {
      id: `${src.id}:${videoId}`,
      source: src.id,
      title: decodeXml(tag(e, 'title') ?? ''),
      url: attr(e, 'link', 'href') ?? `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: new Date(tag(e, 'published')).toISOString(),
      thumbnail: attr(e, 'media:thumbnail', 'url') ?? null,
    };
  });
}

const FETCHERS = { 'nexon-forum': nexonForum, youtube };

// --- 메인 ------------------------------------------------------------------

async function loadPrevious(ref) {
  if (!ref) return null;
  try {
    const text = /^https?:/.test(ref) ? await (await get(ref, 'application/json')).text() : await readFile(ref, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    console.warn(`previous feed unavailable (${e.message}); starting fresh`);
    return null;
  }
}

// generatedAt/checkedAt은 실행할 때마다 바뀌므로 앱에 필요한 값만 비교한다.
const essence = (feed) => JSON.stringify({ items: feed?.items ?? [], sources: (feed?.sources ?? []).map(({ id, name, ok }) => ({ id, name, ok })) });

const sources = JSON.parse(await readFile(new URL('../sources.json', import.meta.url), 'utf8'));
const previous = await loadPrevious(args.previous);
const now = new Date().toISOString();

const results = await Promise.all(
  sources.map(async (src) => {
    const fetcher = FETCHERS[src.type];
    try {
      if (!fetcher) throw new Error(`unknown source type "${src.type}"`);
      const items = (await fetcher(src))
        .filter((i) => i.title && !Number.isNaN(Date.parse(i.publishedAt)))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .slice(0, ITEMS_PER_SOURCE);
      console.log(`ok   ${src.id}: ${items.length} items`);
      return { meta: { id: src.id, name: src.name, ok: true, checkedAt: now }, items };
    } catch (e) {
      console.error(`FAIL ${src.id}: ${e.message}`);
      const kept = (previous?.items ?? []).filter((i) => i.source === src.id);
      return { meta: { id: src.id, name: src.name, ok: false, checkedAt: now, error: e.message }, items: kept };
    }
  }),
);

const feed = {
  version: 1,
  generatedAt: now,
  sources: results.map((r) => r.meta),
  items: results.flatMap((r) => r.items).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(feed, null, 2) + '\n');
const changed = essence(feed) !== essence(previous);
console.log(`wrote ${outPath} (${feed.items.length} items, changed=${changed})`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
