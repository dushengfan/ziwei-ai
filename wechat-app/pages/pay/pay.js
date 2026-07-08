// 紫微斗数 AI 小程序 - 购买页
const app = getApp();
const API = require('../../utils/api');

Page({
  data: {
    packages: [
      { type: '10次包',  name: '10次包',  price: 9.9,  count: 10,  desc: '适合轻度探索', hot: false },
      { type: '30次包',  name: '30次包',  price: 19.9, count: 30,  desc: '🔥 最受欢迎',   hot: true  },
      { type: '100次包', name: '100次包', price: 49.9, count: 100, desc: '深度玩家首选', hot: false },
    ],
    selectedIdx: -1,
    paidQuota: 0,
  },

  onShow() {
    app.fetchQuota().then(() => {
      this.setData({ paidQuota: app.globalData.paidQuota });
    });
  },

  selectPackage(e) {
    const idx = e.currentTarget.dataset.idx;
    this.setData({ selectedIdx: this.data.selectedIdx === idx ? -1 : idx });
  },

  async doPay(e) {
    const productType = e.currentTarget.dataset.type;

    wx.showLoading({ title: '创建订单中...' });
    try {
      // 创建订单
      const order = await API.createOrder(productType);
      wx.hideLoading();

      if (!order.success) {
        wx.showToast({ title: order.error || '下单失败', icon: 'none' });
        return;
      }

      // 模拟支付
      wx.showLoading({ title: '模拟支付中...' });
      const result = await API.paymentCallback(order.orderId);
      wx.hideLoading();

      if (result.success) {
        wx.showToast({ title: `购买成功！+${result.count}次`, icon: 'success' });
        this.setData({ selectedIdx: -1 });
        // 刷新配额
        app.fetchQuota().then(() => {
          this.setData({ paidQuota: app.globalData.paidQuota });
        });
      } else {
        wx.showToast({ title: result.error || '支付失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  // ─── 微信支付（预留接口，待商户号开通后启用） ───
  async wxPay(productType) {
    // 1. 调后端创建订单
    // const order = await API.createOrder(productType);
    // 2. 调微信支付
    // wx.requestPayment({
    //   timeStamp: order.timeStamp,
    //   nonceStr: order.nonceStr,
    //   package: order.package,
    //   signType: 'RSA',
    //   paySign: order.paySign,
    //   success: () => { /* 支付成功 */ },
    //   fail: () => { /* 支付失败 */ },
    // });
  },
});
