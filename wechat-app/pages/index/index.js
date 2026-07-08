// 紫微斗数 AI 小程序 - 首页逻辑
const app = getApp();
const API = require('../../utils/api');

Page({
  data: {
    // 表单
    birthDate: '1990-06-15',
    birthTime: '14:30',
    gender: '男',
    city: '',
    today: '',
    // 结果
    showResult: false,
    chartData: null,
    chartBasicInfo: '',
    palaceGrid: [],
    readingContent: '',
    activeTab: 'overview',
    loading: false,
    // 配额
    totalQuota: 5,
    paidQuota: 0,
    // Tab 映射
    moduleNames: { overview: '命盘概览', character: '性格底色', career: '事业财运', love: '感情婚姻', year: '近期流年' },
    readingCache: {}, // { module: richtext nodes }
  },

  onLoad() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    this.setData({ today });

    // 加载缓存
    const g = app.globalData;
    this.setData({
      totalQuota: g.totalQuota,
      paidQuota: g.paidQuota,
    });

    if (g.lastParams) {
      this.setData({
        birthDate: g.lastParams.birthDate || '1990-06-15',
        birthTime: g.lastParams.birthTime || '14:30',
        gender: g.lastParams.gender || '男',
        city: g.lastParams.city || '',
      });
    }
  },

  onShow() {
    app.fetchQuota().then(() => {
      this.setData({
        totalQuota: app.globalData.totalQuota,
        paidQuota: app.globalData.paidQuota,
      });
    });
  },

  // ─── 表单事件 ───
  onDateChange(e) { this.setData({ birthDate: e.detail.value }); },
  onTimeChange(e) { this.setData({ birthTime: e.detail.value }); },
  onGenderTap(e) { this.setData({ gender: e.currentTarget.dataset.g }); },
  onCityInput(e) { this.setData({ city: e.detail.value }); },

  // ─── 提交 ───
  async submitForm() {
    const { birthDate, birthTime, gender, city } = this.data;
    if (!birthDate || !birthTime) {
      wx.showToast({ title: '请选择出生日期和时间', icon: 'none' });
      return;
    }

    // 保存参数
    app.saveCache(null, { birthDate, birthTime, gender, city }, null);

    this.setData({
      showResult: true,
      loading: true,
      readingContent: '',
      readingCache: {},
      activeTab: 'overview',
    });

    // 先获取排盘数据
    try {
      const chartRes = await API.chart({
        solar_date: birthDate,
        time: birthTime,
        gender: gender,
        city: city || null
      });

      if (chartRes.success && chartRes.data) {
        this.buildPalaceGrid(chartRes.data);
        app.saveCache(chartRes.data, null, null);
      }

      // 加载概览模块
      await this.loadModule('overview');
    } catch (e) {
      wx.showToast({ title: '请求失败：' + (e.message || '网络错误'), icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // ─── 构建星盘图 ───
  buildPalaceGrid(data) {
    const layoutOrder = ['财帛宫','子女宫','夫妻宫','兄弟宫','命宫','父母宫','福德宫','田宅宫','官禄宫','交友宫','迁移宫','疾厄宫'];
    const palaceMap = {};
    (data.allPalaces || []).forEach(p => { palaceMap[p.name] = p; });

    const grid = layoutOrder.map(name => {
      const p = palaceMap[name];
      if (!p) return { name, stars: '-' };
      const major = (p.majorStars || []).map(s => s.name + (s.mutagen ? '(' + s.mutagen + ')' : ''));
      return {
        name: name,
        stars: p.isEmpty ? '空宫' : major.join('·'),
        isBody: p.isBodyPalace,
      };
    });

    const b = data.basic || {};
    this.setData({
      chartData: data,
      palaceGrid: grid,
      chartBasicInfo: `${b.solarDate || ''} · ${b.lunarDate || ''} · ${b.gender || ''}`,
    });
  },

  // ─── 切换 Tab ───
  async switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (this.data.activeTab === tab) return;
    this.setData({ activeTab: tab });

    // 缓存命中
    if (this.data.readingCache[tab]) {
      this.setData({ readingContent: this.data.readingCache[tab], loading: false });
      return;
    }

    await this.loadModule(tab);
  },

  // ─── 加载模块 ───
  async loadModule(module) {
    this.setData({ loading: true });
    try {
      const { birthDate, birthTime, gender, city } = this.data;
      const res = await API.readingSync({
        solar_date: birthDate,
        time: birthTime,
        gender: gender,
        city: city || null,
        module: module,
      });

      if (res.success && res.content) {
        // 简单 Markdown 转 rich-text nodes
        const nodes = this.mdToNodes(res.content);
        const cache = { ...this.data.readingCache, [module]: nodes };
        this.setData({ readingContent: nodes, readingCache: cache, loading: false });
        // 更新配额
        app.fetchQuota().then(() => {
          this.setData({
            totalQuota: app.globalData.totalQuota,
            paidQuota: app.globalData.paidQuota,
          });
        });
      } else {
        wx.showToast({ title: res.error || '解读失败', icon: 'none' });
        this.setData({ loading: false });
      }
    } catch (e) {
      wx.showToast({ title: '请求失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // ─── Markdown → rich-text nodes（简易版） ───
  mdToNodes(md) {
    const nodes = [];
    const lines = md.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // ### 标题
      if (line.startsWith('### ')) {
        nodes.push({ name: 'h3', attrs: { style: 'color:#f0d68a;margin:24rpx 0 12rpx;font-size:32rpx;font-weight:700;' }, children: [{ type: 'text', text: line.slice(4) }] });
      }
      // ## 标题
      else if (line.startsWith('## ')) {
        nodes.push({ name: 'h2', attrs: { style: 'color:#f0d68a;margin:30rpx 0 14rpx;font-size:36rpx;font-weight:700;border-bottom:1rpx solid rgba(212,168,83,0.2);padding-bottom:8rpx;' }, children: [{ type: 'text', text: line.slice(3) }] });
      }
      // **加粗** 转换
      else if (line.includes('**')) {
        const parts = line.split(/(\*\*[^*]+\*\*)/);
        const children = parts.filter(p => p).map(p => {
          if (p.startsWith('**') && p.endsWith('**'))
            return { name: 'strong', attrs: { style: 'color:#fff;' }, children: [{ type: 'text', text: p.slice(2,-2) }] };
          return { type: 'text', text: p };
        });
        nodes.push({ name: 'p', attrs: { style: 'margin:12rpx 0;line-height:1.8;' }, children });
      }
      // 列表
      else if (line.match(/^[\-\*]\s/)) {
        nodes.push({ name: 'p', attrs: { style: 'margin:8rpx 0 8rpx 20rpx;line-height:1.8;color:#d8d4e8;' }, children: [{ type: 'text', text: line.slice(2) }] });
      }
      // 分隔线
      else if (line.startsWith('---') || line.startsWith('━━━')) {
        nodes.push({ name: 'p', attrs: { style: 'border-top:1rpx solid rgba(212,168,83,0.2);margin:24rpx 0;' }, children: [] });
      }
      // 普通段落
      else if (line.trim()) {
        nodes.push({ name: 'p', attrs: { style: 'margin:12rpx 0;line-height:1.8;color:#d8d4e8;' }, children: [{ type: 'text', text: line }] });
      }
      // 空行
      else {
        nodes.push({ name: 'br', children: [] });
      }
      i++;
    }
    return nodes;
  },

  // ─── 返回 ───
  goBack() {
    this.setData({ showResult: false, readingContent: '', loading: false });
  },
});
