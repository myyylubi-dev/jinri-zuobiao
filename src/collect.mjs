// collect.mjs — 按源抓取并归一化成 items[]
// 任何一个源失败都只记录健康度，不阻断整次生成。

import { getText, parseFeed, extractLinks, toISODate, stripTags, clip, beijingToday, sleep } from './lib.mjs';
import { activeSources } from './sources.mjs';

const MAX_PER_SOURCE = 40;

/** 硬截止：无论 fetch 卡在哪一步，到点就放弃这个源 */
function withDeadline(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`硬超时 ${(ms / 1000).toFixed(0)}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function norm(src, raw) {
  const title = stripTags(raw.title || '').trim();
  if (!title || title.length < 4) return null;
  const url = (raw.url || raw.link || '').trim();
  if (!/^https?:\/\//.test(url)) return null;
  return {
    key: `${src.id}:${url}`,
    sourceId: src.id,
    sourceName: src.name,
    short: src.short || src.name,
    region: src.region,
    kind: src.kind,
    weight: src.weight,
    title,
    url,
    date: raw.date || beijingToday(),
    summary: clip(stripTags(raw.summary || ''), 220),
    categories: raw.categories || [],
  };
}

/* ------------------------------------------------------------------ 适配器 */

const adapters = {
  async 'gov-zuixin'(src) {
    const r = await getText(src.url, { timeout: 22000, retries: 2 });
    const arr = JSON.parse(r.text);
    if (!Array.isArray(arr)) throw new Error('返回结构不是数组');
    // 按发布日期倒序，保证截断时留下的是最新的
    arr.sort((a, b) => String(b.DOCRELPUBTIME || '').localeCompare(String(a.DOCRELPUBTIME || '')));
    return arr.slice(0, 400).map((x) =>
      norm(src, {
        title: x.TITLE,
        url: x.URL,
        date: toISODate(x.DOCRELPUBTIME),
        summary: x.SUB_TITLE || '',
      })
    );
  },

  async 'gov-push'(src) {
    const r = await getText(src.url, { timeout: 22000, retries: 2 });
    const arr = JSON.parse(r.text);
    if (!Array.isArray(arr)) throw new Error('返回结构不是数组');
    return arr.map((x) =>
      norm(src, { title: x.title, url: x.link, date: toISODate(x.pubDate), summary: x.description || '' })
    );
  },

  async rss(src) {
    const r = await getText(src.url, { timeout: 20000, retries: 2 });
    const rows = parseFeed(r.text);
    if (!rows.length) throw new Error('Feed 解析出 0 条');
    return rows.map((x) => norm(src, x));
  },

  async 'html-links'(src) {
    const r = await getText(src.url, { timeout: 20000, retries: 1 });
    const links = extractLinks(r.text, src.home);
    const seen = new Set();
    const out = [];
    for (const l of links) {
      if (!src.filter.test(l.href)) continue;
      if (seen.has(l.href)) continue;
      if (l.text.length < 8 || l.text.length > 64) continue;
      seen.add(l.href);
      const dm = l.href.match(/(20\d{2})[_-](\d{1,2})[_-](\d{1,2})/);
      const date = dm ? `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}` : beijingToday();
      out.push(norm(src, { title: l.text, url: l.href, date }));
      if (out.length >= MAX_PER_SOURCE) break;
    }
    if (!out.length) throw new Error('页面里没有匹配到文章链接');
    return out;
  },
};

/* --------------------------------------------------------------------- 主流程 */

export async function collect({ mode = 'local', concurrency = 5, onLog = () => {} } = {}) {
  const sources = activeSources(mode);
  const items = [];
  const health = [];
  let cursor = 0;

  async function worker() {
    while (cursor < sources.length) {
      const src = sources[cursor++];
      const t0 = Date.now();
      try {
        const adapter = adapters[src.adapter];
        if (!adapter) throw new Error(`未知适配器 ${src.adapter}`);
        const cap = src.adapter === 'html-links' ? 30 : MAX_PER_SOURCE;
        const rows = (await withDeadline(adapter(src), 30000, src.id)).filter(Boolean).slice(0, cap);
        items.push(...rows);
        const h = { id: src.id, name: src.name, region: src.region, kind: src.kind, ok: true, count: rows.length, ms: Date.now() - t0 };
        health.push(h);
        onLog(`  ✓ ${src.short.padEnd(10)} ${String(rows.length).padStart(3)} 条  ${h.ms}ms`);
      } catch (e) {
        const h = { id: src.id, name: src.name, region: src.region, kind: src.kind, ok: false, count: 0, ms: Date.now() - t0, error: String(e.message || e).slice(0, 120) };
        health.push(h);
        onLog(`  ✗ ${src.short.padEnd(10)} 失败       ${h.error}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  health.sort((a, b) => (a.region === b.region ? a.id.localeCompare(b.id) : a.region === 'cn' ? -1 : 1));
  return { items, health, mode };
}
