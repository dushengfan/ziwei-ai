# AI Agent 项目说明书

## 这是什么

紫微斗数 AI 解盘网站。用户输入出生日期+时间+城市+性别 → 后台排盘 → DeepSeek AI 解读 → 流式输出。

## 技术栈（零构建）

| 层 | 文件 | 说明 |
|----|------|------|
| **后端** | `server.js` | Express 服务端，含 2 个 API + 排盘逻辑 |
| **前端** | `public/index.html` | 单文件，HTML + Tailwind CDN + 原生 JS |
| **排盘** | npm `iztro` | 紫微斗数计算引擎 |
| **AI** | DeepSeek API | SSE 流式解读 |
| **知识库** | `knowledge/` | 星曜/宫位/四化/格局 JSON + System Prompt |

## API 端点

```
POST /api/chart     → { solar_date, time, city, gender } → 排盘 JSON
POST /api/reading   → 同上 → SSE 流式 AI 解读
GET  /api/quota     → 今日剩余次数
```

## 本地启动

```bash
npm install
npm start      # → http://localhost:3000
```

## 代码结构速查

```
server.js                ← 服务端：timeToShichen()换算、iztro排盘、知识检索、Prompt组装、DeepSeek代理
public/index.html        ← 前端：Canvas星空 + 表单(年/月/日+时间+城市+性别) + 星盘图 + Markdown流式渲染
knowledge/stars.json     ← 宫位数据（文件名反了，实际是宫位）
knowledge/palace.json    ← 星曜数据（文件名反了，实际是14主星）
knowledge/sihua.json     ← 四化解释
knowledge/patterns.json  ← 吉格+凶格
knowledge/system_prompt.md ← AI 灵魂提示词
```

## 部署

- GitHub 仓库：`https://github.com/dushengfan/ziwei-ai`
- Render 自动部署，push → 自动上线
- 线上地址：`https://ziwei-ai-vlqb.onrender.com`
- 环境变量：`DEEPSEEK_API_KEY`（在 Render 后台设置）

## 推送命令

```bash
node push_to_github.js
```

首次使用需修改 `push_to_github.js` 里的 `TOKEN` 变量为有效的 GitHub Classic Token（需 `repo` 权限）。
