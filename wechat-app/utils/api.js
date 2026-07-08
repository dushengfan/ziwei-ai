// 紫微斗数 AI 小程序 - API 封装
const BASE = 'https://ziwei-ai-vlqb.onrender.com';

/** 通用 GET 请求 */
function get(path) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
      method: 'GET',
      success: res => resolve(res.data),
      fail: err => reject(err),
    });
  });
}

/** 通用 POST 请求 */
function post(path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: data,
      success: res => {
        if (res.statusCode === 429) {
          resolve({ ...res.data, _quotaExhausted: true });
        } else {
          resolve(res.data);
        }
      },
      fail: err => reject(err),
    });
  });
}

/** 获取配额 */
function quota() {
  return get('/api/quota');
}

/** 获取排盘数据 */
function chart(params) {
  return post('/api/chart', params);
}

/** 同步解读（小程序用，非流式） */
function readingSync(params) {
  return post('/api/reading/sync', params);
}

/** 创建订单 */
function createOrder(productType) {
  return post('/api/pay/order', { productType });
}

/** 支付回调 */
function paymentCallback(orderId) {
  return post('/api/pay/callback', { orderId });
}

module.exports = {
  BASE,
  get,
  post,
  quota,
  chart,
  readingSync,
  createOrder,
  paymentCallback,
};
