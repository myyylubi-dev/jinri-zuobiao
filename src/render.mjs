// render.mjs — 生成自包含的移动端单页（无外部字体/脚本/图片）
// 版面：判定卡 + 概览 → 01 国务院 → 02 科技 → 03 中外合作 → 04 产业 → 05 内外共识
//       → 06 影响分析 → 07 今日总结（普通人 / 从业者双线）

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const rel = (today, iso) => {
  const d = Math.round((new Date(today) - new Date(iso)) / 86400000);
  if (d === 0) return '今天';
  if (d === 1) return '昨天';
  if (d > 1 && d < 7) return `${d} 天前`;
  const [, m, dd] = iso.split('-');
  return `${Number(m)}/${Number(dd)}`;
};

const sgn = (n) => (n > 0 ? `+${n}` : `${n}`);
const TYPE_COLOR = { 正常一天: 'normal', 可能性一天: 'poss', 前瞻性一天: 'fore' };

const itemLink = (it) => `<a class="title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`;

export function renderPage(data, { index = [] } = {}) {
  const { meta, day, overview, impact, summary, gov, tech, coop, industry, consensus, health } = data;
  const [y, m, d] = meta.date.split('-');
  const typeClass = TYPE_COLOR[day.type] || 'normal';
  const okSources = health.filter((h) => h.ok);
  const downSources = health.filter((h) => !h.ok);

  /* ---------------------------------------------------- 判定 + 概览 */
  const meter = `
    <div class="meter" role="img" aria-label="正常 ${day.dist.normal}%、可能性 ${day.dist.possibility}%、前瞻性 ${day.dist.foresight}%">
      <i class="seg seg--normal" style="width:${day.dist.normal}%"></i>
      <i class="seg seg--poss" style="width:${day.dist.possibility}%"></i>
      <i class="seg seg--fore" style="width:${day.dist.foresight}%"></i>
    </div>
    <div class="legend">
      <span><b class="dot dot--normal"></b>正常 ${day.dist.normal}%</span>
      <span><b class="dot dot--poss"></b>可能性 ${day.dist.possibility}%</span>
      <span><b class="dot dot--fore"></b>前瞻性 ${day.dist.foresight}%</span>
    </div>`;

  const overviewList = (overview || [])
    .map((o) => `<li><span class="tk">${esc(o.label)}</span><span>${esc(o.text)}</span></li>`)
    .join('');

  /* ---------------------------------------------------- 01 国务院 */
  const govItems = gov.items.length
    ? gov.items
        .map((it) => {
          const bits = [];
          if (it.docNumber) bits.push(esc(it.docNumber));
          if (it.effectiveAt) bits.push(`${esc(it.effectiveAt)} 起施行`);
          return `<article class="item">
        <div class="meta">
          <span class="chip chip--org">${esc(it.org || '官方')}</span>
          <time>${rel(meta.date, it.date)}</time>
        </div>
        ${itemLink(it)}
        ${bits.length ? `<div class="doc">${bits.join(' · ')}</div>` : ''}
        ${it.excerpt ? `<p class="excerpt">${esc(it.excerpt)}</p>` : ''}
      </article>`;
        })
        .join('')
    : '<p class="empty">今天没有新增发布。</p>';

  const govNote =
    gov.todayCount === 0 && gov.latestTitle
      ? `<p class="note">今日无新增文件${gov.newsCount ? `，政府网要闻 ${gov.newsCount} 条` : ''}。下面列出最近 ${gov.items.length} 条。</p>`
      : '';

  /* ---------------------------------------------------- 02 科技 */
  const techItems = tech.items.length
    ? tech.items
        .map(
          (it) => `<article class="item item--tight">
        <div class="meta">
          <span class="chip chip--${it.tag === '半导体' ? 'semi' : it.tag === 'AI' ? 'ai' : 'tag'}">${esc(it.tag)}</span>
          <span class="src">${esc(it.short)}</span>
          <time>${rel(meta.date, it.date)}</time>
        </div>
        ${itemLink(it)}
        ${it.summary ? `<p class="excerpt">${esc(it.summary.slice(0, 90))}</p>` : ''}
      </article>`
        )
        .join('')
    : '<p class="empty">今天没有抓到科技条目。</p>';

  /* ---------------------------------------------------- 03 中外合作 */
  const coopItems = coop.items.length
    ? coop.items
        .map((it) => {
          const who = [...(it.where || []), ...(it.firms || [])].slice(0, 3).join(' · ');
          return `<article class="item">
        <div class="meta">
          <span class="chip chip--coop">${esc(it.kind)}</span>
          ${who ? `<span class="src">${esc(who)}</span>` : ''}
          <span class="src">${esc(it.short)}</span>
          <time>${rel(meta.date, it.date)}</time>
        </div>
        ${itemLink(it)}
        ${it.summary ? `<p class="excerpt">${esc(it.summary.slice(0, 100))}</p>` : ''}
      </article>`;
        })
        .join('')
    : `<p class="empty">${esc(coop.note || '今天没有中外合作类条目。')}</p>`;

  /* ---------------------------------------------------- 04 产业与其他 */
  const indItems = industry.items.length
    ? industry.items
        .map(
          (it) => `<article class="item item--tight">
        <div class="meta">
          <span class="chip chip--ind">产业</span>
          <span class="src">${esc(it.short)}</span>
          <time>${rel(meta.date, it.date)}</time>
        </div>
        ${itemLink(it)}
        ${it.summary ? `<p class="excerpt">${esc(it.summary.slice(0, 90))}</p>` : ''}
      </article>`
        )
        .join('')
    : `<p class="empty">${esc(industry.note || '今天没有产业侧条目。')}</p>`;

  /* ---------------------------------------------------- 05 内外共识 */
  let consensusBody;
  if (consensus.topics.length) {
    consensusBody = consensus.topics
      .map(
        (t) => `<article class="item">
      <div class="meta">
        <span class="chip chip--topic">${esc(t.label)}</span>
        <span class="badge ${t.agree ? 'badge--same' : 'badge--diff'}">${t.agree ? '同调' : '温差'}</span>
        <span class="src">境内 ${t.zhCount} · 境外 ${t.enCount}</span>
      </div>
      <div class="pair">
        <div class="side"><span class="flag">中</span><div>${itemLink(t.zh)}<span class="src">${esc(t.zh.short)}</span></div></div>
        <div class="side"><span class="flag flag--intl">外</span><div>${itemLink(t.intl)}<span class="src">${esc(t.intl.short)}</span></div></div>
      </div>
      <div class="shared">共享实体：${t.shared.map((s) => `<b>${esc(s)}</b>`).join(' · ')}　语气：中 ${sgn(t.zt)} / 外 ${sgn(t.et)}</div>
    </article>`
      )
      .join('');
  } else if (consensus.cnOnly.length) {
    consensusBody = `<div class="degrade">${esc(consensus.note)}</div>${consensus.cnOnly
      .map(
        (it) => `<article class="item item--tight">
      <div class="meta"><span class="chip chip--tag">国际议题</span><span class="src">${esc(it.short)}</span><time>${rel(meta.date, it.date)}</time></div>
      ${itemLink(it)}
    </article>`
      )
      .join('')}`;
  } else {
    consensusBody = `<div class="degrade">${esc(consensus.note)}</div>`;
  }

  /* ---------------------------------------------------- 06 影响分析 */
  const impactItems = (impact || []).length
    ? impact
        .map(
          (r) => `<article class="item">
      <div class="meta">
        <span class="chip chip--aff">影响 · ${esc(r.affects)}</span>
        <span class="chip">${esc(r.horizon)}</span>
        <span class="src">${esc(r.short)}</span>
      </div>
      ${itemLink(r)}
      <p class="excerpt">${esc(r.text)}</p>
    </article>`
        )
        .join('')
    : '<p class="empty">今天没有可判定影响方向的条目。</p>';

  /* ---------------------------------------------------- 07 今日总结 */
  const track = (rows, cls, title, hint) =>
    rows && rows.length
      ? `<div class="track ${cls}">
      <div class="track-h"><span class="chip ${cls === 'track--people' ? 'chip--people' : 'chip--pro'}">${esc(title)}</span><span class="src">${esc(hint)}</span></div>
      <ul class="track-list">${rows.map((p) => `<li><b>${esc(p.label)}</b><span>${esc(p.text)}</span></li>`).join('')}</ul>
    </div>`
      : '';

  const summaryBody =
    track(summary.people, 'track--people', '普通人', '今天要不要动、离你多远') +
    track(summary.pro, 'track--pro', '从业者', '产业、对外与技术信号');

  const signals = day.signals.length
    ? day.signals
        .map(
          (s) =>
            `<li><span class="chip chip--${s.bucket === 'foresight' ? 'fore' : 'poss'}">${s.bucket === 'foresight' ? '前瞻' : '可能'}</span>${esc(s.text)}</li>`
        )
        .join('')
    : '<li>今天没有触发任何强信号。</li>';

  const upcoming = day.upcoming.length
    ? `<h3>未来 30 天的节点</h3><ul class="nodes">${day.upcoming
        .map((u) => `<li><time>${esc(u.date.slice(5))}</time><span>《${esc(u.title)}》施行</span></li>`)
        .join('')}</ul>`
    : '';

  /* ---------------------------------------------------- 页脚 */
  const healthGrid = (arr) =>
    arr
      .map(
        (h) =>
          `<span class="src-chip ${h.ok ? '' : 'src-chip--down'}" title="${esc(h.error || '')}">${esc(h.name)}<b>${h.ok ? h.count : '×'}</b></span>`
      )
      .join('');

  const arch = index
    .slice(0, 8)
    .map(
      (x) =>
        `<a class="arch-item" href="${x.date === meta.date ? './' : `d/${x.date}.html`}"><span class="arch-date">${x.date.slice(5)}</span><span class="arch-type arch-type--${TYPE_COLOR[x.type] || 'normal'}">${esc(x.type)}</span></a>`
    )
    .join('');

  const genTime = new Date(meta.generatedAt)
    .toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    .replace(/\//g, '-');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#fbfaf7">
<meta name="description" content="${esc(meta.date)} 国务院发布、科技与 AI 与半导体、中外合作、产业、内外共识、影响分析，以及普通人/从业者双线总结。">
<title>今日坐标 · ${Number(m)}月${Number(d)}日 ${meta.weekday}</title>
<style>
:root{--paper:#fbfaf7;--card:#fff;--ink:#15171b;--muted:#6d7178;--line:#e8e4dd;--soft:#f4f1ec;
--c-normal:#5b7c99;--c-poss:#b4442f;--c-fore:#9a6b16;--c-teal:#0f6b62;--c-semi:#3f5b8a;
--c-coop:#6d4b8f;--c-ind:#4a6b3c;--c-pro:#2f5d8a}
@media (prefers-color-scheme:dark){:root{--paper:#121316;--card:#191b1f;--ink:#ecebe7;--muted:#9a9ea6;--line:#2a2c31;--soft:#202227;
--c-normal:#7c9cbb;--c-poss:#e0705a;--c-fore:#cf9d3e;--c-teal:#5fb8ab;--c-semi:#8aa6d6;
--c-coop:#b18fd0;--c-ind:#8fb87a;--c-pro:#7aa8d8}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);
font:16px/1.75 -apple-system,BlinkMacSystemFont,"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:22px 16px 72px}
a{color:inherit;text-decoration:none}
.mast{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:2px solid var(--ink)}
.brand{font-size:15px;font-weight:700;letter-spacing:.18em}
.brand .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--c-poss);margin-right:8px;vertical-align:2px}
.date{text-align:right;line-height:1.1}
.date b{display:block;font-size:30px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.date span{font-size:12px;color:var(--muted);letter-spacing:.06em}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px}
.verdict{margin-top:18px;padding:20px 18px 18px;position:relative;overflow:hidden}
.verdict::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--c-normal)}
.verdict.t-poss::before{background:var(--c-poss)}
.verdict.t-fore::before{background:var(--c-fore)}
.vlabel{font-size:11px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase}
.vtype{font-size:34px;line-height:1.2;margin:6px 0 10px;font-weight:800;letter-spacing:-.01em}
.t-poss .vtype{color:var(--c-poss)}.t-fore .vtype{color:var(--c-fore)}
.vone{margin:0 0 16px;font-size:15.5px;opacity:.9}
.meter{display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--soft);gap:2px}
.seg{display:block;height:100%}
.seg--normal{background:var(--c-normal)}.seg--poss{background:var(--c-poss)}.seg--fore{background:var(--c-fore)}
.legend{display:flex;gap:14px;margin-top:8px;font-size:11.5px;color:var(--muted);flex-wrap:wrap}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;vertical-align:1px}
.dot--normal{background:var(--c-normal)}.dot--poss{background:var(--c-poss)}.dot--fore{background:var(--c-fore)}
.overview{list-style:none;margin:18px 0 0;padding:16px 0 0;border-top:1px dashed var(--line);display:grid;gap:10px}
.overview li{display:flex;gap:10px;font-size:14.5px;line-height:1.65}
.tk{flex:0 0 auto;font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px;height:fit-content;margin-top:3px;white-space:nowrap}
.tabs{display:flex;gap:8px;overflow-x:auto;margin:20px 0 6px;padding-bottom:4px;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tabs a{flex:0 0 auto;font-size:13px;padding:7px 12px;border:1px solid var(--line);border-radius:99px;color:var(--muted);background:var(--card)}
.sec{margin:30px 0 12px;display:flex;align-items:baseline;gap:10px;font-size:17px;font-weight:800}
.sec .num{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.16em;font-variant-numeric:tabular-nums}
.sec .hint{margin-left:auto;font-size:12px;font-weight:400;color:var(--muted)}
.sec+.card{padding:6px 16px}
.list>.item{padding:16px 0;border-bottom:1px solid var(--line)}
.list>.item:last-child{border-bottom:0}
.item--tight{padding:14px 0}
.meta{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--muted);margin-bottom:6px;flex-wrap:wrap}
.meta time{margin-left:auto;font-variant-numeric:tabular-nums}
.chip{font-size:11px;padding:1px 7px;border-radius:5px;border:1px solid var(--line);background:var(--soft);color:var(--muted)}
.chip--org{background:color-mix(in srgb,var(--c-poss) 10%,transparent);color:var(--c-poss);border-color:transparent}
.chip--semi{background:color-mix(in srgb,var(--c-semi) 12%,transparent);color:var(--c-semi);border-color:transparent}
.chip--ai{background:color-mix(in srgb,var(--c-teal) 12%,transparent);color:var(--c-teal);border-color:transparent}
.chip--topic{background:color-mix(in srgb,var(--c-fore) 12%,transparent);color:var(--c-fore);border-color:transparent}
.chip--coop{background:color-mix(in srgb,var(--c-coop) 13%,transparent);color:var(--c-coop);border-color:transparent}
.chip--ind{background:color-mix(in srgb,var(--c-ind) 13%,transparent);color:var(--c-ind);border-color:transparent}
.chip--aff{background:color-mix(in srgb,var(--c-pro) 13%,transparent);color:var(--c-pro);border-color:transparent}
.chip--people{background:color-mix(in srgb,var(--c-poss) 13%,transparent);color:var(--c-poss);border-color:transparent}
.chip--pro{background:color-mix(in srgb,var(--c-pro) 13%,transparent);color:var(--c-pro);border-color:transparent}
.chip--poss{background:color-mix(in srgb,var(--c-poss) 12%,transparent);color:var(--c-poss);border-color:transparent}
.chip--fore{background:color-mix(in srgb,var(--c-fore) 12%,transparent);color:var(--c-fore);border-color:transparent}
.badge{font-size:11px;padding:1px 7px;border-radius:99px;font-weight:600}
.badge--same{background:color-mix(in srgb,var(--c-teal) 14%,transparent);color:var(--c-teal)}
.badge--diff{background:color-mix(in srgb,var(--c-poss) 14%,transparent);color:var(--c-poss)}
.src{font-size:11.5px;color:var(--muted)}
.title{display:block;font-size:16px;line-height:1.55;font-weight:600}
.title:active{opacity:.6}
.doc{margin-top:5px;font-size:12px;color:var(--c-poss);font-variant-numeric:tabular-nums}
.excerpt{margin:6px 0 0;font-size:13.5px;line-height:1.65;color:var(--muted)}
.note{margin:0 0 4px;padding:12px 0;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line)}
.empty{padding:18px 0;color:var(--muted);font-size:14px;margin:0}
.degrade{margin:12px 0;padding:12px 14px;background:var(--soft);border-radius:10px;font-size:13px;color:var(--muted);line-height:1.6}
.pair{display:grid;gap:10px;margin:8px 0 6px}
.side{display:flex;gap:9px;align-items:flex-start}
.side>div{flex:1;min-width:0}
.flag{flex:0 0 auto;width:18px;height:18px;border-radius:5px;font-size:11px;font-weight:700;display:grid;place-items:center;background:color-mix(in srgb,var(--c-poss) 14%,transparent);color:var(--c-poss);margin-top:4px}
.flag--intl{background:color-mix(in srgb,var(--c-normal) 16%,transparent);color:var(--c-normal)}
.side .title{font-size:14.5px;font-weight:500}
.side .src{display:block;margin-top:2px}
.shared{margin-top:6px;font-size:11.5px;color:var(--muted)}
.shared b{font-weight:600;color:var(--ink);opacity:.75}
.tracks{padding:6px 16px}
.track{padding:16px 0 16px 14px;position:relative}
.track+.track{border-top:1px solid var(--line)}
.track::before{content:"";position:absolute;left:0;top:18px;bottom:18px;width:3px;border-radius:2px;background:var(--c-poss);opacity:.35}
.track--pro::before{background:var(--c-pro)}
.track-h{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.track-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.track-list li{display:block;font-size:14.5px;line-height:1.65}
.track-list b{display:block;font-size:11.5px;font-weight:600;color:var(--muted);margin-bottom:1px}
h3{font-size:12px;letter-spacing:.12em;color:var(--muted);margin:20px 0 8px;font-weight:600}
.nodes{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13.5px}
.nodes li{display:flex;gap:10px;color:var(--muted)}
.nodes time{font-variant-numeric:tabular-nums;color:var(--c-fore);font-weight:600;flex:0 0 44px}
details{margin-top:22px;border-top:1px dashed var(--line);padding-top:14px}
summary{font-size:13px;color:var(--muted);cursor:pointer;outline:none}
details ul{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:8px}
details li{display:flex;gap:8px;font-size:13px;color:var(--muted);line-height:1.6}
footer{margin-top:36px;padding-top:18px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted);line-height:1.8}
.srcgrid{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 14px}
.src-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid var(--line);border-radius:99px;font-size:11px}
.src-chip b{font-weight:600;font-variant-numeric:tabular-nums;opacity:.7}
.src-chip--down{opacity:.45;text-decoration:line-through}
.arch{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.arch-item{display:flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--line);border-radius:8px;font-size:11.5px}
.arch-date{font-variant-numeric:tabular-nums}
.arch-type--normal{color:var(--c-normal)}.arch-type--poss{color:var(--c-poss)}.arch-type--fore{color:var(--c-fore)}
@media (max-width:420px){.vtype{font-size:29px}.wrap{padding:18px 14px 64px}}
</style>
</head>
<body>
<div class="wrap">

  <header class="mast">
    <div class="brand"><span class="dot"></span>今日坐标</div>
    <div class="date"><b>${m}.${d}</b><span>${y} · ${esc(meta.weekday)}</span></div>
  </header>

  <section class="card verdict t-${typeClass}">
    <div class="vlabel">判定</div>
    <h1 class="vtype">${esc(day.type)}</h1>
    <p class="vone">${esc(day.oneLine)}</p>
    ${meter}
    <ul class="overview">${overviewList}</ul>
  </section>

  <nav class="tabs">
    <a href="#gov">国务院</a>
    <a href="#tech">科技</a>
    <a href="#coop">中外合作</a>
    <a href="#industry">产业</a>
    <a href="#consensus">共识</a>
    <a href="#impact">影响</a>
    <a href="#summary">总结</a>
  </nav>

  <h2 class="sec" id="gov"><span class="num">01</span>国务院 · 今日发布<span class="hint">原文为准</span></h2>
  <div class="card list">${govNote}${govItems}</div>

  <h2 class="sec" id="tech"><span class="num">02</span>科技 · AI · 半导体<span class="hint">今日 ${tech.counts.today} / 共 ${tech.counts.total}</span></h2>
  <div class="card list">${techItems}</div>

  <h2 class="sec" id="coop"><span class="num">03</span>中外合作<span class="hint">签约 · 投资 · 订单 · 往来</span></h2>
  <div class="card list">${coopItems}</div>

  <h2 class="sec" id="industry"><span class="num">04</span>产业与其他<span class="hint">价格 · 产能 · 订单</span></h2>
  <div class="card list">${indItems}</div>

  <h2 class="sec" id="consensus"><span class="num">05</span>内外共识<span class="hint">同题 + 同实体</span></h2>
  <div class="card list">${consensusBody}</div>

  <h2 class="sec" id="impact"><span class="num">06</span>影响分析<span class="hint">对象 · 时间尺度</span></h2>
  <div class="card list">${impactItems}</div>

  <h2 class="sec" id="summary"><span class="num">07</span>今日总结<span class="hint">两条线</span></h2>
  <div class="card tracks">${summaryBody}</div>

  <div class="card" style="padding:18px;margin-top:12px">
    ${upcoming}
    <details>
      <summary>判定依据：这个结论是怎么算出来的</summary>
      <ul>${signals}</ul>
    </details>
  </div>

  <footer>
    <div>数据来自 ${okSources.length} 个可用来源，抓取 ${meta.totalItems} 条；生成于 ${esc(genTime)}（北京时间）。</div>
    <div class="srcgrid">${healthGrid(health)}</div>
    ${downSources.length ? `<div>今日不可达：${downSources.map((h) => esc(h.name)).join('、')}。</div>` : ''}
    <div style="margin-top:14px">归档</div>
    <div class="arch">${arch}</div>
    <div style="margin-top:16px;opacity:.75">
      自动聚合：原文链接均指向来源站点，摘要为机器截取，可能有误差；政策类请以 gov.cn 原文为准。
      「中外合作」按标题动词 + 国家/外企实体匹配，「影响分析」是规则推断，都不是预测，也不构成建议。
    </div>
  </footer>

</div>
</body>
</html>`;
}
