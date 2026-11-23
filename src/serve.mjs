// serve.mjs — 本地静态预览（零依赖）
//   node src/serve.mjs 8099
// 手机浏览器访问 http://127.0.0.1:8099/

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const PORT = Number(process.argv[2] || 8099);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(DOCS, url === '/' ? 'index.html' : url.replace(/^\/+/, ''));

  // 不允许越出 docs/
  if (!file.startsWith(DOCS)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>还没有生成今天的页面，先跑 <code>node src/build.mjs</code>。</p>');
    return;
  }

  // ?refresh=1 时顺手重建一次（手机上「下拉刷新」也能拿到最新）
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  今日坐标 · 本地预览`);
  console.log(`  http://127.0.0.1:${PORT}/`);
  console.log(`  ${DOCS}\n`);
});

// 每天按 config.json 的 schedule 自动重建（服务常驻时生效）
let slots = ['07:10'];
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/config.json'), 'utf8'));
  const s = cfg.schedule || {};
  slots = [s.wake, s.noon, s.evening].filter(Boolean);
} catch {
  /* 用默认值 */
}
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const schedule = () => {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nextMin = slots.map(toMin).sort((a, b) => a - b).find((m) => m > nowMin + 1) ?? slots.map(toMin).sort((a, b) => a - b)[0] + 1440;
  const delta = (nextMin - nowMin) * 60 * 1000 - now.getSeconds() * 1000;
  setTimeout(() => {
    execFile(process.execPath, [path.join(ROOT, 'src/build.mjs')], (err) => {
      console.log(`[定时] ${new Date().toISOString()} ${err ? '失败 ' + err.message : '完成'}`);
      schedule();
    });
  }, Math.max(5000, delta));
};
if (!process.argv.includes('--no-cron')) schedule();
