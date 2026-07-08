/**
 * 紫微斗数 AI 解盘 - Express 服务端
 * 用法: node server.js → http://localhost:3000
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { astro } = require('iztro');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 付费次数包模块
const payment = require('./payment');

// ============================================================
// 每日调用限流（免费 5 次/天 + 付费次数包）
// ============================================================
const DAILY_LIMIT = 5;
let quota = { date: '', used: 0 };

function getQuota(req) {
  const today = new Date().toISOString().slice(0, 10);
  if (quota.date !== today) { quota = { date: today, used: 0 }; }
  const clientId = payment.getClientId(req);
  const paid = payment.getPaidQuota(clientId);
  return {
    date: quota.date, used: quota.used,
    freeLimit: DAILY_LIMIT, freeRemaining: Math.max(0, DAILY_LIMIT - quota.used),
    paidRemaining: paid.paidRemaining || 0,
    totalRemaining: Math.max(0, DAILY_LIMIT - quota.used) + (paid.paidRemaining || 0),
  };
}

/** 消耗配额：优先免费，再消耗付费 */
function consumeQuota(req) {
  const q = getQuota(req);
  if (q.totalRemaining <= 0) return false;
  // 优先消耗免费
  if (q.freeRemaining > 0) { quota.used++; return true; }
  // 消耗付费
  if (q.paidRemaining > 0) { return payment.consumePaidQuota(payment.getClientId(req)); }
  return false;
}

// GET /api/quota — 前端查询剩余次数
app.get('/api/quota', (req, res) => {
  res.json(getQuota(req));
});

// ============================================================
// 时间→时辰换算 + 真太阳时校正
// ============================================================
const CITY_COORDS = {
  '北京':[116.40,39.90],'上海':[121.47,31.23],'广州':[113.26,23.13],'深圳':[114.07,22.62],
  '杭州':[120.15,30.28],'南京':[118.78,32.06],'武汉':[114.30,30.60],'成都':[104.07,30.67],
  '重庆':[106.55,29.57],'西安':[108.95,34.27],'天津':[117.20,39.13],'长沙':[112.97,28.23],
  '郑州':[113.62,34.75],'济南':[117.00,36.67],'沈阳':[123.43,41.80],'哈尔滨':[126.53,45.80],
  '昆明':[102.68,25.04],'福州':[119.30,26.08],'合肥':[117.28,31.86],'南昌':[115.86,28.68],
  '贵阳':[106.71,26.65],'兰州':[103.83,36.06],'南宁':[108.37,22.82],'海口':[110.35,20.02],
  '台北':[121.52,25.03],'香港':[114.17,22.28],'澳门':[113.55,22.19],
  '苏州':[120.59,31.30],'无锡':[120.30,31.57],'东莞':[113.75,23.05],'佛山':[113.12,23.03],
  '石家庄':[114.50,38.04],'太原':[112.55,37.87],'呼和浩特':[111.67,40.82],'长春':[125.32,43.90],
  '拉萨':[91.13,29.65],'乌鲁木齐':[87.62,43.83],'西宁':[101.78,36.62],'银川':[106.27,38.47],
};

const SHICHEN_NAMES = ['子时','丑时','寅时','卯时','辰时','巳时','午时','未时','申时','酉时','戌时','亥时'];

/**
 * 将公历时间换算为紫微斗数时辰（含真太阳时校正 + 子时跨日处理）
 * @param {string} dateString - "YYYY-MM-DD"
 * @param {string} timeString - "HH:mm"
 * @param {string|null} city - 城市名（可选）
 * @returns {{ adjustedDate: string, hourIdx: number, shichenName: string, originalTime: string, adjustedMinutes: number, correctionMinutes: number, isNextDay: boolean, description: string }}
 */
function timeToShichen(dateString, timeString, city) {
  // 1. 解析输入
  const [h, m] = timeString.split(':').map(Number);
  const clockMinutes = h * 60 + m;

  // 2. 真太阳时校正
  const lon = (city && CITY_COORDS[city]) ? CITY_COORDS[city][0] : 120;
  const correctionMinutes = (lon - 120) * 4;
  let solarMinutes = clockMinutes + correctionMinutes;

  // 3. 子时跨日处理：紫微斗数中 23:00 起属于第二天
  //    先判断原始时钟是否在 23:00+（跨日触发）
  const clockIsNextDay = h >= 23; // 23:00-23:59 → 第二天

  //    真太阳时修正后也可能跨日边界
  let isNextDay = clockIsNextDay;
  if (!clockIsNextDay && solarMinutes >= 23 * 60) {
    isNextDay = true; // 真太阳时校正把时间推到了 23:00+
  }
  if (clockIsNextDay && solarMinutes < 0) {
    isNextDay = false; // 极端情况：真太阳时把 23:xx 拉回到前一天
  }

  //    处理分钟溢出（跨天）
  if (solarMinutes < 0) {
    solarMinutes += 24 * 60;
  }
  if (solarMinutes >= 24 * 60) {
    solarMinutes -= 24 * 60;
  }

  // 4. 日期调整
  const d = new Date(dateString);
  if (isNextDay) {
    d.setDate(d.getDate() + 1);
  }
  const adjustedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 5. 真太阳分钟数 → 时辰索引 (0-11)
  //    时辰区间（以真太阳分钟计）：
  //    子时: [0, 60) 或 [1380, 1440)  → 即 00:00-00:59 或 23:00-23:59
  //    丑时: [60, 180)   → 01:00-02:59
  //    寅时: [180, 300)  → 03:00-04:59
  //    ...
  //    亥时: [1260, 1380) → 21:00-22:59
  let hourIdx;
  if (solarMinutes < 60) {
    hourIdx = 0; // 子时: 00:00-00:59
  } else if (solarMinutes >= 23 * 60) {
    hourIdx = 0; // 子时: 23:00-23:59
  } else {
    // 丑时=1 到 亥时=11：每小时对应 1 个时辰索引
    // 01:00-02:59 → index 1, 03:00-04:59 → index 2, ...
    hourIdx = Math.floor((solarMinutes - 60) / 120) + 1;
  }

  // 6. 描述
  const solarH = Math.floor(solarMinutes / 60);
  const solarM = Math.round(solarMinutes % 60);
  const correctionSign = correctionMinutes >= 0 ? '+' : '';
  const description = `输入 ${timeString}（${city || '北京'}，经度${lon.toFixed(2)}°E）`
    + ` → 真太阳时校正 ${correctionSign}${Math.round(correctionMinutes)}min`
    + ` → 真太阳时 ${String(solarH).padStart(2,'0')}:${String(solarM).padStart(2,'0')}`
    + ` → ${SHICHEN_NAMES[hourIdx]}`
    + (isNextDay ? `（日期+1天 → ${adjustedDate}）` : '');

  return {
    adjustedDate,
    hourIdx,
    shichenName: SHICHEN_NAMES[hourIdx],
    originalTime: timeString,
    adjustedMinutes: solarMinutes,
    correctionMinutes: Math.round(correctionMinutes),
    isNextDay,
    description
  };
}

// ============================================================
// 知识库加载
// ============================================================
let _kb = null;
function loadKb() {
  if (_kb) return _kb;
  const dirs = [path.join(__dirname, 'knowledge'), path.join(os.homedir(), 'Desktop', '命理知识库')];
  const load = (f) => { for (const d of dirs) { const p = path.join(d, f); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')); } return []; };
  _kb = { stars: load('palace.json'), palaces: load('stars.json'), sihua: load('sihua.json'), patterns: load('patterns.json') || {}, daxian: load('daxian.json') || null, sihuaAdvanced: load('sihua_advanced.json') || null, liuyue: load('liuyue.json') || null, hepan: load('hepan.json') || null };
  return _kb;
}

// ============================================================
// 数据清洗
// ============================================================
const PALACE_MAP = { '命宫':'命宫','兄弟':'兄弟宫','夫妻':'夫妻宫','子女':'子女宫','财帛':'财帛宫','疾厄':'疾厄宫','迁移':'迁移宫','仆役':'交友宫','官禄':'官禄宫','田宅':'田宅宫','福德':'福德宫','父母':'父母宫' };
const PALACE_NAMES = Object.keys(PALACE_MAP);

function strip(p) {
  if (!p) return null;
  return {
    name: PALACE_MAP[p.name] || p.name,
    earthlyBranch: p.earthlyBranch || '',
    heavenlyStem: p.heavenlyStem || '',
    majorStars: (p.majorStars || []).map(s => ({ name: s.name, brightness: s.brightness || '', mutagen: s.mutagen || '' })),
    minorStars: (p.minorStars || []).map(s => ({ name: s.name })),
    isEmpty: !(p.majorStars || []).length,
    isBodyPalace: !!p.isBodyPalace,
    decadalRange: p.decadal?.range ? `${p.decadal.range[0]}-${p.decadal.range[1]}岁` : '',
  };
}

function cleanData(a, gender, adjustedHour) {
  const allPalaces = PALACE_NAMES.map(n => { try { return strip(a.palace(n)); } catch { return { name: PALACE_MAP[n], error: true }; } });
  const mingPalace = allPalaces.find(p => p.name === '命宫');
  const shenPalace = allPalaces.find(p => p.isBodyPalace);
  let sanFang = {};
  try { const sf = a.surroundedPalaces('命宫'); sanFang = { target: strip(sf.target), opposite: strip(sf.opposite), wealth: strip(sf.wealth), career: strip(sf.career) }; } catch {}
  const birthSihua = allPalaces.flatMap(p => (p.majorStars || []).filter(s => s.mutagen).map(s => ({ star: s.name, type: s.mutagen, palace: p.name })));

  let horoscopeData = null;
  try { const h = a.horoscope(new Date('2026-06-15'), adjustedHour);
    horoscopeData = {
      decadal: h.decadal ? { heavenlyStem: h.decadal.heavenlyStem, earthlyBranch: h.decadal.earthlyBranch, mutagen: h.decadal.mutagen, palaceNames: h.decadal.palaceNames } : null,
      yearly: h.yearly ? { heavenlyStem: h.yearly.heavenlyStem, earthlyBranch: h.yearly.earthlyBranch, mutagen: h.yearly.mutagen, palaceNames: h.yearly.palaceNames } : null
    };
  } catch {}

  return {
    basic: { solarDate: a.solarDate, lunarDate: a.lunarDate, chineseDate: a.chineseDate, gender, fiveElements: a.fiveElementsClass, sign: a.sign, zodiac: a.zodiac },
    mingPalace, shenPalace: shenPalace || { name: '未知' }, sanFangSiZheng: sanFang, birthSihua, allPalaces, horoscopeData
  };
}

// ============================================================
// 知识检索
// ============================================================
function retrieveKnowledge(data) {
  const kb = loadKb();
  const k = { stars: {}, palaces: {}, sihua: {}, patterns: [] };

  for (const p of data.allPalaces) {
    const base = p.name.replace('宫', '');
    const m = kb.palaces.find(x => x.palace_name === base);
    if (m) k.palaces[p.name] = m;
  }
  const allStars = new Set(data.allPalaces.flatMap(p => (p.majorStars || []).map(s => s.name)));
  for (const s of allStars) { const m = kb.stars.find(x => x.star_name === s); if (m) k.stars[s] = m; }
  for (const s of data.birthSihua) { const m = kb.sihua.find(x => x.sihua_name === `化${s.type}`); if (m && !k.sihua[`化${s.type}`]) k.sihua[`化${s.type}`] = m; }

  // 大限知识检索
  if (kb.daxian && data.horoscopeData) {
    k.daxian = kb.daxian;
    k.sihuaAdvanced = kb.sihuaAdvanced;
    if (kb.liuyue) k.liuyue = kb.liuyue;
    if (kb.hepan) k.hepan = kb.hepan;
  }

  // 简单格局匹配
  const allPS = new Set(data.allPalaces.flatMap(p => (p.majorStars || []).map(s => s.name)));
  for (const cat of ['吉格', '凶格']) {
    for (const pat of (kb.patterns[cat] || [])) {
      let score = 0; const cond = pat.condition || '';
      for (const star of ['紫微','天机','太阳','武曲','天同','廉贞','天府','太阴','贪狼','巨门','天相','天梁','七杀','破军'])
        { if (cond.includes(star) && allPS.has(star)) score++; }
      if (score >= 2) k.patterns.push({ type: cat, ...pat });
    }
  }
  return k;
}

// ============================================================
// Prompt 组装
// ============================================================
// 模块子 Prompt
const MODULE_PROMPTS = {
  overview: `
你现在只需要输出【命盘概览】这一个模块。
要求：
- 用3-5句话总结命盘整体气质和人生主题
- 点出命宫主星及其核心特质
- 若有明显格局在此简要点出
- 给命主一个"一句话画像"
- 只输出内容，不要输出模块标题之外的任何解释文字
- 结尾附上免责声明："本内容由 AI 基于传统国学文化生成，仅供娱乐与自我探索参考，命运掌握在您自己手中。"`,

  character: `
你现在只需要输出【性格底色】这一个模块。
要求：
- 深入分析命宫主星和身宫主星带来的先天性格
- 结合辅星和煞星修饰性格细节
- 用MBTI/依恋理论等现代心理学语言类比
- 指出性格优势和盲区
- 只输出内容，不要输出模块标题之外的任何解释文字`,

  career: `
你现在只需要输出【事业财运】这一个模块。
要求：
- 分析官禄宫主星→适合的行业类型和职场角色
- 分析财帛宫主星→赚钱模式
- 结合三方四正判断事业发展路径
- 给出2-3条具体的现代职业建议
- 只输出内容，不要输出模块标题之外的任何解释文字`,

  love: `
你现在只需要输出【感情婚姻】这一个模块。
要求：
- 分析夫妻宫主星→择偶倾向和亲密关系中的核心需求
- 结合命宫与夫妻宫的关系看互动模式
- 利用合盘知识（如已提供）分析潜在匹配度
- 给出2-3条感情经营建议，用依恋理论和沟通心理学语言
- 若无伴侣则谈"适合什么样的关系"
- 只输出内容，不要输出模块标题之外的任何解释文字`,

  year: `
你现在只需要输出【近期流年】这一个模块。
要求：
- 基于大限/流年数据分析当前阶段运势趋势
- 提示需要把握的机会和需谨慎的挑战
- 化忌所在宫位=今年的成长课题
- 给出1-2条具体可行的行动建议
- 只输出内容，不要输出模块标题之外的任何解释文字`
};

function assemblePrompt(data, knowledge, module) {
  const spPath = path.join(__dirname, 'knowledge', 'system_prompt.md');
  const systemPrompt = fs.existsSync(spPath) ? fs.readFileSync(spPath, 'utf-8') : '你是一位紫微斗数命理师。';

  let kb = '\n\n## 知识库摘要（自动检索）\n\n';
  const mingStars = data.mingPalace?.majorStars || [];
  if (mingStars.length) {
    kb += '### 命宫主星\n\n';
    for (const s of mingStars) {
      const info = knowledge.stars[s.name];
      if (info) kb += `**${s.name}**（${s.brightness}）${s.mutagen ? '化'+s.mutagen : ''}\n- 天性: ${info.nature}\n- 入命: ${info.in_ming_palace}\n\n`;
    }
  }
  if (data.birthSihua.length) {
    kb += '### 本命四化\n\n';
    for (const s of data.birthSihua) {
      const info = knowledge.sihua[`化${s.type}`];
      if (info) kb += `**${s.star}化${s.type}** 在${s.palace}: ${info.basic_meaning}\n\n`;
    }
  }
  // 大限知识（叠宫 + 四化飞星 + 古籍参考）
  if (knowledge.daxian && data.horoscopeData?.decadal) {
    kb += '### 大限解读参考\n\n';
    const d = knowledge.daxian;
    const decadalPalace = data.horoscopeData.decadal;
    const birthYear = parseInt(data.basic.solarDate?.split('-')[0] || '1990');
    const age = new Date().getFullYear() - birthYear;
    const currentPalace = data.allPalaces.find(p => {
      const range = p.decadalRange?.match(/\d+/g);
      if (!range) return false;
      const start = parseInt(range[0]);
      return age >= start && age < start + 10;
    });
    if (currentPalace && d.piles[currentPalace.name]) {
      kb += `**当前大限叠${currentPalace.name}**: ${d.piles[currentPalace.name]}\n\n`;
    }
    if (decadalPalace.mutagen && decadalPalace.mutagen.length === 4) {
      kb += `**大限四化**: 化禄-${decadalPalace.mutagen[0]} / 化权-${decadalPalace.mutagen[1]} / 化科-${decadalPalace.mutagen[2]} / 化忌-${decadalPalace.mutagen[3]}\n\n`;
    }
    if (d.key_principles) {
      kb += '**核心断法**:\n';
      for (const p of d.key_principles.slice(0, 3)) kb += `- ${p}\n`;
      kb += '\n';
    }
  }
  // 高级四化理论
  if (knowledge.sihuaAdvanced) {
    const sa = knowledge.sihuaAdvanced;
    const trigger = sa.trigger_rules?.['key_insight'];
    if (trigger) kb += `**四化要诀**: ${trigger}\n\n`;
    if (sa.ancient_verses?.length) {
      const v = sa.ancient_verses[0];
      kb += `**古籍参考**（${v.source}）: "${v.text}" — ${v.explanation}\n\n`;
    }
  }
  // 合盘知识（感情婚姻模块参考）
  if (knowledge.hepan) {
    kb += '### 合盘婚恋参考\n\n';
    const hp = knowledge.hepan;
    // 星曜匹配：找到命宫主星和夫妻宫主星的配对
    const mingStar = data.mingPalace?.majorStars?.[0]?.name;
    const fuqiStar = data.allPalaces?.find(p => p.name === '夫妻宫')?.majorStars?.[0]?.name;
    if (mingStar && fuqiStar) {
      const key1 = `${mingStar}_${fuqiStar}`;
      const key2 = `${fuqiStar}_${mingStar}`;
      const match = hp.star_matching?.[key1] || hp.star_matching?.[key2];
      if (match) {
        kb += `**命宫${mingStar} × 夫妻宫${fuqiStar}**: ⭐${match.score}/5 — ${match.mode}

`;
      }
    }
    // 互为夫妻宫提示
    if (mingStar && fuqiStar && mingStar === fuqiStar) {
      kb += `💫 命宫与夫妻宫同星，自我期待与择偶标准高度一致——你寻找的其实是另一个自己。

`;
    }
    // 桃花星提示
    const allMinor = data.allPalaces?.flatMap(p => (p.minorStars || []).map(s => s.name)) || [];
    const taohuaHits = ['红鸾','天喜','咸池','天姚'].filter(t => allMinor.includes(t));
    if (taohuaHits.length > 0) {
      kb += `🌸 命盘桃花星: ${taohuaHits.join('、')}。${hp.taohua_weight?.['红鸾天喜同宫对拱']?.slice(0,50)}...

`;
    }
    // 伦理边界
    if (hp.ethics?.['核心原则']) {
      kb += `**合盘伦理**: ${hp.ethics['核心原则']}

`;
    }
  }
  if (knowledge.liuyue) {
    const ly = knowledge.liuyue;
    kb += '### 流月运势参考\n\n';
    if (ly.monthly_sihua_rules?.core_rule) {
      kb += `**核心原则**: ${ly.monthly_sihua_rules.core_rule}\n\n`;
    }
    if (ly.monthly_sihua_rules?.trigger_levels) {
      kb += `**应期判断**: ${ly.monthly_sihua_rules.trigger_levels}\n\n`;
    }
    if (ly.ancient_verses?.length) {
      const v0 = ly.ancient_verses[0];
      kb += `**斗君口诀**（${v0.source}）: "${v0.text}"\n\n`;
    }
  }
  if (knowledge.patterns.length) {
    kb += '### 匹配格局\n\n';
    for (const p of knowledge.patterns) kb += `**${p.pattern_name}**（${p.type}）: ${(p.interpretation||'').slice(0,200)}...\n\n`;
  }

  const userMessage = [
    '请根据以下紫微斗数命盘数据进行解读。',
    '',
    '## 命盘数据',
    '```json',
    JSON.stringify(data, null, 2),
    '```',
    '',
    kb,
    '',
    (MODULE_PROMPTS[module] || '请进行完整解读，包含五个模块。'),
  ].join('\n');

  return { systemPrompt, userMessage };
}

// ============================================================
// API: POST /api/chart — 执行排盘 + 清洗 + 检索，返回精简 JSON
// ============================================================
// 兼容旧参数（向后兼容）：也接受 birthDate + hourIdx
app.post('/api/chart', (req, res) => {
  try {
    // 限流检查
    if (!consumeQuota(req)) {
      const q = getQuota(req);
      return res.status(429).json({
        error: '今日免费额度已用完，请明天再来或购买付费次数包继续探索命盘 🌙',
        quota: q,
        canPurchase: true,
      });
    }
    const { solar_date, time, city, gender, birthDate, hourIdx } = req.body;

    let adjustedDate, shichenIdx, shichenName, correctionInfo;

    if (solar_date && time !== undefined) {
      // 新格式：solar_date + time
      if (!gender) return res.status(400).json({ error: '缺少必填参数 gender' });
      const result = timeToShichen(solar_date, time, city || null);
      adjustedDate = result.adjustedDate;
      shichenIdx = result.hourIdx;
      shichenName = result.shichenName;
      correctionInfo = result;
      console.log(`  ⏰ ${result.description}`);
    } else if (birthDate !== undefined && hourIdx != null) {
      // 旧格式兼容
      if (!gender) return res.status(400).json({ error: '缺少必填参数 gender' });
      adjustedDate = birthDate;
      shichenIdx = parseInt(hourIdx);
      shichenName = SHICHEN_NAMES[shichenIdx] || `索引${shichenIdx}`;
      correctionInfo = { adjustedDate, hourIdx: shichenIdx, shichenName, description: '旧格式（直接传入时辰索引）' };
    } else {
      return res.status(400).json({ error: '缺少必填参数：请提供 (solar_date + time) 或 (birthDate + hourIdx)' });
    }

    const d = new Date(adjustedDate);
    const dateStr = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    const a = astro.bySolar(dateStr, shichenIdx, gender, true, 'zh-CN');

    const data = cleanData(a, gender, shichenIdx);
    const knowledge = retrieveKnowledge(data);

    res.json({
      success: true,
      data,
      knowledge,
      correction: {
        adjustedDate,
        shichenIdx,
        shichenName,
        originalDate: solar_date || birthDate,
        originalTime: time || null,
        description: correctionInfo.description
      },
      palaceMap: PALACE_MAP
    });
  } catch (e) {
    console.error('/api/chart error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API: POST /api/reading — SSE 流式解读
// ============================================================
app.post('/api/reading', async (req, res) => {
  try {
    // 限流检查
    if (!consumeQuota(req)) {
      const q = getQuota(req);
      res.writeHead(429, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'error', message: '今日免费额度已用完，请明天再来或购买付费次数包继续探索命盘 🌙', quota: q, canPurchase: true })}\n\n`);
      return res.end();
    }
    const { solar_date, time, city, gender, birthDate, hourIdx, module } = req.body;

    let adjustedDate, shichenIdx, shichenName, correctionInfo;

    if (solar_date && time !== undefined) {
      if (!gender) return res.status(400).json({ error: '缺少必填参数 gender' });
      const result = timeToShichen(solar_date, time, city || null);
      adjustedDate = result.adjustedDate;
      shichenIdx = result.hourIdx;
      shichenName = result.shichenName;
      correctionInfo = result;
      console.log(`  ⏰ ${result.description} | 模块: ${module || 'overview'}`);
    } else if (birthDate !== undefined && hourIdx != null) {
      if (!gender) return res.status(400).json({ error: '缺少必填参数 gender' });
      adjustedDate = birthDate;
      shichenIdx = parseInt(hourIdx);
      shichenName = SHICHEN_NAMES[shichenIdx] || `索引${shichenIdx}`;
      correctionInfo = { adjustedDate, hourIdx: shichenIdx, shichenName, description: '旧格式（直接传入时辰索引）' };
    } else {
      return res.status(400).json({ error: '缺少必填参数：请提供 (solar_date + time) 或 (birthDate + hourIdx)' });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return res.status(500).json({ error: '服务器未配置 DEEPSEEK_API_KEY' });

    const d = new Date(adjustedDate);
    const dateStr = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    const a = astro.bySolar(dateStr, shichenIdx, gender, true, 'zh-CN');

    const data = cleanData(a, gender, shichenIdx);
    const knowledge = retrieveKnowledge(data);
    const { systemPrompt, userMessage } = assemblePrompt(data, knowledge, module || 'overview');

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // 先发送清洗数据 + 换算信息
    res.write(`data: ${JSON.stringify({
      type: 'chart',
      data,
      correction: {
        adjustedDate,
        shichenIdx,
        shichenName,
        originalDate: solar_date || birthDate,
        originalTime: time || null,
        description: correctionInfo.description
      }
    })}\n\n`);

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], stream: true, temperature: 0.7, max_tokens: 4096 })
    });

    if (!response.ok) { res.write(`data: ${JSON.stringify({ type: 'error', message: `DeepSeek API ${response.status}` })}\n\n`); return res.end(); }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const d2 = trimmed.slice(6);
        if (d2 === '[DONE]') { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); continue; }
        try {
          const j = JSON.parse(d2);
          const content = j.choices?.[0]?.delta?.content;
          if (content) res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
        } catch {}
      }
    }
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    res.end();
  }
});

// ============================================================
// 高级 API 公共辅助
// ============================================================
function calcChart(solar_date, time, city, gender) {
  const { adjustedDate, hourIdx: shichenIdx, shichenName, description } = timeToShichen(solar_date, time, city || null);
  const d = new Date(adjustedDate);
  const dateStr = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const a = astro.bySolar(dateStr, shichenIdx, gender, true, 'zh-CN');
  const data = cleanData(a, gender, shichenIdx);
  const knowledge = retrieveKnowledge(data);
  return { astrolabe: a, data, knowledge, adjustedDate, shichenIdx, shichenName, description };
}

async function sseStream(res, fn) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  try { await fn(); } catch (e) { res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`); }
  res.end();
}

async function deepseekStream(res, systemPrompt, userMessage) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) { res.write(`data: ${JSON.stringify({ type: 'error', message: '服务器未配置 DEEPSEEK_API_KEY' })}\n\n`); return; }
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], stream: true, temperature: 0.7, max_tokens: 4096 })
  });
  if (!response.ok) { res.write(`data: ${JSON.stringify({ type: 'error', message: `DeepSeek API ${response.status}` })}\n\n`); return; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim(); if (!t || !t.startsWith('data: ')) continue;
      const d2 = t.slice(6); if (d2 === '[DONE]') { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); continue; }
      try { const j = JSON.parse(d2); const c = j.choices?.[0]?.delta?.content; if (c) res.write(`data: ${JSON.stringify({ type: 'text', content: c })}\n\n`); } catch {}
    }
  }
}

// ============================================================
// 高级 API 1: 十年大限深度推演
// ============================================================
app.post('/api/advanced/daxian', async (req, res) => {
  await sseStream(res, async () => {
    const { solar_date, time, city, gender } = req.body;
    if (!solar_date || !time || !gender) { res.write(`data: ${JSON.stringify({ type: 'error', message: '缺少必填参数' })}\n\n`); return; }

    const { data, knowledge } = calcChart(solar_date, time, city, gender);
    if (!data.horoscopeData?.decadal) { res.write(`data: ${JSON.stringify({ type: 'error', message: '无法获取大限数据' })}\n\n`); return; }

    // 构建大限详情
    const birthYear = parseInt(data.basic.solarDate?.split('-')[0]);
    const age = new Date().getFullYear() - birthYear;
    const currentPalace = data.allPalaces.find(p => {
      const range = p.decadalRange?.match(/\d+/g);
      if (!range) return false;
      return age >= parseInt(range[0]) && age < parseInt(range[0]) + 10;
    });
    const allPalaces = data.allPalaces.map(p => ({
      name: p.name, majorStars: p.majorStars.map(s => `${s.name}(${s.brightness})${s.mutagen ? '化' + s.mutagen : ''}`).join('、') || '空宫',
      decadalRange: p.decadalRange
    }));

    // 知识库摘要
    let kb = '';
    const dk = knowledge.daxian;
    if (currentPalace && dk?.piles?.[currentPalace.name]) kb += `### 当前大限叠宫\n${dk.piles[currentPalace.name]}\n\n`;
    if (dk?.sihua_into_palace) {
      const dec = data.horoscopeData.decadal;
      if (dec.mutagen) {
        kb += `### 大限四化飞星\n大限四化：化禄(${dec.mutagen[0]}) / 化权(${dec.mutagen[1]}) / 化科(${dec.mutagen[2]}) / 化忌(${dec.mutagen[3]})\n\n`;
        ['化禄','化权','化科','化忌'].forEach((h, i) => {
          const star = dec.mutagen[i];
          const starPalaces = data.allPalaces.filter(p => p.majorStars.some(s => s.name === star));
          starPalaces.forEach(sp => {
            const meaning = dk.sihua_into_palace[h]?.[sp.name];
            if (meaning) kb += `**${star}${h}入${sp.name}**: ${meaning}\n\n`;
          });
        });
      }
    }
    if (dk?.key_principles) { kb += '### 核心断法\n' + dk.key_principles.map(p => `- ${p}`).join('\n') + '\n\n'; }

    const promo = `\n\n${'—'.repeat(20)}\n💎 以上为免费版大限概览。解锁完整「十年大限深度推演」报告，含三方四正叠加分析、四化飞星逐宫精解、每一年流年应期。\n👉 请关注公众号/小程序获取完整版。`;

    const sp = (knowledge.sihuaAdvanced?.ancient_verses?.[0] || {}).text || '';
    const prompt = [
      '你是一位紫微斗数大限推演专家。请对以下命盘进行十年大限深度解读。',
      '', '## 命盘数据', '```json', JSON.stringify({ basic: data.basic, mingPalace: data.mingPalace, allPalaces, horoscopeData: data.horoscopeData }), '```',
      '', kb,
      '', '请按以下结构输出：',
      '1. **当前大限概述**：大限宫位+叠宫关系+核心主题',
      '2. **三方四正分析**：财帛宫/官禄宫/迁移宫对本大限的影响',
      '3. **四化飞星详解**：大限禄权科忌的含义和注意事项',
      '4. **关键年份提示**：此十年内哪些流年需要重点关注',
      '5. **行动建议**：此十年的核心策略',
      '', '参考古籍：' + sp,
      '', promo
    ].join('\n');

    const sysPrompt = '你是紫微斗数大限分析专家。语气温暖专业，忌用恐吓性词汇，结尾必须附：「本内容由 AI 基于传统国学文化生成，仅供娱乐与自我探索参考，命运掌握在您自己手中。」';
    res.write(`data: ${JSON.stringify({ type: 'meta', age, daxianPalace: currentPalace?.name || '未知', fourElements: data.basic.fiveElements })}\n\n`);
    await deepseekStream(res, sysPrompt, prompt);
  });
});

// ============================================================
// 高级 API 2: 流月精批
// ============================================================
app.post('/api/advanced/liuyue', async (req, res) => {
  await sseStream(res, async () => {
    const { solar_date, time, city, gender, target_year } = req.body;
    if (!solar_date || !time || !gender) { res.write(`data: ${JSON.stringify({ type: 'error', message: '缺少必填参数' })}\n\n`); return; }

    const { data, knowledge, astrolabe, shichenIdx } = calcChart(solar_date, time, city, gender);
    const targetYear = parseInt(target_year) || new Date().getFullYear() + 1;

    // 排流年斗君
    const yearBranchIdx = targetYear % 12; // 简化：流年地支索引
    const SHENGXIAO = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
    const yearBranch = SHENGXIAO[yearBranchIdx];

    // 斗君推算：流年支上起子时，逆数至生时
    const BRANCH_ORDER = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
    const yearBranchPos = BRANCH_ORDER.indexOf(yearBranch);
    let doujunPos = yearBranchPos;
    for (let i = 0; i < shichenIdx; i++) {
      doujunPos = (doujunPos - 1 + 12) % 12; // 逆时针
    }
    const doujunBranch = BRANCH_ORDER[doujunPos];

    // 构造12个月概要
    const PALACE_LABELS = ['命宫','兄弟宫','夫妻宫','子女宫','财帛宫','疾厄宫','迁移宫','交友宫','官禄宫','田宅宫','福德宫','父母宫'];
    let monthlySummary = '';
    for (let m = 0; m < 12; m++) {
      const monthPalaceIdx = (doujunPos + m) % 12;
      const palaceName = PALACE_LABELS[monthPalaceIdx] || '未知';
      monthlySummary += `${m + 1}月 → 流月命宫：${palaceName}\n`;
    }

    // 知识库
    let kb = '';
    if (knowledge.liuyue) {
      const ly = knowledge.liuyue;
      if (ly.monthly_sihua_rules?.core_rule) kb += `### 流月核心原则\n${ly.monthly_sihua_rules.core_rule}\n\n`;
      if (ly.monthly_palace_piles) {
        kb += '### 流月叠宫参考\n';
        for (const [k, v] of Object.entries(ly.monthly_palace_piles).slice(0, 6)) kb += `- ${k}: ${v}\n`;
        kb += '\n';
      }
    }

    const promo = `\n\n${'—'.repeat(20)}\n💎 以上为免费版流月概览。解锁完整「${targetYear}年流月精批」报告，含每月禁忌吉日、四化飞星逐月详批、重大决策建议日期。\n👉 请关注公众号/小程序获取完整版。`;

    const prompt = [
      `请对以下命盘进行${targetYear}年（${yearBranch}年）流月运势精批。`,
      `命主当前年龄约${new Date().getFullYear() - parseInt(data.basic.solarDate?.split('-')[0])}岁，处于${data.basic.fiveElements}。`,
      '', '## 命盘数据', '```json', JSON.stringify({ basic: data.basic, mingPalace: data.mingPalace, birthSihua: data.birthSihua }), '```',
      '', `## 斗君推算\n流年${yearBranch}年，斗君在${doujunBranch}宫，正月命宫起${doujunBranch}，顺排十二流月：\n${monthlySummary}`,
      '', kb,
      '', '请按以下结构输出：',
      `1. **${targetYear}年运势总览**：用3句话概括全年运势基调`,
      '2. **重点月份提醒**：挑出最重要的3-4个月份，说明原因',
      '3. **每月一句话**：1月到12月各一句核心提示',
      '4. **年度行动建议**：今年的核心策略',
      '', promo
    ].join('\n');

    const sysPrompt = '你是紫微斗数流月分析专家。简洁精准，忌废话。结尾附免责声明。';
    res.write(`data: ${JSON.stringify({ type: 'meta', targetYear, yearBranch, doujunBranch, monthSummary: monthlySummary })}\n\n`);
    await deepseekStream(res, sysPrompt, prompt);
  });
});

// ============================================================
// 高级 API 3: 双人合盘解读
// ============================================================
app.post('/api/advanced/hepan', async (req, res) => {
  await sseStream(res, async () => {
    const { user1, user2, relation } = req.body;
    if (!user1 || !user2) { res.write(`data: ${JSON.stringify({ type: 'error', message: '缺少 user1 或 user2 参数' })}\n\n`); return; }

    // 计算两人命盘
    const c1 = calcChart(user1.solar_date, user1.time, user1.city, user1.gender);
    const c2 = calcChart(user2.solar_date, user2.time, user2.city, user2.gender);
    const knowledge = c1.knowledge; // 知识库（含 hepan 匹配数据）

    const ming1 = c1.data.mingPalace?.majorStars?.map(s => s.name).join('、') || '空宫';
    const ming2 = c2.data.mingPalace?.majorStars?.map(s => s.name).join('、') || '空宫';
    const fuqi1 = c1.data.allPalaces?.find(p => p.name === '夫妻宫')?.majorStars?.map(s => s.name).join('、') || '空宫';
    const fuqi2 = c2.data.allPalaces?.find(p => p.name === '夫妻宫')?.majorStars?.map(s => s.name).join('、') || '空宫';

    // 星曜匹配
    let matchInfo = '';
    if (knowledge.hepan?.star_matching) {
      const sm = knowledge.hepan.star_matching;
      const pairs = [];
      for (const s1 of (c1.data.mingPalace?.majorStars || [])) {
        for (const s2 of (c2.data.mingPalace?.majorStars || [])) {
          const key = `${s1.name}_${s2.name}`; const m = sm[key] || sm[`${s2.name}_${s1.name}`];
          if (m) pairs.push(`**${s1.name} × ${s2.name}**: ⭐${m.score}/5 — ${m.mode}`);
        }
      }
      if (pairs.length) matchInfo = '### 星曜匹配\n' + pairs.join('\n\n') + '\n\n';
    }

    // 互为夫妻宫检测
    const singleStars1 = (c1.data.mingPalace?.majorStars || []).map(s => s.name);
    const singleStars2 = (c2.data.mingPalace?.majorStars || []).map(s => s.name);
    const fuqiStars1 = (c1.data.allPalaces?.find(p => p.name === '夫妻宫')?.majorStars || []).map(s => s.name);
    const fuqiStars2 = (c2.data.allPalaces?.find(p => p.name === '夫妻宫')?.majorStars || []).map(s => s.name);
    const mutual1 = singleStars1.some(s => fuqiStars2.includes(s));
    const mutual2 = singleStars2.some(s => fuqiStars1.includes(s));
    if (mutual1 && mutual2) matchInfo += '💫 **互为夫妻宫**：双方互为核心理想型，属于天作之合的配置。\n\n';
    else if (mutual1) matchInfo += '💡 甲方命宫匹配乙方夫妻宫，但反向不成立——甲是乙的理想型，但乙并非甲的菜。\n\n';

    // 四化互飞
    const sihua1 = c1.data.birthSihua || [];
    const sihua2 = c2.data.birthSihua || [];
    if (sihua1.length && sihua2.length) {
      matchInfo += '### 本命四化对比\n';
      matchInfo += `甲方四化: ${sihua1.map(s => `${s.star}化${s.type}(${s.palace})`).join(' | ')}\n`;
      matchInfo += `乙方四化: ${sihua2.map(s => `${s.star}化${s.type}(${s.palace})`).join(' | ')}\n\n`;
    }

    const relationLabel = { lover: '情侣', partner: '合伙人', parent_child: '亲子' }[relation] || '综合关系';

    const promo = `\n\n${'—'.repeat(20)}\n💎 以上为免费版合盘概览。解锁完整「双人合盘深度解读」报告，含四化互飞详批、大限同步分析、桃花星/煞星权重评估、${relationLabel}专属相处策略。\n👉 请关注公众号/小程序获取完整版。`;

    const prompt = [
      `请对以下两人的命盘进行${relationLabel}合盘解读。`,
      '', '## 甲方命盘（核心数据）', '```json',
      JSON.stringify({
        basic: c1.data.basic, mingPalace: c1.data.mingPalace,
        fuqiPalace: c1.data.allPalaces?.find(p => p.name === '夫妻宫'),
        birthSihua: c1.data.birthSihua
      }), '```',
      '', '## 乙方命盘（核心数据）', '```json',
      JSON.stringify({
        basic: c2.data.basic, mingPalace: c2.data.mingPalace,
        fuqiPalace: c2.data.allPalaces?.find(p => p.name === '夫妻宫'),
        birthSihua: c2.data.birthSihua
      }), '```',
      '', matchInfo,
      '', '请按以下结构输出：',
      `1. **契合度总评**：给一个1-5⭐的整体评分+一句话总结`,
      '2. **性格匹配分析**：命宫主星互动如何',
      '3. **感情/合作模式**：夫妻宫（或交友宫）的匹配度',
      '4. **潜在摩擦点**：需要注意哪些领域',
      '5. **相处建议**：3条具体的相处/合作策略',
      '', `${'—'.repeat(20)}`,
      '本内容由 AI 基于传统国学文化生成，仅供娱乐与自我探索参考，命运掌握在您自己手中。',
      '', promo
    ].join('\n');

    const sysPrompt = '你是紫微斗数合盘分析专家。语气温暖理性，忌宿命论和恐吓性词汇（如"必离必克"），用"需要注意""建议沟通"等建设性表达。';
    res.write(`data: ${JSON.stringify({ type: 'meta', relation: relationLabel, ming1, ming2, fuqi1, fuqi2, mutual: mutual1 && mutual2 })}\n\n`);
    await deepseekStream(res, sysPrompt, prompt);
  });
});

// ============================================================
// 付费 API 路由
// ============================================================

// ============================================================
// 小程序专用：同步解读接口（非流式，返回完整 JSON）
// ============================================================
app.post('/api/reading/sync', async (req, res) => {
  try {
    const { solar_date, time, city, gender, birthDate, hourIdx, module } = req.body;
    if (!consumeQuota(req)) {
      return res.status(429).json({ error: '今日免费额度已用完', canPurchase: true, quota: getQuota(req) });
    }

    let adjustedDate, shichenIdx;
    if (solar_date && time !== undefined) {
      const result = timeToShichen(solar_date, time, city || null);
      adjustedDate = result.adjustedDate; shichenIdx = result.hourIdx;
    } else if (birthDate !== undefined && hourIdx != null) {
      adjustedDate = birthDate; shichenIdx = parseInt(hourIdx);
    } else {
      return res.status(400).json({ error: '缺少必填参数' });
    }

    const d = new Date(adjustedDate);
    const dateStr = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    const a = astro.bySolar(dateStr, shichenIdx, gender || '男', true, 'zh-CN');
    const data = cleanData(a, gender || '男', shichenIdx);
    const knowledge = retrieveKnowledge(data);
    const { systemPrompt, userMessage } = assemblePrompt(data, knowledge, module || 'overview');

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return res.status(500).json({ error: '服务器未配置 DEEPSEEK_API_KEY' });

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], stream: false, temperature: 0.7, max_tokens: 4096 })
    });
    const result = await response.json();
    res.json({ success: true, content: result.choices?.[0]?.message?.content || '', data, correction: { adjustedDate, shichenIdx } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 专题价格配置：每个专题消耗付费次数
const PREMIUM_COST = { decade: 3, synastry: 4, monthly: 2 };

// 加载 premium System Prompts
function loadPremiumPrompts() {
  const ppPath = path.join(__dirname, 'knowledge', 'system_prompt_premium.md');
  if (!fs.existsSync(ppPath)) return {};
  const raw = fs.readFileSync(ppPath, 'utf-8');
  const prompts = {};
  const sections = raw.split('\n---\n');
  for (const sec of sections) {
    const tagMatch = sec.match(/\[TAG:(\w+)\]/);
    if (tagMatch) prompts[tagMatch[1]] = sec.replace(/^.*\[TAG:\w+\]\s*\n?/, '').trim();
  }
  return prompts;
}
const PREMIUM_PROMPTS = loadPremiumPrompts();

// ============================================================
// 付费专题解读 API
// ============================================================
app.post('/api/reading/premium', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

  try {
    const { solar_date, time, city, gender, readingType, partner_solar_date, partner_time, partner_city, partner_gender } = req.body;
    if (!readingType || !PREMIUM_COST[readingType]) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: '无效的专题类型' })}\n\n`);
      return res.end();
    }

    const cost = PREMIUM_COST[readingType];
    const clientId = payment.getClientId(req);

    // 消耗付费次数
    if (!payment.consumeMultiplePaidQuota(clientId, cost)) {
      const pq = payment.getPaidQuota(clientId);
      res.write(`data: ${JSON.stringify({ type: 'error', message: `付费次数不足！本专题需消耗 ${cost} 次付费额度，当前剩余 ${pq.paidRemaining} 次`, code: 'INSUFFICIENT_PAID', needPurchase: true, required: cost, remaining: pq.paidRemaining })}\n\n`);
      return res.end();
    }

    // 排盘
    const chart = calcChart(solar_date, time, city, gender);
    let knowledge = chart.knowledge;
    let dataPayload = { basic: chart.data.basic, mingPalace: chart.data.mingPalace, allPalaces: chart.data.allPalaces, birthSihua: chart.data.birthSihua, horoscopeData: chart.data.horoscopeData };

    // 合盘：排出第二张盘
    if (readingType === 'synastry' && partner_solar_date && partner_time) {
      const partnerChart = calcChart(partner_solar_date, partner_time, partner_city, partner_gender);
      dataPayload.partner = {
        basic: partnerChart.data.basic,
        mingPalace: partnerChart.data.mingPalace,
        fuqiPalace: partnerChart.data.allPalaces?.find(p => p.name === '夫妻宫'),
        birthSihua: partnerChart.data.birthSihua,
      };
    }

    const systemPrompt = PREMIUM_PROMPTS[readingType] || '你是紫微斗数专家。';
    const userMessage = [
      '请根据以下命盘数据进行专题解读。',
      '', '## 命盘数据', '```json', JSON.stringify(dataPayload), '```',
      '', '请严格按照 System Prompt 要求的格式输出。',
    ].join('\n');

    // 流式
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) { res.write(`data: ${JSON.stringify({ type: 'error', message: '未配置 DEEPSEEK_API_KEY' })}\n\n`); return res.end(); }

    res.write(`data: ${JSON.stringify({ type: 'meta', readingType, cost, paidRemaining: payment.getPaidQuota(clientId).paidRemaining })}\n\n`);

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], stream: true, temperature: 0.7, max_tokens: 4096 })
    });
    if (!response.ok) { res.write(`data: ${JSON.stringify({ type: 'error', message: `DeepSeek API ${response.status}` })}\n\n`); return res.end(); }

    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim(); if (!t || !t.startsWith('data: ')) continue;
        const d2 = t.slice(6); if (d2 === '[DONE]') { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); continue; }
        try { const j = JSON.parse(d2); const c = j.choices?.[0]?.delta?.content; if (c) res.write(`data: ${JSON.stringify({ type: 'text', content: c })}\n\n`); } catch {}
      }
    }
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    res.end();
  }
});

app.post('/api/pay/order', payment.createOrder);
app.get('/api/pay/order/:orderId', payment.queryOrder);
app.post('/api/pay/callback', payment.paymentCallback);
app.get('/api/products', payment.getProducts);

// ============================================================
// 启动
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🪐 紫微斗数 AI 解盘 服务已启动`);
  console.log(`   前端: http://localhost:${PORT}`);
  console.log(`   基础: /api/chart  /api/reading(SSE)  /api/quota`);
  console.log(`   高级: /api/advanced/daxian  /liuyue  /hepan (SSE)\n`);
});
