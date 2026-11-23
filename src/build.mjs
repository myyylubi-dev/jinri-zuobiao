// build.mjs — 生成当天简报
//   node src/build.mjs            手机/境内模式（默认）
//   node src/build.mjs --ci       GitHub Actions 模式（含境外源）
//   node src/build.mjs --dry      只打印分析结果，不写文件
//   node src/build.mjs --date=2026-11-21

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
import { analyze } from './analyze.mjs';
import { beijingToday, weekdayCN, clip } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args.includes('--ci') ? 'ci' : 'local';
const dry = args.includes('--dry');
const today = (args.find((a) => a.startsWith('--date=')) || '').split('=')[1] || beijingToday();

const t0 = Date.now();
console.log(`\n[今日坐标] ${today} ${weekdayCN(today)} · 模式 ${mode}\n`);
console.log('① 采集');
const { items, health } = await collect({ mode, onLog: (l) => console.log(l) });
console.log(`   合计 ${items.length} 条，${health.filter((h) => h.ok).length}/${health.length} 个源可用\n`);

console.log('② 分析');
const data = await analyze({ items, health, today, mode });
console.log('   完成\n');

if (dry) {
  const c = (s) => console.log(s);
  c(`判定：${data.day.type}  ${JSON.stringify(data.day.dist)}`);
  c(`一句话：${data.day.oneLine}`);
  c(`\n[国务院] ${data.gov.headline}`);
  for (const g of data.gov.items.slice(0, 5))
    c(`  · ${g.date} ${clip(g.title, 46)} ${g.docNumber ? '｜' + g.docNumber : ''} ${g.effectiveAt ? '｜' + g.effectiveAt + '施行' : ''}`);
  c(`\n[科技] 共 ${data.tech.counts.total} 条（今日 ${data.tech.counts.today}）`);
  for (const t of data.tech.items) c(`  · [${t.tag}] ${clip(t.title, 40)} — ${t.short}`);
  c(`\n[共识] 可用=${data.consensus.available} 境外源=${data.consensus.intlSourcesUp}`);
  for (const x of data.consensus.topics) c(`  · ${x.label} 强度${x.strength} 一致=${x.agree}\n      中:${clip(x.zh.title, 38)}\n      外:${clip(x.intl.title, 38)}`);
  if (!data.consensus.topics.length && data.consensus.cnOnly.length) {
    c('  （境外不可达，仅境内可核实的国际反应）');
    for (const i of data.consensus.cnOnly) c(`  · ${clip(i.title, 44)}`);
  }
  c(`\n[普通人] 信号 ${data.day.signals.length} 条`);
  for (const s of data.day.signals.slice(0, 8)) c(`  · (${s.bucket}/${s.w}) ${s.text}`);
  c(`  行动：`);
  for (const a of data.day.actions) c(`    → ${a}`);
  c(`\n源健康度：`);
  for (const h of data.health) c(`  ${h.ok ? '✓' : '✗'} ${h.name.padEnd(22)} ${String(h.count).padStart(3)} 条 ${h.ms}ms ${h.error || ''}`);
  console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
}

// ---- 写盘
const { renderPage } = await import('./render.mjs');
fs.mkdirSync(path.join(ROOT, 'docs/data'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'docs/d'), { recursive: true });

const snapshot = {
  ...data,
  meta: { ...data.meta, schema: 1 },
};
fs.writeFileSync(path.join(ROOT, `docs/data/${today}.json`), JSON.stringify(snapshot, null, 1));

// 归档索引
const idxPath = path.join(ROOT, 'docs/data/index.json');
let index = [];
try {
  index = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
} catch {
  index = [];
}
index = index.filter((x) => x.date !== today);
index.push({ date: today, weekday: weekdayCN(today), type: data.day.type, dist: data.day.dist, headline: data.day.oneLine });
index.sort((a, b) => (a.date < b.date ? 1 : -1));
fs.writeFileSync(idxPath, JSON.stringify(index, null, 1));

const page = renderPage(snapshot, { index });
fs.writeFileSync(path.join(ROOT, 'docs/index.html'), page);
fs.writeFileSync(path.join(ROOT, `docs/d/${today}.html`), page);

console.log(`✓ docs/index.html （${(page.length / 1024).toFixed(1)} KB）`);
console.log(`✓ docs/d/${today}.html`);
console.log(`✓ docs/data/${today}.json`);
console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
process.exit(0);
