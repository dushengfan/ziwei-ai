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

// ============================================================
// 每日调用限流（内存计数，每日 5 次，午夜重置）
// ============================================================
const DAILY_LIMIT = 5;
let quota = { date: '', used: 0 };

function getQuota() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (quota.date !== today) {
    quota = { date: today, used: 0 };
    console.log(`  📅 新的一天，配额重置为 ${DAILY_LIMIT} 次`);
  }
  return { date: quota.date, used: quota.used, remaining: Math.max(0, DAILY_LIMIT - quota.used), limit: DAILY_LIMIT };
}

function consumeQuota() {
  const q = getQuota();
  if (q.remaining <= 0) return false;
  quota.used++;
  console.log(`  🎫 已用 ${quota.used}/${DAILY_LIMIT} 次，剩余 ${DAILY_LIMIT - quota.used} 次`);
  return true;
}

// GET /api/quota — 前端查询剩余次数
app.get('/api/quota', (_req, res) => {
  res.json(getQuota());
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
  _kb = { stars: load('palace.json'), palaces: load('stars.json'), sihua: load('sihua.json'), patterns: load('patterns.json') || {}, daxian: load('daxian.json') || null, sihuaAdvanced: load('sihua_advanced.json') || null };
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
function assemblePrompt(data, knowledge) {
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
  if (knowledge.patterns.length) {
    kb += '### 匹配格局\n\n';
    for (const p of knowledge.patterns) kb += `**${p.pattern_name}**（${p.type}）: ${(p.interpretation||'').slice(0,200)}...\n\n`;
  }

  const userMessage = [
    '请根据以下紫微斗数命盘数据进行完整解读。',
    '',
    '## 命盘数据',
    '```json',
    JSON.stringify(data, null, 2),
    '```',
    '',
    kb,
    '',
    '请严格按照 System Prompt 要求的五个模块（【命盘概览】→【性格底色】→【事业财运】→【感情婚姻】→【近期流年】）进行完整解读，并在结尾附上免责声明。'
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
    if (!consumeQuota()) {
      return res.status(429).json({ error: '今日免费额度已用完（每日5次），请明天再来探索命盘 🌙', quota: getQuota() });
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
    if (!consumeQuota()) {
      res.writeHead(429, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'error', message: '今日免费额度已用完（每日5次），请明天再来探索命盘 🌙', quota: getQuota() })}\n\n`);
      return res.end();
    }
    const { solar_date, time, city, gender, birthDate, hourIdx } = req.body;

    let adjustedDate, shichenIdx, shichenName, correctionInfo;

    if (solar_date && time !== undefined) {
      if (!gender) return res.status(400).json({ error: '缺少必填参数 gender' });
      const result = timeToShichen(solar_date, time, city || null);
      adjustedDate = result.adjustedDate;
      shichenIdx = result.hourIdx;
      shichenName = result.shichenName;
      correctionInfo = result;
      console.log(`  ⏰ ${result.description}`);
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
    const { systemPrompt, userMessage } = assemblePrompt(data, knowledge);

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
// 启动
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🪐 紫微斗数 AI 解盘 服务已启动`);
  console.log(`   前端: http://localhost:${PORT}`);
  console.log(`   API:  http://localhost:${PORT}/api/chart`);
  console.log(`         http://localhost:${PORT}/api/reading (SSE)\n`);
});
