// lib.mjs — 零依赖工具层：HTTP 抓取、编码解码、RSS/Atom 解析、HTML 文本抽取
// 设计原则：不引第三方包，保证在 Android PRoot / GitHub Actions 里 `node src/build.mjs` 直接能跑。

export const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// PRoot / 部分移动网络的 IPv6 出口是坏的：优先 IPv4，否则 huanqiu、zaobao 这类有 AAAA 的站点会挂死在 connect。
import dns from 'node:dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* 老版本 Node 忽略 */
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 网络 */

export async function getText(url, opts = {}) {
  const { timeout = 20000, retries = 1, headers = {}, encoding = null } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('timeout')), timeout);
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: '*/*',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...headers,
        },
        signal: ac.signal,
        redirect: 'follow',
      });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}`);
        e.status = res.status;
        throw e;
      }
      return {
        url: res.url,
        status: res.status,
        text: decodeBuffer(buf, res.headers.get('content-type') || '', encoding),
        bytes: buf.length,
        ms: Date.now() - t0,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(600 + attempt * 900);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function getJSON(url, opts = {}) {
  const r = await getText(url, { headers: { accept: 'application/json,text/plain,*/*' }, ...opts });
  try {
    return { ...r, json: JSON.parse(r.text) };
  } catch (e) {
    throw new Error(`响应不是 JSON: ${r.text.slice(0, 80)}`);
  }
}

function decodeBuffer(buf, contentType, forced) {
  let enc = forced || (contentType.match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!enc) {
    const head = buf.subarray(0, 4096).toString('latin1');
    enc = (head.match(/charset=["']?([\w-]+)/i) || [])[1];
  }
  enc = String(enc || 'utf-8').toLowerCase();
  try {
    if (/^gb(2312|k|18030)$/.test(enc)) return new TextDecoder('gb18030').decode(buf);
    return new TextDecoder('utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/* ------------------------------------------------------------------ 文本 */

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–',
  hellip: '…', middot: '·', bull: '•', times: '×', rarr: '→', laquo: '«', raquo: '»',
};

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m));
}

const safeChar = (cp) => {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
};

export function unwrapCdata(s = '') {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

export function stripTags(s = '') {
  return decodeEntities(
    unwrapCdata(String(s))
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function clip(s, n) {
  s = String(s || '').trim();
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/* ------------------------------------------------------------- RSS / Atom */

function pick(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? unwrapCdata(m[1]).trim() : '';
}

export function parseFeed(xml) {
  const blocks = [...String(xml).matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const out = [];
  for (const b of blocks) {
    const title = stripTags(pick(b, 'title'));
    let link = '';
    const atomLink = b.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
    if (atomLink) link = atomLink[1];
    if (!link) link = stripTags(pick(b, 'link')) || pick(b, 'guid');
    if (!/^https?:/i.test(link)) {
      const guid = b.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i);
      if (guid && /^https?:/i.test(unwrapCdata(guid[1]).trim())) link = unwrapCdata(guid[1]).trim();
    }
    const rawDate =
      pick(b, 'pubDate') || pick(b, 'published') || pick(b, 'updated') || pick(b, 'dc:date') || pick(b, 'date');
    const summary = stripTags(
      pick(b, 'description') || pick(b, 'summary') || pick(b, 'content:encoded') || pick(b, 'content')
    );
    const cats = [...b.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
      .map((m) => stripTags(m[1]))
      .filter(Boolean);
    if (title && link) out.push({ title, link, date: toISODate(rawDate), summary, categories: cats });
  }
  return out;
}

export function toISODate(input) {
  if (!input) return '';
  if (typeof input === 'number') return new Date(input).toISOString().slice(0, 10);
  const s = String(input).trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m = s.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return '';
}

/* ---------------------------------------------------------------- HTML */

export function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = stripTags(m[2]);
    if (!text || text.length < 6) continue;
    let href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript')) continue;
    try {
      href = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    out.push({ href, text });
  }
  return out;
}

/** 从政策详情页抓 发文字号 / 成文日期 / 施行日期 */
export function parsePolicyMeta(html) {
  const flat = html.replace(/\s+/g, ' ');
  const grab = (label) => {
    const re = new RegExp(`${label}[：:]?\\s*(?:</b>)?\\s*</td>\\s*<td[^>]*>\\s*([^<]{2,60})`, 'i');
    const m = flat.match(re);
    return m ? stripTags(m[1]) : '';
  };
  const body = stripTags(flat);
  const eff = body.match(/自\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日起(?:施行|实施|生效)/);
  return {
    docNumber: grab('发文字号'),
    signedAt: grab('成文日期'),
    releasedAt: grab('发布日期'),
    effectiveAt: eff ? `${eff[1]}-${String(eff[2]).padStart(2, '0')}-${String(eff[3]).padStart(2, '0')}` : '',
    body,
  };
}

/* ---------------------------------------------------------------- 时间 */

/** 北京时间（UTC+8）的今天，ISO 日期 */
export function beijingToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const weekdayCN = (iso) => WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];
