// pages/index/index.js
Page({
  data: {},

  onWebLoad(e) {
    console.log('页面加载成功', e);
  },

  onWebError(e) {
    console.error('页面加载失败', e);
    wx.showToast({ title: '加载失败，请重试', icon: 'none' });
  }
});
