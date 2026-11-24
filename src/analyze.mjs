// analyze.mjs — 把 items[] 变成四个面板 + 今日判定
// 原则：结论必须能指回原文；判定模型是显式规则加权，页面会把依据全部列出来。

import fs from 'node:fs';
import path from 'node:path';
import { getText, parsePolicyMeta, weekdayCN, daysBetween, clip } from './lib.mjs';

// 口味配置：分类权重、每类席位上限、发布时间
let CONFIG = { focus: {}, tagCap: {}, sourceCap: 2, schedule: {} };
try {
  CONFIG = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'config.json'), 'utf8'));
} catch {
  /* 没配置就用默认值 */
}

/* ------------------------------------------------------------------ 词表 */

const LIFELINE =
  /(电价|水价|气价|油价|燃气|成品油|供热|供暖|医保|社保|养老金|退休|个税|专项附加扣除|房贷|公积金|利率|就业|失业|招聘|最低工资|工资|消费券|补贴|育儿|生育|托育|养老|医疗|药品|集采|学费|高考|中考|校历|食品安全|快递|外卖|出行|交通|限行|高速|放假|调休|假期|加班|户口|落户|身份证|婚姻|离婚|驾驶证|年检|物业|水电|租金|保障房|老旧小区|充电桩|购置税|消费税|增值税|关税|殡葬)/;

const FUTURE_ANCHOR = /(首次|首个|首例|首款|首台|全球第一|填补空白|量产|开工|竣工|发射|试点|征求意见|公开征求|听证|过渡期)/;
const MARKET_MOVE = /(暴跌|暴涨|熔断|创新高|创新低|大跌|大涨|跌停|涨停|跳水|疯涨)/;
const MACRO = /(降息|加息|LPR|CPI|PPI|人民币汇率|存款准备金|国债收益率|社融)/;

const TECH_RULES = [
  { tag: '半导体', re: /(芯片|半导体|光刻|EUV|DUV|晶圆|制程|纳米|HBM|DRAM|NAND|SSD|闪存|GPU|封装|CIS|晶片|台积电|中芯|长鑫|长江存储|寒武纪|昇腾|英伟达|EDA|碳化硅|功率器件|存储)/ },
  { tag: 'AI', re: /(人工智能|大模型|AI|Agent|agent|GPT|智能体|推理|训练|多模态|AGI|世界模型|具身|Transformer|Token|上下文|开源模型|微调|对齐|算力)/ },
  { tag: '前沿', re: /(量子|核聚变|超导|脑机|人形机器人|机器人|自动驾驶|低空|eVTOL|可回收|固态电池|钙钛矿|基因编辑)/ },
  { tag: '产品', re: /(发布|上架|开售|定价|评测|上手|更新|版本|系统|手机|电脑|耳机|相机|应用|停服|停运|机箱|键盘|显示器)/ },
];
const TECH_ANY = /(AI|人工智能|大模型|模型|芯片|半导体|算力|GPU|光刻|EUV|晶圆|存储|HBM|制程|量子|机器人|具身|自动驾驶|智能体|Agent|数据中心|台积电|英伟达|华为|昇腾|寒武纪|中芯|开源|算法|训练|推理)/;

const TOPICS = [
  { id: 'apec', label: '亚太与 APEC', strong: ['APEC', '亚太经合组织', '亚太自贸区'], weak: ['亚太', '深圳之约'] },
  { id: 'uscn', label: '中美关系', strong: ['中美关系', '中美经贸', '对华关税', '中美贸易', '中美峰会'], weak: ['中美', '关税', '贸易战'] },
  { id: 'chips', label: '半导体', strong: ['半导体', '芯片', '光刻机', '先进制程', '晶圆厂'], weak: ['出口管制', '存储芯片', 'HBM', '稀土'] },
  { id: 'ai', label: '人工智能', strong: ['人工智能', '大模型', '通用人工智能', 'AI 治理', 'AI治理'], weak: ['AI', '智能体', '算力'] },
  { id: 'macro', label: '经济与货币', strong: ['美联储', '降息', '加息', '通胀', 'CPI', 'GDP'], weak: ['利率', '汇率', '财政'] },
  { id: 'ev', label: '新能源车', strong: ['新能源汽车', '电动车', '固态电池', '充电桩'], weak: ['电池', '比亚迪', '特斯拉'] },
  { id: 'climate', label: '气候与能源', strong: ['气候变化', '碳排放', 'COP30', 'COP31', '双碳', '极端天气'], weak: ['光伏', '风电', '核电', '能源'] },
  { id: 'geopol', label: '地缘冲突', strong: ['俄乌', '乌克兰', '加沙', '以色列', '停火协议'], weak: ['伊朗', '中东', '巴勒斯坦'] },
  { id: 'trade', label: '全球贸易', strong: ['供应链', '出口管制', '贸易协定', '世贸组织'], weak: ['出口', '进口', '航运'] },
  { id: 'ai-safety', label: 'AI 安全与监管', strong: ['AI安全', '人工智能安全', '深度伪造', '算法治理'], weak: ['监管', '立法', '伦理'] },
  { id: 'space', label: '航天与前沿', strong: ['航天', '火箭发射', '空间站', '核聚变', '量子计算'], weak: ['卫星', '探月'] },
];

const ENTITIES = [
  '习近平', '特朗普', '普京', '美联储', '联合国', '欧盟', '东盟', 'APEC', 'G20', '世贸组织',
  '美国', '中国', '俄罗斯', '乌克兰', '以色列', '加沙', '伊朗', '日本', '韩国', '印度',
  '台积电', '英伟达', '华为', '比亚迪', '特斯拉', '苹果', '微软', 'OpenAI', '三星',
  '稀土', '关税', '芯片', '人工智能', '电动车', '通胀', '利率', 'GDP', 'CPI',
];
// 过于宽泛的实体只算「弱证据」，避免仅凭「中国」两个字就把两条新闻配成一对
const GENERIC_ENT = new Set(['中国', '美国', '全球', '芯片', '人工智能', '关税', '利率', '通胀']);

/* ------------------------------------------------------------- 小工具 */

const humanDate = (iso) => {
  const [, m, d] = iso.split('-');
  return `${Number(m)}月${Number(d)}日`;
};
const relText = (today, iso) => {
  const d = daysBetween(today, iso);
  if (d === 0) return '今天';
  if (d === 1) return '明天';
  if (d === -1) return '昨天';
  return d > 1 ? `${d} 天后` : `${-d} 天前`;
};
const toneOf = (title) => (title.match(/(增长|上涨|突破|达成|签署|合作|成功|领先|改善|回升|超预期|利好|创新|获批|扩张|稳定|恢复|新高|获奖)/g) || []).length -
  (title.match(/(下跌|下滑|亏损|裁员|冲突|制裁|封锁|限制|关税|违约|风险|警告|暴跌|危机|衰退|调查|处罚|下调|削减|暂停|延期|召回|故障|停运|停服)/g) || []).length;

const titleKey = (t) => t.replace(/[《》“”"'’（）()\s：:，,]/g, '').slice(0, 14).toLowerCase();

function dedupe(items) {
  const seen = new Map();
  for (const it of items) {
    const k = titleKey(it.title);
    const prev = seen.get(k);
    if (!prev || prev.weight < it.weight) seen.set(k, it);
  }
  return [...seen.values()];
}

const entitiesIn = (text) => new Set(ENTITIES.filter((e) => text.includes(e)));

const orgOf = (it) => {
  const t = it.title || '';
  const n = it.docNumber || '';
  if (/^国令/.test(n)) return '国务院令';
  if (/^国发/.test(n)) return '国务院';
  if (/^国办发|^国办发明电/.test(n)) return '国办';
  if (it.sourceId === 'gov-yaowen') return '要闻';
  if (it.sourceId === 'gov-gwy') return '国务院文件';
  if (t.startsWith('中共中央') || t.startsWith('中办')) return '中共中央';
  if (t.startsWith('国务院办公厅')) return '国办';
  if (t.startsWith('国务院')) return '国务院';
  if (/^(国家|中国|全国)/.test(t)) return '国家层面';
  return '部委';
};

/* --------------------------------------------------- 面板一：国务院 */

async function govPanel(items, today) {
  const gov = dedupe(items.filter((i) => i.kind === 'official' && i.region === 'cn')).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : b.weight - a.weight
  );
  const news = gov.filter((i) => i.sourceId === 'gov-yaowen');
  const policy = gov
    .filter((i) => i.sourceId !== 'gov-yaowen')
    .filter((i) => !(i.title.startsWith('中共中央') && !i.title.includes('国务院')))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.weight - a.weight));

  const within = (arr, n) =>
    arr.filter((i) => {
      const dd = daysBetween(i.date, today);
      return dd >= 0 && dd <= n;
    });

  const policyToday = policy.filter((i) => i.date === today);
  const newsToday = news.filter((i) => i.date === today);
  const policy7 = within(policy, 7);
  const policy30 = within(policy, 30);

  const picks = (policyToday.length ? policyToday : policy7.length >= 3 ? policy7 : policy30).slice(0, 4);
  for (const n of newsToday.slice(0, 2)) {
    if (picks.length >= 5) break;
    if (!picks.some((p) => titleKey(p.title) === titleKey(n.title))) picks.push(n);
  }
  if (picks.length < 3) {
    for (const n of within(news, 2)) {
      if (picks.length >= 4) break;
      if (!picks.some((p) => titleKey(p.title) === titleKey(n.title))) picks.push(n);
    }
  }
  await Promise.all(
    picks.map(async (it) => {
      if (!/^https?:\/\/www\.gov\.cn\//.test(it.url)) return;
      try {
        const r = await getText(it.url, { timeout: 14000, retries: 1 });
        const meta = parsePolicyMeta(r.text);
        it.docNumber = meta.docNumber;
        it.effectiveAt = meta.effectiveAt;
        const body = meta.body || '';
        const idx = body.lastIndexOf(it.title);
        const tail = idx >= 0 ? body.slice(idx + it.title.length).trim() : '';
        if (tail && !/^首页/.test(tail) && tail.length > 24) {
          let cut = tail;
          for (const junk of ['登录', '注册', '扫一扫', '分享到', '责任编辑', '打印本页', '×', '【字体：']) {
            const i = cut.indexOf(junk);
            if (i > 24) cut = cut.slice(0, i);
          }
          it.excerpt = clip(cut.replace(/^[\s\S]{0,24}?(各省|国务院|为|根据|按照|现|一、)/, '$1'), 130);
        }
      } catch {
        /* 详情页失败不影响列表 */
      }
    })
  );

  const latest = policy[0];
  const headline = policyToday.length
    ? `今天国务院层面新增 ${policyToday.length} 条文件`
    : latest
    ? `今天国务院层面无新增文件${newsToday.length ? `，政府网要闻 ${newsToday.length} 条` : ''}；最近一次文件是 ${relText(today, latest.date)}（${humanDate(latest.date)}）`
    : newsToday.length
    ? `今天国务院层面无新增文件，政府网要闻 ${newsToday.length} 条`
    : '今天没有取到国务院数据';

  return {
    headline,
    todayCount: policyToday.length,
    newsCount: newsToday.length,
    weekCount: policy7.length,
    items: picks.map((i) => ({ ...i, org: orgOf(i) })),
    recent: policy30,
    latestDate: latest ? latest.date : '',
    latestTitle: latest ? latest.title : '',
  };
}

/* ------------------------------------------------------ 面板二：科技 */

function techPanel(items, today) {
  const adRe = /(报名|从速|扫码|限时|免费领|招募|预约直播|直播预告|促销|开售提醒)/;
  const base = items
    .filter((i) => i.kind === 'tech' || i.kind === 'academic' || TECH_ANY.test(i.title + i.summary))
    .filter((i) => !adRe.test(i.title));
  const fresh = (n) => base.filter((i) => daysBetween(i.date, today) <= n);
  let pool = fresh(7);
  if (pool.length < 12) pool = fresh(14);
  if (pool.length < 8) pool = base;
  const scored = dedupe(pool).map((it) => {
    const hay = `${it.title} ${it.summary}`;
    const rule = TECH_RULES.find((r) => r.re.test(it.title)) || TECH_RULES.find((r) => r.re.test(it.summary));
    const tag = rule ? rule.tag : '科技';
    const hits = (hay.match(TECH_ANY) || []).length;
    const age = Math.max(0, daysBetween(it.date, today));
    const raw = it.weight * 0.55 + (rule ? 20 : 0) + Math.min(hits, 4) * 3 + Math.max(0, 26 - age * 9) + (it.summary.length > 40 ? 4 : 0);
    // 活动通稿类（年会/论坛/峰会/圆满举行）降权，它们信息密度低
    const promo = /(年会|论坛|峰会|沙龙|圆桌|大讲堂|开幕式|圆满|隆重|举行|召开|参会)/.test(it.title) ? 0.6 : 1;
    // focus 来自 config.json：AI 应用层优先，硬件权重压低
    const score = raw * promo * (CONFIG.focus[tag] ?? 1);
    return { ...it, tag, raw, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // 单一来源、单一分类都有上限，避免整屏被同一家/同一类占满
  const picked = [];
  const per = new Map();
  const perTag = new Map();
  const cap = CONFIG.tagCap || {};
  const srcCap = CONFIG.sourceCap ?? 2;
  for (const it of scored) {
    if ((per.get(it.sourceId) || 0) >= srcCap) continue;
    if ((perTag.get(it.tag) || 0) >= (cap[it.tag] ?? 99)) continue;
    per.set(it.sourceId, (per.get(it.sourceId) || 0) + 1);
    perTag.set(it.tag, (perTag.get(it.tag) || 0) + 1);
    picked.push(it);
    if (picked.length >= 7) break;
  }
  if (picked.length < 6) {
    for (const it of scored) {
      if (picked.includes(it)) continue;
      picked.push(it);
      if (picked.length >= 6) break;
    }
  }

  return {
    items: picked,
    counts: {
      total: scored.length,
      today: scored.filter((i) => i.date === today).length,
      semiconductor: scored.filter((i) => i.tag === '半导体').length,
      ai: scored.filter((i) => i.tag === 'AI').length,
    },
  };
}

/* --------------------------------------------------- 面板三：内外共识 */

function topicScore(item, t) {
  const title = item.title;
  const all = `${item.title} ${item.summary}`;
  let s = 0;
  for (const k of t.strong) if (title.includes(k)) s += 3;
  for (const k of t.strong) if (!title.includes(k) && all.includes(k)) s += 2;
  for (const k of t.weak) if (all.includes(k)) s += 1;
  return s;
}

function consensusPanel(items, today) {
  const recent = items.filter((i) => {
    const d = daysBetween(i.date, today);
    return d >= -1 && d <= 2;
  });
  const cn = recent.filter((i) => i.region === 'cn');
  const intl = recent.filter((i) => i.region === 'intl');
  const intlSourcesUp = new Set(intl.map((i) => i.sourceId)).size;
  const cnSourcesUp = new Set(cn.map((i) => i.sourceId)).size;

  const rows = [];
  for (const t of TOPICS) {
    const zh = cn.filter((i) => topicScore(i, t) >= 2).sort((a, b) => topicScore(b, t) - topicScore(a, t));
    const en = intl.filter((i) => topicScore(i, t) >= 2).sort((a, b) => topicScore(b, t) - topicScore(a, t));
    if (!zh.length || !en.length) continue;

    // 必须共享至少一个实体，否则很可能是「同词不同事」
    let best = null;
    for (const z of zh.slice(0, 6)) {
      const zEnt = entitiesIn(`${z.title} ${z.summary}`);
      for (const e of en.slice(0, 6)) {
        const eEnt = entitiesIn(`${e.title} ${e.summary}`);
        const shared = [...zEnt].filter((x) => eEnt.has(x));
        const sharedW = shared.reduce((a, x) => a + (GENERIC_ENT.has(x) ? 1 : 2), 0);
        if (sharedW < 2) continue;
        const pairScore = sharedW * 10 + topicScore(z, t) + topicScore(e, t);
        if (!best || pairScore > best.pairScore) best = { z, e, shared, sharedW, pairScore };
      }
    }
    if (!best) continue;

    const zt = toneOf(best.z.title);
    const et = toneOf(best.e.title);
    const sameTone = Math.sign(zt) === Math.sign(et) || (Math.abs(zt) <= 1 && Math.abs(et) <= 1);
    rows.push({
      id: t.id,
      label: t.label,
      zhCount: zh.length,
      enCount: en.length,
      zh: best.z,
      intl: best.e,
      shared: best.shared,
      zt,
      et,
      agree: sameTone,
      strength: Math.min(100, 34 + best.sharedW * 9 + Math.min(zh.length, 3) * 6 + Math.min(en.length, 3) * 6),
    });
  }
  rows.sort((a, b) => b.strength - a.strength);

  return {
    available: intlSourcesUp > 0,
    intlSourcesUp,
    cnSourcesUp,
    topics: rows.slice(0, 5),
    note: intlSourcesUp
      ? `境外 ${intlSourcesUp} 个源、境内 ${cnSourcesUp} 个源同时覆盖；配对规则 = 同一议题 + 共享实体，语气按标题情绪词估算。`
      : '境外源今天从这台手机不可达，本节改为列出境内报道中可核实的国际反应；在 GitHub Actions 上会自动补齐境外一侧。',
    cnOnly: intlSourcesUp
      ? []
      : dedupe(
          cn.filter(
            (i) => i.kind === 'media' && [...entitiesIn(`${i.title} ${i.summary}`)].some((e) => !['中国', '芯片', '关税', '人工智能', '电动车', '通胀', '利率'].includes(e))
          )
        ).slice(0, 4),
  };
}

/* ------------------------------------------------- 面板三：中外合作 */

const COOP_NEG = /(限制|管制|制裁|禁令|收紧|调查|诉讼|反倾销|加税|加征|封锁|脱钩|批评|抨击|指责|抗议|起诉|禁售|暂停|叫停|否决|游戏|电竞|CS2|赛事|联赛|娱乐|综艺|代言)/;
const COOP_VERB = /(签署|签订|达成|合作|联手|携手|共建|合资|并购|投资|中标|订单|采购|出口|进口|开通|互免|免签|对接|落地|揭牌|联合声明|谅解备忘录|合作协议|战略合作|经贸|双边|峰会成果|交付)/;
const COUNTRIES = [
  '美国', '欧盟', '欧洲', '日本', '韩国', '德国', '法国', '英国', '俄罗斯', '东盟', '新加坡', '越南',
  '印度', '沙特', '阿联酋', '卡塔尔', '巴西', '阿根廷', '非洲', '埃及', '南非', '澳大利亚', '新西兰',
  '加拿大', '荷兰', '瑞士', '意大利', '西班牙', '土耳其', '墨西哥', '印尼', '马来西亚', '泰国',
  '哈萨克斯坦', '中亚', '中东', '拉美', '一带一路', '匈牙利', '塞尔维亚', '波兰',
];
const FOREIGN_FIRMS = [
  '特斯拉', '苹果', '英伟达', '高通', '三星', '西门子', '宝马', '奔驰', '大众', '丰田', '本田', '日产',
  '空客', '波音', '阿斯利康', '辉瑞', '诺和诺德', '壳牌', '道达尔', '巴斯夫', '博世', 'SK', 'LG', '现代',
  '淡水河谷', '力拓', '必和必拓', '微软', '谷歌', '亚马逊', 'Meta', '软银', '台积电', '联发科',
];

function cooperationPanel(items, today, techItems) {
  const recent = items.filter((i) => {
    const d = daysBetween(i.date, today);
    return d >= 0 && d <= 3;
  });
  const techKeys = new Set((techItems || []).map((t) => titleKey(t.title)));

  const rows = [];
  for (const it of recent) {
    const hay = `${it.title} ${it.summary}`;
    if (!COOP_VERB.test(it.title)) continue;
    if (COOP_NEG.test(it.title)) continue;
    const where = COUNTRIES.filter((c) => hay.includes(c));
    const firms = FOREIGN_FIRMS.filter((f) => hay.includes(f));
    if (!where.length && !firms.length) continue;
    if (/^中共中央|^国务院/.test(it.title)) continue;

    const kind = /(签署|签订|协议|备忘录|联合声明|战略合作|合作)/.test(it.title)
      ? '机制'
      : /(投资|并购|合资|建厂|增资)/.test(it.title)
      ? '投资'
      : /(出口|订单|中标|采购|交付)/.test(it.title)
      ? '贸易'
      : /(免签|互免|开通|复航)/.test(it.title)
      ? '往来'
      : '合作';

    const score = it.weight * 0.5 + where.length * 8 + firms.length * 10 + (techKeys.has(titleKey(it.title)) ? -15 : 0);
    rows.push({ ...it, kind, where, firms, score });
  }
  rows.sort((a, b) => b.score - a.score);

  // 同一国家/公司最多两条，避免刷屏又不至于只剩一条
  const picked = [];
  const used = new Map();
  for (const r of rows) {
    const tag = [...r.where, ...r.firms].join('|') || '其他';
    if ((used.get(tag) || 0) >= 2) continue;
    // 同一人物/机构的连续报道只留一条（如「丁薛祥访问…」与「丁薛祥会见…」）
    if (picked.some((p) => p.title.slice(0, 3) === r.title.slice(0, 3))) continue;
    used.set(tag, (used.get(tag) || 0) + 1);
    picked.push(r);
    if (picked.length >= 5) break;
  }

  return {
    items: picked,
    total: rows.length,
    note: picked.length ? '' : '今天没有抓到明确的中外合作类条目。',
  };
}

/* ----------------------------------------------- 面板四：产业与其他 */

const IND_KW =
  /(汽车|新能源车|光伏|储能|锂|电池|钢铁|化工|有色|稀土|机械|制造|产能|涨价|降价|价格|订单|出口|进口|物流|航运|港口|电力|煤炭|油气|天然气|农业|粮食|消费|零售|楼市|地产|航空|医药|集采|家电|纺织|服装|旅游|餐饮|票房|制造业|工业|产量|库存|开工|投产|扩产|减产)/;
const IND_NEG = /(游戏|电竞|CS2|赛事|联赛|电影|综艺|明星|娱乐|手游|主机游戏|抽奖|优惠券)/;

function industryPanel(items, today, techItems, coopItems) {
  const skip = new Set([...(techItems || []), ...(coopItems || [])].map((t) => titleKey(t.title)));
  const pool = items.filter((i) => {
    const d = daysBetween(i.date, today);
    if (d < 0 || d > 3) return false;
    if (i.kind === 'official') return false;
    if (skip.has(titleKey(i.title))) return false;
    if (!IND_KW.test(i.title)) return false;
    if (IND_NEG.test(`${i.title} ${i.summary}`)) return false;
    // 纯 AI / 半导体 的技术条目归 02，不在这里重复
    if (/(大模型|人工智能|芯片|半导体|光刻|晶圆|HBM|GPU)/.test(i.title) && !/(汽车|光伏|电力|能源|制造|产能|价格|订单)/.test(i.title)) return false;
    return true;
  });

  const scored = dedupe(pool).map((it) => {
    const age = Math.max(0, daysBetween(it.date, today));
    return { ...it, score: it.weight * 0.5 + Math.max(0, 24 - age * 8) + (it.summary.length > 40 ? 6 : 0) };
  });
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  const per = new Map();
  for (const it of scored) {
    if ((per.get(it.sourceId) || 0) >= 2) continue;
    per.set(it.sourceId, (per.get(it.sourceId) || 0) + 1);
    picked.push(it);
    if (picked.length >= 5) break;
  }

  return { items: picked, total: scored.length, note: picked.length ? '' : '今天没有抓到产业侧的独立条目。' };
}

/* -------------------------------------------------- 面板五：普通人 */

function dayPanel({ gov, tech, consensus, items, today }) {
  const signals = [];
  const push = (bucket, w, text, tag) => signals.push({ bucket, w, text, tag });

  const recentGov = gov.recent && gov.recent.length ? gov.recent : gov.items;
  const recency = (iso) => {
    const d = daysBetween(iso, today);
    return d <= 2 ? 1 : d <= 7 ? 0.8 : 0.55;
  };
  const upcoming = [];
  for (const g of recentGov) {
    if (!g.effectiveAt) continue;
    const d = daysBetween(today, g.effectiveAt);
    if (d < 0 || d > 90) continue;
    const prox = d <= 7 ? 1 : d <= 30 ? 0.8 : 0.5;
    upcoming.push({ date: g.effectiveAt, title: g.title, url: g.url, days: d, docNumber: g.docNumber || '' });
    push(
      'foresight',
      (d === 0 ? 24 : 16) * prox * recency(g.date),
      `${humanDate(g.effectiveAt)}（${relText(today, g.effectiveAt)}）起施行：${clip(g.title, 32)}`,
      'policy-effective'
    );
  }
  for (const g of recentGov) if (LIFELINE.test(g.title)) push('possibility', 13 * recency(g.date), `直接影响日常：${clip(g.title, 32)}`, 'lifeline');
  for (const g of recentGov) if (/征求意见|公开征求|试点/.test(g.title)) push('possibility', 10 * recency(g.date), `进入意见征集 / 试点：${clip(g.title, 30)}`, 'consultation');
  for (const t of tech.items) if (FUTURE_ANCHOR.test(t.title)) push('foresight', 8, `技术节点：${clip(t.title, 32)}`, 'tech-anchor');

  const movers = dedupe(items.filter((i) => MARKET_MOVE.test(i.title))).slice(0, 3);
  if (movers.length) push('possibility', 6 + movers.length * 3, `市场异动 ${movers.length} 条：${clip(movers[0].title, 24)}`, 'market');
  const macro = dedupe(items.filter((i) => MACRO.test(i.title))).slice(0, 2);
  if (macro.length) push('possibility', 8, `宏观口径变化：${clip(macro[0].title, 28)}`, 'macro');
  const holidayHit = recentGov.find((g) => /(放假|调休|假期安排|节假日)/.test(g.title) && daysBetween(g.date, today) <= 10);
  if (holidayHit) push('foresight', 9 * recency(holidayHit.date), '节假日安排类文件出现，影响全年请假与出行计划', 'holiday');

  const sF = Math.min(100, signals.filter((s) => s.bucket === 'foresight').reduce((a, s) => a + s.w, 0) * 2.0);
  const sP = Math.min(100, signals.filter((s) => s.bucket === 'possibility').reduce((a, s) => a + s.w, 0) * 2.0);
  const sN = Math.max(8, 60 - 0.35 * (sF + sP));
  const total = sF + sP + sN;
  const dist = {
    normal: Math.round((sN / total) * 100),
    possibility: Math.round((sP / total) * 100),
    foresight: Math.round((sF / total) * 100),
  };
  const type = dist.normal >= dist.possibility && dist.normal >= dist.foresight
    ? '正常一天'
    : dist.foresight >= dist.possibility
    ? '前瞻性一天'
    : '可能性一天';

  const oneLine = {
    正常一天: gov.todayCount === 0
      ? '今天没有新的国务院文件，科技面是产业与产品消息，内外共识落在既有议题上。对普通人来说，是照常过的一天。'
      : '今天有官方发布，但落在行业与治理层面，没有直接改动你的日常成本。',
    可能性一天: '今天出现了可能改变你近期选择的信息，值得花两分钟看完下面三条再决定要不要行动。',
    前瞻性一天: '今天的关键词是「倒计时」：有明确的未来时间点，现在就把日程往前排更划算。',
  }[type];

  const takeaways = [];
  takeaways.push({
    label: '政策',
    text: gov.todayCount
      ? `今天新增 ${gov.todayCount} 条官方发布，${gov.items.some((g) => LIFELINE.test(g.title)) ? '其中有直接涉及你支出或权利的文件' : '以行业、治理和程序性内容为主'}。`
      : `今天没有新增，最近一次是 ${relText(today, gov.latestDate)}的《${clip(gov.latestTitle, 24)}》${upcoming.length ? `，最近一个施行节点在 ${humanDate(upcoming[0].date)}` : ''}。`,
  });
  if (tech.items.length) {
    const t = tech.items[0];
    takeaways.push({
      label: '科技',
      text: t.tag === '产品'
        ? `和你的选择最近：${clip(t.title, 34)}（${t.short}）。`
        : t.tag === '半导体'
        ? `产业端在动：${clip(t.title, 34)}。短期不改变你的购买决定，但会影响明年的硬件价格与供货。`
        : `值得记一笔：${clip(t.title, 34)}（${t.short}）。`,
    });
  } else {
    takeaways.push({ label: '科技', text: '今天没有抓到值得单独提的科技条目。' });
  }
  if (consensus.topics.length) {
    const c = consensus.topics[0];
    takeaways.push({
      label: '内外',
      text: `同一件事两边都在说：${c.label}。境内 ${c.zhCount} 条、境外 ${c.enCount} 条，${c.agree ? '语气基本同向' : '语气有温差，值得对读'}。`,
    });
  } else {
    takeaways.push({ label: '内外', text: consensus.available ? '今天没有一个议题被两侧同时提及，属于信息上比较「各说各话」的一天。' : '境外侧今天不可达，这一格留给云端版本。' });
  }

  const actions = [];
  const actionable = upcoming.filter((u) => u.days <= 21).sort((a, b) => a.days - b.days);
  if (actionable.length) {
    const u = actionable[0];
    actions.push(`${humanDate(u.date)}（${relText(today, u.date)}）起《${clip(u.title, 24)}》施行，涉及你的部分提前看原文。`);
  }
  if (tech.items[0]) actions.push(`科技面值得跟进：${clip(tech.items[0].title, 28)}。`);
  if (!actions.length) actions.push('今天没有需要立刻行动的事，把注意力留给长期的事。');

  return {
    type,
    dist,
    score: { sF: Math.round(sF), sP: Math.round(sP), sN: Math.round(sN) },
    oneLine,
    signals: signals.sort((a, b) => b.w - a.w).slice(0, 6),
    takeaways,
    actions,
    upcoming: upcoming.sort((a, b) => a.days - b.days).slice(0, 3),
  };
}

/* ----------------------------------------------- 面板六：影响分析 */

function impactPanel({ gov, tech, coop, industry, consensus, today }) {
  const rows = [];
  const seen = new Set();
  const add = (it, affects, horizon, text) => {
    const k = titleKey(it.title || text);
    if (seen.has(k)) return;
    seen.add(k);
    rows.push({ title: it.title, url: it.url, short: it.short || it.sourceName, affects, horizon, text });
  };

  // 1. 即将施行的政策（最有确定性的一条）
  const policyHit = (gov.recent || []).find((g) => g.effectiveAt && daysBetween(today, g.effectiveAt) >= 0 && daysBetween(today, g.effectiveAt) <= 120);
  if (policyHit) {
    const d = daysBetween(today, policyHit.effectiveAt);
    const life = LIFELINE.test(policyHit.title);
    add(
      policyHit,
      life ? '个人' : '行业',
      d <= 30 ? '1 个月内' : d <= 90 ? '3 个月内' : '年内',
      life
        ? `${humanDate(policyHit.effectiveAt)} 起施行，规则变了；具体到你的那一条，建议点原文看。`
        : `${humanDate(policyHit.effectiveAt)} 起施行，主要约束机构与企业，个人短期影响有限。`
    );
  }

  // 2. 中外合作
  if (coop.items[0]) {
    const c = coop.items[0];
    add(
      c,
      '行业',
      '1-3 个月',
      `${{ 机制: '规则与机制', 投资: '产能与就业', 贸易: '订单与出货', 往来: '人员流动', 合作: '合作框架' }[c.kind] || '合作'}先动，价格和供给要过一段才传到终端。`
    );
  }

  // 3. 产业价格与产能
  const priceItem = (industry.items || []).find((i) => /(涨价|降价|价格|产能|库存|订单|出口)/.test(i.title));
  if (priceItem) add(priceItem, '两者', '1-3 个月', '价格与产能会先出现在企业报表里，再传到货架和你的账单上。');

  // 4. 科技
  if (tech.items[0]) {
    const t = tech.items[0];
    add(
      t,
      t.tag === '产品' ? '个人' : '行业',
      t.tag === '产品' ? '本周' : '明年',
      t.tag === '产品' ? '直接关系到你买不买、用不用。' : '技术侧的变化不会立刻改变你的选择，但会影响明年的价格与供给。'
    );
  }

  return rows.slice(0, 3);
}

/* ------------------------------------------------------ 今日概览 */

function buildOverview({ tech, coop, industry, consensus, day }) {
  const out = [];
  const seen = new Set();
  const add = (label, text, key) => {
    const k = titleKey(key || text);
    if (!text || seen.has(k)) return;
    seen.add(k);
    out.push({ label, text });
  };

  const policy = (day.takeaways || []).find((t) => t.label === '政策');
  if (policy) add('政策', policy.text, 'policy');
  if (tech.items[0]) add('科技', `${clip(tech.items[0].title, 38)}（${tech.items[0].short}）`, tech.items[0].title);
  if (coop.items[0]) add('合作', `${clip(coop.items[0].title, 38)}（${coop.items[0].short}）`, coop.items[0].title);
  if (industry.items[0]) add('产业', `${clip(industry.items[0].title, 38)}（${industry.items[0].short}）`, industry.items[0].title);
  if (consensus.topics[0]) {
    const c = consensus.topics[0];
    add('内外', `${c.label}：境内 ${c.zhCount} 条 / 境外 ${c.enCount} 条，${c.agree ? '语气同向' : '有明显温差'}`, c.zh.title);
  }
  return out.slice(0, 5);
}

/* --------------------------------------------- 面板七：今日总结（双线） */

function buildSummary({ gov, tech, coop, industry, impact, day, today }) {
  const people = [];
  const pro = [];

  // —— 普通人线：要不要动 → 与你最近 → 下一个节点
  const realAction = (day.actions || []).find((a) => !a.startsWith('科技面'));
  people.push({ label: '要不要动', text: realAction || '今天没有必须立刻处理的事，可以把注意力留给长期的事。' });
  const personal = (impact || []).find((r) => r.affects === '个人' || r.affects === '两者');
  if (personal) people.push({ label: '与你最近', text: `${clip(personal.title, 30)}——${personal.text}` });
  else {
    const lifeGov = (gov.recent || []).find((g) => LIFELINE.test(g.title));
    if (lifeGov) people.push({ label: '政策', text: `《${clip(lifeGov.title, 26)}》${lifeGov.effectiveAt ? `，${humanDate(lifeGov.effectiveAt)} 起施行` : ''}。` });
  }
  if (day.upcoming && day.upcoming[0]) {
    people.push({ label: '下一个节点', text: `${humanDate(day.upcoming[0].date)}（${relText(today, day.upcoming[0].date)}）起《${clip(day.upcoming[0].title, 22)}》施行。` });
  }

  // —— 从业者线：产业面 → 对外 → 技术面 → 要盯的数
  if (industry.items[0]) pro.push({ label: '产业面', text: `${clip(industry.items[0].title, 32)}（${industry.items[0].short}）` });
  if (coop.items[0]) {
    const c = coop.items[0];
    const who = [...c.where, ...c.firms].slice(0, 3).join('、') || '跨境';
    pro.push({ label: '对外', text: `${clip(c.title, 32)}｜${c.kind}类 · ${who}` });
  }
  if (tech.items[0]) pro.push({ label: '技术面', text: `${clip(tech.items[0].title, 32)}（${tech.items[0].tag}）` });
  const signal = (day.signals || []).find((s) => s.tag === 'market' || s.tag === 'macro');
  if (signal) pro.push({ label: '要盯的数', text: signal.text });
  if (!pro.length) pro.push({ label: '从业者', text: '今天没有出现值得单独标注的产业信号。' });

  return { people: people.slice(0, 3), pro: pro.slice(0, 3) };
}

/* ------------------------------------------------------------------ 出口 */

export async function analyze({ items, health, today, mode }) {
  const gov = await govPanel(items, today);
  const tech = techPanel(items, today);
  const coop = cooperationPanel(items, today, tech.items);
  const industry = industryPanel(items, today, tech.items, coop.items);
  const consensus = consensusPanel(items, today);
  const day = dayPanel({ gov, tech, consensus, items, today });
  const impact = impactPanel({ gov, tech, coop, industry, consensus, today });
  const overview = buildOverview({ tech, coop, industry, consensus, day });
  const summary = buildSummary({ gov, tech, coop, industry, impact, day, today });

  const cnH = health.filter((h) => h.region === 'cn');
  const intlH = health.filter((h) => h.region === 'intl');

  return {
    meta: {
      date: today,
      weekday: weekdayCN(today),
      generatedAt: new Date().toISOString(),
      mode,
      totalItems: items.length,
      cnSources: cnH.filter((h) => h.ok).length,
      cnSourceTotal: cnH.length,
      intlSources: intlH.filter((h) => h.ok).length,
      intlSourceTotal: intlH.length,
    },
    day,
    overview,
    impact,
    summary,
    gov,
    tech,
    coop,
    industry,
    consensus,
    health,
  };
}
