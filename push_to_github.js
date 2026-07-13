/**
 * GitHub API 一键推送脚本（无需安装 Git）
 */
const fs = require('fs');
const path = require('path');

const USERNAME = 'dushengfan';
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'ziwei-ai';
const BASE = 'https://api.github.com';
const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

const FILES = [
  'package.json',
  'package-lock.json',
  'server.js',
  '.gitignore',
  'public/index.html',
  'knowledge/palace.json',
  'knowledge/stars.json',
  'knowledge/sihua.json',
  'knowledge/patterns.json',
  'knowledge/daxian.json',
  'knowledge/sihua_advanced.json',
  'knowledge/liuyue.json',
  'knowledge/hepan.json',
  'knowledge/system_prompt.md',
  'knowledge/system_prompt_premium.md',
  'AGENTS.md',
  'render.yaml',
  'payment.js',
  'push_to_github.js',
  'wechat-app/app.json',
  'wechat-app/app.js',
  'wechat-app/sitemap.json',
  'wechat-app/project.config.json',
  'wechat-app/pages/index/index.json',
  'wechat-app/pages/index/index.wxml',
  'wechat-app/pages/index/index.wxss',
  'wechat-app/pages/index/index.js',
  'wechat-app/pages/pay/pay.json',
  'wechat-app/pages/pay/pay.wxml',
  'wechat-app/pages/pay/pay.wxss',
  'wechat-app/pages/pay/pay.js',
  'wechat-app/utils/api.js',
];

async function api(method, endpoint, body = null) {
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${endpoint}`, opts);
  const text = await res.text();
  if (!res.ok && res.status !== 422) {
    throw new Error(`${method} ${endpoint} → ${res.status}: ${text.slice(0,200)}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  console.log('🚀 开始部署到 GitHub...\n');

  // 1. 检查仓库
  console.log('📦 检查仓库...');
  try {
    const check = await api('GET', `/repos/${USERNAME}/${REPO}`);
    console.log(`   ✅ 仓库已存在: ${check.html_url}`);
  } catch (e) {
    console.log(`   ❌ 仓库不存在！请先在 https://github.com/new 创建空仓库 "${REPO}"`);
    process.exit(1);
  }

  // 2. 逐个上传文件
  console.log(`\n📤 上传 ${FILES.length} 个文件...`);
  for (const filePath of FILES) {
    const content = fs.readFileSync(path.join(__dirname, filePath));
    const base64 = content.toString('base64');

    try {
      // 检查文件是否已存在（获取 sha）
      let sha = null;
      try {
        const existing = await api('GET', `/repos/${USERNAME}/${REPO}/contents/${filePath}`);
        sha = existing.sha;
      } catch {}

      const body = {
        message: `Add ${filePath}`,
        content: base64,
        branch: 'main'
      };
      if (sha) body.sha = sha;

      const result = await api('PUT', `/repos/${USERNAME}/${REPO}/contents/${filePath}`, body);
      const status = sha ? '已更新' : '已创建';
      console.log(`   ✅ ${status}: ${filePath} (${content.length} bytes)`);
    } catch (e) {
      console.log(`   ❌ ${filePath}: ${e.message}`);
    }
  }

  console.log(`\n🎉 全部完成！`);
  console.log(`   仓库地址: https://github.com/${USERNAME}/${REPO}`);
  console.log(`\n   下一步：`);
  console.log(`   1. 打开 https://dashboard.render.com`);
  console.log(`   2. 点 New + → Web Service → 连接 GitHub → 选择 ${REPO}`);
  console.log(`   3. 环境变量添加: DEEPSEEK_API_KEY = 你的Key`);
  console.log(`   4. 点 Deploy，等着拿链接！`);
}

main().catch(e => {
  console.error('❌ 失败:', e.message);
  process.exit(1);
});
