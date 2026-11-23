// publish.mjs — 只靠 api.github.com 把整个目录发布成一个仓库
//
// 为什么不用 git push：手机所在网络连不上 github.com:443（会超时），
// 但 api.github.com 是通的，所以改用 Contents API 逐个文件上传。
//
// 用法：
//   GITHUB_TOKEN=github_pat_xxx node scripts/publish.mjs <owner/repo> [--private]
//   GITHUB_TOKEN=github_pat_xxx node scripts/publish.mjs my-daily-brief --private
//
// token 需要的最小权限：
//   经典 token：repo + workflow
//   细粒度 token：Contents(RW) + Workflows(RW) + Pages(RW) + Administration(RW)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const API = 'https://api.github.com';

const SKIP = new Set(['.git', 'node_modules', '.DS_Store']);
const SKIP_EXT = /\.(log|tmp|swp)$/;

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const isPrivate = process.argv.includes('--private');

async function api(method, url, body, { raw = false } = {}) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'jinri-zuobiao-publisher',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok && !raw) {
    const msg = json && json.message ? json.message : text.slice(0, 200);
    const err = new Error(`${method} ${url} → ${res.status} ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return { status: res.status, json, text };
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (!SKIP_EXT.test(name)) out.push(full);
  }
  return out;
}

async function main() {
  if (!TOKEN) {
    console.error(`
缺少 GITHUB_TOKEN。

  GITHUB_TOKEN=github_pat_xxx node scripts/publish.mjs <owner/repo> --private

token 在这里建（推荐 fine-grained，只授这一个仓库）：
  https://github.com/settings/tokens?type=beta
需要的权限：Contents 读写、Workflows 读写、Pages 读写、Administration 读写。
`);
    process.exit(1);
  }

  const me = (await api('GET', '/user')).json;
  console.log(`\n身份：${me.login}`);

  let [owner, repo] = (args[0] || '').split('/').filter(Boolean);
  if (!repo) {
    repo = owner || 'jinri-zuobiao';
    owner = me.login;
  }

  // 1. 仓库
  let exists = true;
  try {
    await api('GET', `/repos/${owner}/${repo}`);
  } catch (e) {
    if (e.status === 404) exists = false;
    else throw e;
  }
  if (!exists) {
    await api('POST', owner === me.login ? '/user/repos' : `/orgs/${owner}/repos`, {
      name: repo,
      description: '今日坐标：每天四格的个人信息简报',
      private: isPrivate,
      has_issues: false,
      has_wiki: false,
      auto_init: false,
    });
    console.log(`✓ 已创建仓库 ${owner}/${repo}（${isPrivate ? '私有' : '公开'}）`);
  } else {
    console.log(`✓ 仓库已存在 ${owner}/${repo}`);
  }

  // 2. 文件
  const files = walk(ROOT);
  console.log(`\n推送 ${files.length} 个文件…`);
  let done = 0;
  const failed = [];
  for (const full of files) {
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    const content = fs.readFileSync(full).toString('base64');
    try {
      let sha;
      try {
        const cur = await api('GET', `/repos/${owner}/${repo}/contents/${encodeURI(rel)}`);
        sha = cur.json.sha;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      try {
        await api('PUT', `/repos/${owner}/${repo}/contents/${encodeURI(rel)}`, {
          message: `${sha ? 'update' : 'add'} ${rel}`,
          content,
          ...(sha ? { sha } : {}),
        });
      } catch (e) {
        if (e.status === 422 && !sha) {
          // 已存在但没拿到 sha：重取一次再写
          const cur = await api('GET', `/repos/${owner}/${repo}/contents/${encodeURI(rel)}`);
          await api('PUT', `/repos/${owner}/${repo}/contents/${encodeURI(rel)}`, {
            message: `update ${rel}`,
            content,
            sha: cur.json.sha,
          });
        } else {
          throw e;
        }
      }
      done++;
      if (done % 6 === 0) console.log(`   ${done}/${files.length}`);
    } catch (e) {
      if (e.status === 403 || e.status === 404) {
        failed.push({ rel, status: e.status });
        console.log(`   ✗ ${rel}（${e.status} 权限不足，跳过）`);
        continue;
      }
      throw e;
    }
  }
  console.log(`✓ 推送完成：成功 ${done} 个${failed.length ? `，跳过 ${failed.length} 个` : ''}`);

  // 3. Pages：有工作流就用 Actions 源，没有就退回「分支 + /docs」
  const workflowOk = !failed.some((f) => f.rel.includes('workflows/'));
  const pagesBody = workflowOk ? { build_type: 'workflow' } : { source: { branch: 'main', path: '/docs' } };
  try {
    const r = await api('POST', `/repos/${owner}/${repo}/pages`, pagesBody, { raw: true });
    if (r.status === 201) console.log(`✓ Pages 已启用（源：${workflowOk ? 'GitHub Actions' : '分支 main 的 /docs'}）`);
    else if (r.status === 409) console.log('· Pages 已启用过，跳过');
    else console.log(`· Pages 启用返回 ${r.status}：${(r.json && r.json.message) || ''}`);
  } catch (e) {
    console.log(`· Pages 需手动启用：Settings → Pages（${e.message}）`);
  }

  // 4. 触发一次
  try {
    await api('POST', `/repos/${owner}/${repo}/actions/workflows/daily.yml/dispatches`, { ref: 'main' });
    console.log('✓ 已触发一次构建');
  } catch (e) {
    console.log(`· 首次构建可手动点：Actions → daily-brief → Run workflow（${String(e.message).slice(0, 80)}）`);
  }

  console.log(`
完成。

  仓库：https://github.com/${owner}/${repo}
  站点：https://${owner}.github.io/${repo}/     （首次构建约 1 分钟后可用）
  动作：https://github.com/${owner}/${repo}/actions

用完之后 token 可以直接在设置里删掉，本地不留任何凭据。
`);
}

main().catch((e) => {
  console.error('\n失败：' + e.message);
  process.exit(1);
});
