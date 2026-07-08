/**
 * 紫微斗数 AI 解盘 - 付费次数包模块
 * MVP 版本：内存存储 + 模拟支付，真实支付留接口对接
 */
const crypto = require('crypto');

// ============================================================
// 产品列表
// ============================================================
const PRODUCTS = {
  '10次包':  { count: 10,  price: 9.9,  name: '10次包', hot: false },
  '30次包':  { count: 30,  price: 19.9, name: '30次包', hot: true  },
  '100次包': { count: 100, price: 49.9, name: '100次包', hot: false },
};

// ============================================================
// 内存存储
// ============================================================
const orders = {};            // { orderId: orderObject }
const paidQuotas = {};        // { ip/identifier: remainingCount }

// 订单有效期 15 分钟
const ORDER_EXPIRY_MS = 15 * 60 * 1000;

// 定期清理过期订单（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [id, o] of Object.entries(orders)) {
    if (o.status === 'pending' && now - o.createdAt > ORDER_EXPIRY_MS) {
      o.status = 'expired';
      console.log(`  💰 订单 ${id.slice(0,8)} 已过期`);
    }
  }
}, 5 * 60 * 1000);

// ============================================================
// 辅助函数
// ============================================================
function getClientId(req) {
  // 优先使用 IP，后续可替换为 userId
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : (req.connection?.remoteAddress || req.ip || 'unknown');
  return ip.replace(/^::ffff:/, '');
}

/** 获取付费剩余次数 */
function getPaidQuota(clientId) {
  return { paidRemaining: paidQuotas[clientId] || 0 };
}

/** 消耗付费次数，返回是否成功 */
function consumePaidQuota(clientId) {
  const remaining = paidQuotas[clientId] || 0;
  if (remaining <= 0) return false;
  paidQuotas[clientId] = remaining - 1;
  console.log(`  💎 付费次数消耗: ${clientId} 剩余 ${remaining - 1} 次`);
  return true;
}

/** 增加付费次数 */
function addPaidQuota(clientId, count) {
  paidQuotas[clientId] = (paidQuotas[clientId] || 0) + count;
  console.log(`  💰 付费次数到账: ${clientId} +${count}，共计 ${paidQuotas[clientId]} 次`);
  return paidQuotas[clientId];
}

// ============================================================
// 订单相关 API（导出为 Express Router 中间件）
// ============================================================

/** POST /api/pay/order — 创建订单 */
function createOrder(req, res) {
  try {
    const { productType } = req.body;
    const product = PRODUCTS[productType];
    if (!product) return res.status(400).json({ error: '无效的产品类型，可选：10次包、30次包、100次包' });

    const orderId = 'ZW-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const clientId = getClientId(req);

    const order = {
      orderId,
      productType,
      amount: product.price,
      count: product.count,
      status: 'pending',
      createdAt: Date.now(),
      usedBy: clientId,
    };
    orders[orderId] = order;

    console.log(`  💰 新订单: ${orderId} | ${productType} | ¥${product.price} | ${clientId}`);

    // 生成占位二维码 URL（真实支付时替换为微信/支付宝支付链接）
    const qrcodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=PAY_${orderId}`;

    res.json({
      success: true,
      orderId,
      amount: product.price,
      count: product.count,
      productName: product.name,
      qrcodeUrl,
      expiresIn: '15分钟',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** GET /api/pay/order/:orderId — 查询订单状态 */
function queryOrder(req, res) {
  const { orderId } = req.params;
  const order = orders[orderId];
  if (!order) return res.status(404).json({ error: '订单不存在' });

  // 检查是否过期
  if (order.status === 'pending' && Date.now() - order.createdAt > ORDER_EXPIRY_MS) {
    order.status = 'expired';
  }

  res.json({
    orderId: order.orderId,
    productType: order.productType,
    amount: order.amount,
    count: order.count,
    status: order.status,
    createdAt: new Date(order.createdAt).toISOString(),
  });
}

/** POST /api/pay/callback — 模拟支付回调（MVP版本） */
function paymentCallback(req, res) {
  try {
    const { orderId } = req.body;
    const order = orders[orderId];

    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.status === 'expired') return res.status(400).json({ error: '订单已过期，请重新下单' });
    if (order.status === 'paid') return res.status(400).json({ error: '订单已支付，无需重复支付' });

    // 标记已支付并发放次数
    order.status = 'paid';
    const totalPaid = addPaidQuota(order.usedBy, order.count);

    console.log(`  ✅ 支付成功: ${orderId} | +${order.count}次 | 共计 ${totalPaid} 次`);

    res.json({
      success: true,
      message: `支付成功！已到账 ${order.count} 次付费额度`,
      orderId,
      count: order.count,
      paidRemaining: totalPaid,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** GET /api/products — 查询产品列表 */
function getProducts(_req, res) {
  const list = Object.entries(PRODUCTS).map(([key, p]) => ({
    productType: key,
    name: p.name,
    count: p.count,
    price: p.price,
    hot: p.hot,
  }));
  res.json({ products: list });
}

module.exports = {
  // 配额相关
  getPaidQuota,
  consumePaidQuota,
  getClientId,
  // 路由处理函数
  createOrder,
  queryOrder,
  paymentCallback,
  getProducts,
};
