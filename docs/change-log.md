# 超级一号改动记录

这个文档用来记录每次代码改动加了什么、为什么改、影响范围和验证结果。以后继续改功能或修漏洞时，按时间倒序追加。

## 2026-06-10 本地登录修复：统一前端 API 地址

### 加了什么

- 将 `apps/web/.env.local` 中的 `NEXT_PUBLIC_API_BASE` 从 `http://localhost:8012` 改为 `http://127.0.0.1:8012`。
- 重启前端 dev server，让新的 API 地址重新编译进前端。

### 修了什么问题

- 浏览器访问 `http://127.0.0.1:3000` 时，前端请求 `http://localhost:8012` 可能被解析到 IPv6 `::1`，但后端当前监听在 IPv4 地址上，导致页面显示 `Failed to fetch`。
- 统一使用 `127.0.0.1` 后，前端和后端都走同一个 IPv4 本机地址。

### 涉及文件

- `apps/web/.env.local`

### 验证

- `http://127.0.0.1:3000` 返回 HTTP 200。
- `http://127.0.0.1:8012/auth/session` 返回 HTTP 200。
- `POST http://127.0.0.1:8012/auth/login` 使用 `admin / 666666` 返回 HTTP 200。

## 2026-06-10 前端开发提示修复：浏览器插件导致 hydration mismatch

### 加了什么

- 在 `apps/web/app/layout.tsx` 的根 `<html>` 上增加 `suppressHydrationWarning`。

### 修了什么问题

- 浏览器插件会在 React 加载前给根节点注入属性，例如截图里的 `data-lt-installed="true"`。
- Next/React hydration 时发现服务端 HTML 和客户端 HTML 属性不一致，于是弹出红色 Console Error 覆盖页面。
- 这个问题不是业务渲染失败，而是浏览器扩展修改了页面根节点属性。

### 涉及文件

- `apps/web/app/layout.tsx`

### 验证

- `npm run build`

## 2026-06-10 功能链路修复：纸盘手动交易恢复

### 加了什么

- 在 `apps/web/components/PaperTradePanel.tsx` 恢复纸盘交易的手动开仓入口。
- 新增“运行模式”选择：
  - `策略自动`：继续使用原有机器人按策略运行流程。
  - `手动开仓`：显示“手动方向”和“手动开仓”按钮。
- 手动开仓时调用已有的 `onOpen` 纸盘下单链路，使用当前价格、方向、杠杆、止损、手续费、滑点和风险参数生成订单。
- 手动模式下，当前交易对和持仓列表以用户手动选择的 symbol 为准，避免仍然被策略槽位 symbol 覆盖。
- 手动默认下单保证金留出风控余量，避免默认参数刚好踩到 20% 保证金上限后因滑点被拒。

### 修了什么问题

- 纸盘交易页面原本保留了后端和数据层的手动下单能力，但前端入口被隐藏，导致用户无法从页面完成手动开仓。
- 开仓后页面没有出现“操作目标仓位”，后续更新标记价和平仓链路无法继续。
- 后端业务返回 `ok: false` 时，前端仍可能显示“模拟开仓已提交”，造成失败误报成功。

### 涉及文件

- `apps/web/components/PaperTradePanel.tsx`
- `apps/web/components/useDashboardPageData.ts`
- `apps/web/lib/api.ts`
- `apps/api/app/api/routes_paper.py`

### 验证

- `npm run build`
- `python -m pytest apps/api/test_live_account_routes.py apps/api/test_super_one_hardening.py -q`
- `npm run test:e2e -- tests/paper-live.spec.ts`
- `npm run test:e2e -- tests/e2e.spec.ts --grep "事件类型"`

## 2026-06-10 功能测试修复：历史过滤测试稳定化

### 加了什么

- 在 `apps/web/tests/e2e-trade-mode.spec.ts` 中新增测试造数逻辑。
- 测试会先创建并平仓一笔 paper 仓位，再验证 `trade_mode=paper` 的历史记录、统计和权益曲线。

### 修了什么问题

- 原测试默认数据库里一定有 paper 历史记录。
- 空库或刚重置环境下，后端过滤功能没坏，但测试会因为 `count = 0` 误报失败。

### 涉及文件

- `apps/web/tests/e2e-trade-mode.spec.ts`

### 验证

- `npm run test:e2e -- tests/e2e-trade-mode.spec.ts`

## 2026-06-10 端到端测试环境修复

### 加了什么

- Playwright 默认 API 地址改为当前运行的 `http://127.0.0.1:8012`。
- Playwright 启动前端 dev server 时使用 `--webpack`，避开 full e2e 下 Turbopack dev server 内存崩溃。

### 修了什么问题

- e2e 原来默认连 `8001`，但当前后端服务在 `8012`，导致测试请求失败。
- Next 16 Turbopack dev server 在完整 e2e 中出现过内存分配失败。

### 涉及文件

- `apps/web/playwright.config.ts`
- `apps/web/tests/helpers.ts`

### 验证

- `npm run test:e2e -- tests/paper-live.spec.ts`
- `npm run test:e2e -- tests/e2e-trade-mode.spec.ts`

## 2026-06-10 安全修复：操作令牌和实盘账户入口

### 加了什么

- 操作令牌绑定当前登录 session 的 `jti`。
- 操作令牌消费后写入已使用记录，防止重复使用。
- `/live-account` 页面增加登录保护，未登录时不暴露 Gate.io API Key / Secret 表单。
- 测试环境支持跳过 `.env` 自动加载，避免本地环境变量污染测试。

### 修了什么问题

- 操作令牌存在跨会话复用和重放风险。
- 未登录访问实盘账户页面时，敏感表单入口可能先于鉴权暴露。
- 测试容易被本机 `.env` 中的真实配置影响。

### 涉及文件

- `apps/api/app/services/auth_service.py`
- `apps/api/app/api/routes_auth.py`
- `apps/api/app/api/routes_runner.py`
- `apps/api/app/api/routes_live_account.py`
- `apps/api/app/main.py`
- `apps/web/app/live-account/page.tsx`
- `apps/api/test_auth_session.py`
- `apps/api/test_live_account_routes.py`
- `apps/api/test_super_one_hardening.py`
- `apps/web/tests/paper-live.spec.ts`

### 验证

- `python -m pytest apps/api/test_auth_session.py apps/api/test_super_one_hardening.py apps/api/test_live_account_routes.py -q`
- `python -m pytest apps/api -q`
- `npm run test:e2e -- tests/paper-live.spec.ts --grep "未登录访问实盘账户页"`

## 2026-06-10 依赖安全修复：前端漏洞处理

### 加了什么

- 升级 Next.js 到 `^16.2.9`。
- 在 `apps/web/package.json` 中加入 `overrides.postcss = "^8.5.15"`。
- 为 Next 16 增加 Turbopack root 配置。

### 修了什么问题

- `npm audit` 中的 Next.js / PostCSS 相关安全告警。
- Next 16 构建时的 workspace root 推断警告。

### 涉及文件

- `apps/web/package.json`
- `apps/web/package-lock.json`
- `apps/web/next.config.mjs`
- `apps/web/tsconfig.json`

### 验证

- `npm audit --audit-level=moderate --registry=https://registry.npmjs.org`
- `npm run build`

## 后续追加模板

```md
## YYYY-MM-DD 改动标题

### 加了什么

-

### 修了什么问题

-

### 涉及文件

-

### 验证

-
```
