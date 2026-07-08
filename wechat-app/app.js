// 紫微斗数 AI 小程序 - 全局状态
App({
  globalData: {
    // 用户信息
    paidQuota: 0,        // 付费剩余次数
    freeQuota: 5,        // 免费剩余次数
    totalQuota: 5,       // 总剩余次数
    // 上次解读缓存
    lastChart: null,     // 最近一次排盘数据
    lastReading: {},     // { module: content } 缓存各模块解读结果
    lastParams: null,    // 最近一次提交的参数
    // 服务器
    baseUrl: 'https://ziwei-ai-vlqb.onrender.com', // Render 线上地址
  },

  onLaunch() {
    // 启动时加载缓存和配额
    this.loadCache();
    this.fetchQuota();
  },

  async fetchQuota() {
    try {
      const res = await wx.request({
        url: this.globalData.baseUrl + '/api/quota',
        method: 'GET'
      });
      if (res.statusCode === 200) {
        const q = res.data;
        this.globalData.freeQuota = q.freeRemaining ?? (q.limit - q.used);
        this.globalData.paidQuota = q.paidRemaining || 0;
        this.globalData.totalQuota = q.totalRemaining ?? this.globalData.freeQuota;
      }
    } catch (e) {
      console.error('获取配额失败', e);
    }
  },

  loadCache() {
    try {
      const cached = wx.getStorageSync('ziwei_last_chart');
      if (cached) this.globalData.lastChart = cached;
      const params = wx.getStorageSync('ziwei_last_params');
      if (params) this.globalData.lastParams = params;
      const reading = wx.getStorageSync('ziwei_last_reading');
      if (reading) this.globalData.lastReading = reading;
    } catch (e) {}
  },

  saveCache(chart, params, reading) {
    this.globalData.lastChart = chart;
    this.globalData.lastParams = params;
    if (reading) {
      this.globalData.lastReading = { ...this.globalData.lastReading, ...reading };
    }
    try {
      if (chart) wx.setStorageSync('ziwei_last_chart', chart);
      if (params) wx.setStorageSync('ziwei_last_params', params);
      wx.setStorageSync('ziwei_last_reading', this.globalData.lastReading);
    } catch (e) {}
  },
});
