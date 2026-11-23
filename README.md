# 今日坐标 · Daily Fix

每天一份、四格读完的个人信息简报。零依赖，纯 Node 脚本生成静态页。

| 栏目 | 内容 | 数据来源 |
|---|---|---|
| 01 国务院 · 今日发布 | 当天国务院系统的文件与要闻，标出**发文字号**、**施行日期**、原文链接 | 中国政府网政策库 JSON、国务院文件推送、要闻 JSON |
| 02 科技 · AI · 半导体 | 当日科技条目，按半导体 / AI / 前沿 / 产品分类，同源最多占 2 席 | 量子位、IT之家、少数派、集邦；云端另加 EE Times、TechCrunch、arXiv 等 |
| 03 内外共识 | 同一议题被**境内源和境外源同时报道**的条目，附共享实体与语气差 | 境内观察者网、环球网；境外联合早报（云端再加 Reuters / BBC / 联合国新闻） |
| 04 普通人的今天 | 判定今天是**正常一天 / 可能性一天 / 前瞻性一天**，给出三条结论 + 判定依据 | 以上三格的信号加权 |

判定模型是显式规则的加权，不是预测：

```
前瞻 = Σ(未来生效日 × 临近度 × 新鲜度) + Σ(技术节点)
可能 = Σ(民生政策 × 新鲜度) + Σ(市场异动) + Σ(宏观口径)
正常 = 60 − 0.35 × (前瞻 + 可能)   ← 基底
三项归一化成百分比，最大者即当天判定；页面上把每条信号和权重都列出来。
```

---

## 本地跑（手机上就能用）

```bash
node src/build.mjs        # 生成 docs/index.html
node src/serve.mjs 8099   # 本地预览 http://127.0.0.1:8099/
node src/build.mjs --dry  # 只打印分析结果，不写文件
```

只依赖 Node ≥ 20，不需要 npm install。

## 云端跑（GitHub Actions + Pages）

1. 建一个仓库（公开或私有都行），把本目录推上去，默认分支 `main`。
2. 仓库 **Settings → Pages → Source** 选 **GitHub Actions**。
3. **Actions** 标签页里手动跑一次 `daily-brief`。
4. 之后每天北京时间 07:10 / 11:10 / 18:10 自动生成并部署，地址形如
   `https://<你的用户名>.github.io/<仓库名>/`。

每次运行会把 `docs/data/<日期>.json` 和 `docs/d/<日期>.html` 提交回仓库，
所以历史归档是免费的、可回溯的、可 diff 的。

### 一键发布（在手机上，不需要 git push）

这个沙箱所在的网络连不上 `github.com:443`，但 `api.github.com` 是通的，
所以发布走 Contents API，逐文件上传：

```bash
GITHUB_TOKEN=xxx node scripts/publish.mjs <你的用户名>/jinri-zuobiao --private
```

脚本会：建仓库 → 推全部文件 → 启用 Pages（源选 GitHub Actions）→ 触发一次构建。
token 建在 <https://github.com/settings/tokens?type=beta>，勾
**Contents 读写 · Workflows 读写 · Pages 读写 · Administration 读写**，设 7 天过期即可，用完直接在设置里删。

### 为什么是 GitHub 而不是自建服务器
- 不用管 VPS、不用管证书、不会因为欠费停机；
- Actions 的出口在境外，**能同时抓到境内和境外源**——这是「内外共识」这一格成立的前提，在手机上直接抓做不到；
- 快照进 git，等于自带版本历史，哪天想改判定模型可以回看当时的输入。

### 它的两个真实短板

- **cron 不准时**：GitHub 的定时任务在高峰会延迟 5–30 分钟，极端情况会跳过。所以每天排了 3 次，而不是 1 次。
- **站点是公开的**：Pages 没有访问控制。只想自己看就把仓库设为私有（私有仓库的 Pages 需要付费计划），或者只把 `docs/` 当文件看。

## 加一个信息源

编辑 `src/sources.mjs`，加一条：

```js
{
  id: 'sspai', name: '少数派', short: '少数派',
  region: 'cn',      // cn = 境内源，intl = 境外源（参与「内外共识」配对）
  kind: 'tech',      // official | tech | media | academic
  weight: 42,        // 只影响排序
  modes: ['local'],  // local = 手机网络可达；ci = 仅 Actions 可达
  adapter: 'rss',    // rss | html-links | gov-zuixin | gov-push
  url: 'https://sspai.com/feed',
  home: 'https://sspai.com/',
}
```

`html-links` 适配器需要给一条 `filter` 正则来认文章链接。
某个源挂了不会影响整站，页脚会显示它的健康度。

## 目录

```
src/lib.mjs      抓取、解码（含 GBK）、RSS/Atom 解析、政策页元数据提取
src/sources.mjs  信息源登记表
src/collect.mjs  并发采集 + 硬超时 + 健康度
src/analyze.mjs  四格分析 + 今日判定
src/render.mjs   自包含 HTML（无外部字体/JS）
src/build.mjs    入口
src/serve.mjs    本地预览（可选每日自动重建）
docs/            生成结果，Pages 直接托管
.github/workflows/daily.yml
```

## 已知限制

- 摘要由机器截取，可能断章取义；政策类一律以 gov.cn 原文为准。
- 「内外共识」靠词表 + 实体重叠配对，不是语义理解，会漏配，也会偶尔配错；页面保留双方原文标题供你自己核对。
- 单日判定受源的可达性影响：境外源全挂时，「前瞻/可能」的分数会偏低。
- 境内网络直连境外站点基本不可用，`modes: ['ci']` 的源只在 Actions 上有数据。
