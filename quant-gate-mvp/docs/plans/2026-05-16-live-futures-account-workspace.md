# 合约实盘账户页面与真实账户只读接入 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增“合约实盘账户”独立页面，并在后端接入 Gate 合约真实账户私有只读接口，实现连接测试、账户总览、持仓展示与手动刷新。

**Architecture:** 保持现有 `gate_market_data.py` 行情链路不动，新增一条独立的 Gate Futures 私有接口只读链路。后端通过新的 live-account service/router 接收前端提交的 API Key/Secret，在进程内保存会话级凭证并调用 Gate 私有接口；前端新增独立页面与导航入口，通过新 API 呈现未连接、连接中、已连接、连接失败四种状态。

**Tech Stack:** FastAPI, Pydantic, requests, Next.js App Router, React hooks, Playwright, pytest

---

### Task 1: 固定 Gate 实盘账户后端契约

**Files:**
- Create: `apps/api/tests/test_live_account_routes.py`
- Modify: `apps/api/app/api/routes.py`
- Create: `apps/api/app/api/routes_live_account.py`
- Create: `apps/api/app/schemas/live_account.py`

**Step 1: Write the failing test**

```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_live_account_status_defaults_to_disconnected():
    response = client.get("/live-account/status")
    assert response.status_code == 200
    assert response.json() == {
        "connected": False,
        "has_credentials": False,
        "last_sync_at": None,
        "last_error": None,
        "account": None,
        "positions": [],
        "source": "gate_futures_live",
    }
```

**Step 2: Run test to verify it fails**

Run: `pytest apps/api/tests/test_live_account_routes.py::test_live_account_status_defaults_to_disconnected -v`
Expected: FAIL with 404 or import error because `/live-account/status` does not exist.

**Step 3: Write minimal implementation**

- 在 `apps/api/app/schemas/live_account.py` 新增：
  - `LiveAccountStatusResponse`
  - `LiveAccountConnectRequest`
  - `LiveAccountOverview`
  - `LiveAccountPosition`
- 在 `apps/api/app/api/routes_live_account.py` 新增空实现路由：
  - `GET /live-account/status`
  - `POST /live-account/connect`
  - `POST /live-account/refresh`
- 在 `apps/api/app/api/routes.py` 注册 `live_account_router`。

最小返回实现示例：

```python
@router.get("/status")
def get_live_account_status():
    return {
        "connected": False,
        "has_credentials": False,
        "last_sync_at": None,
        "last_error": None,
        "account": None,
        "positions": [],
        "source": "gate_futures_live",
    }
```

**Step 4: Run test to verify it passes**

Run: `pytest apps/api/tests/test_live_account_routes.py::test_live_account_status_defaults_to_disconnected -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/tests/test_live_account_routes.py apps/api/app/api/routes.py apps/api/app/api/routes_live_account.py apps/api/app/schemas/live_account.py
git commit -m "feat: add live account status routes"
```

### Task 2: 增加进程内凭证会话存储

**Files:**
- Create: `apps/api/tests/test_live_account_session.py`
- Create: `apps/api/app/services/live_account_session.py`
- Modify: `apps/api/app/api/routes_live_account.py`

**Step 1: Write the failing test**

```python
from app.services.live_account_session import clear_live_account_session, get_live_account_session, set_live_account_credentials


def test_live_account_session_stores_credentials_without_persistence():
    clear_live_account_session()

    set_live_account_credentials(api_key="demo-key", api_secret="demo-secret")
    session = get_live_account_session()

    assert session["has_credentials"] is True
    assert session["api_key"] == "demo-key"
    assert session["api_secret"] == "demo-secret"
    assert session["last_error"] is None
```

**Step 2: Run test to verify it fails**

Run: `pytest apps/api/tests/test_live_account_session.py::test_live_account_session_stores_credentials_without_persistence -v`
Expected: FAIL because `live_account_session.py` does not exist.

**Step 3: Write minimal implementation**

在 `apps/api/app/services/live_account_session.py` 新增线程内单例状态：

```python
_STATE = {
    "api_key": None,
    "api_secret": None,
    "has_credentials": False,
    "connected": False,
    "last_sync_at": None,
    "last_error": None,
    "account": None,
    "positions": [],
}
```

提供函数：
- `get_live_account_session()`
- `set_live_account_credentials(api_key: str, api_secret: str)`
- `set_live_account_snapshot(account: dict | None, positions: list[dict], last_sync_at: str)`
- `set_live_account_error(message: str)`
- `clear_live_account_session()`

并让 `routes_live_account.py` 的 `/status` 从 session 读取，而不是写死返回。

**Step 4: Run test to verify it passes**

Run: `pytest apps/api/tests/test_live_account_session.py::test_live_account_session_stores_credentials_without_persistence -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/tests/test_live_account_session.py apps/api/app/services/live_account_session.py apps/api/app/api/routes_live_account.py
git commit -m "feat: add live account in-memory session"
```

### Task 3: 封装 Gate 合约私有只读客户端签名与账户查询

**Files:**
- Create: `apps/api/tests/test_gate_live_private_api.py`
- Create: `apps/api/app/services/gate_live_account.py`
- Check: `apps/api/app/services/gate_market_data.py`

**Step 1: Write the failing test**

```python
from app.services.gate_live_account import build_gate_signature_headers


def test_build_gate_signature_headers_returns_gate_auth_fields():
    headers = build_gate_signature_headers(
        method="GET",
        path="/api/v4/futures/usdt/accounts",
        query_string="",
        body="",
        api_key="demo-key",
        api_secret="demo-secret",
        timestamp="1710000000",
    )

    assert headers["KEY"] == "demo-key"
    assert headers["Timestamp"] == "1710000000"
    assert "SIGN" in headers
```

**Step 2: Run test to verify it fails**

Run: `pytest apps/api/tests/test_gate_live_private_api.py::test_build_gate_signature_headers_returns_gate_auth_fields -v`
Expected: FAIL because `gate_live_account.py` does not exist.

**Step 3: Write minimal implementation**

在 `apps/api/app/services/gate_live_account.py` 中新增：
- `GATE_API_BASE = "https://api.gateio.ws"`
- `build_gate_signature_headers(...)`
- `_gate_private_request(...)`
- `fetch_futures_account(api_key: str, api_secret: str) -> dict`
- `fetch_futures_positions(api_key: str, api_secret: str) -> list[dict]`

实现要求：
- 使用 Gate V4 鉴权头
- 只调用私有只读接口（账户、持仓）
- 网络层继续用 `requests`
- 抛出清晰错误：`gate_live_auth_failed`, `gate_live_request_failed`, `gate_live_invalid_response`

最小签名函数结构：

```python
def build_gate_signature_headers(method, path, query_string, body, api_key, api_secret, timestamp):
    payload_hash = hashlib.sha512(body.encode("utf-8")).hexdigest()
    sign_payload = "\n".join([method.upper(), path, query_string, payload_hash, timestamp])
    sign = hmac.new(api_secret.encode("utf-8"), sign_payload.encode("utf-8"), hashlib.sha512).hexdigest()
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "KEY": api_key,
        "Timestamp": timestamp,
        "SIGN": sign,
    }
```

**Step 4: Run test to verify it passes**

Run: `pytest apps/api/tests/test_gate_live_private_api.py::test_build_gate_signature_headers_returns_gate_auth_fields -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/tests/test_gate_live_private_api.py apps/api/app/services/gate_live_account.py
git commit -m "feat: add gate live account private client"
```

### Task 4: 实现连接测试与刷新服务

**Files:**
- Create: `apps/api/tests/test_live_account_service.py`
- Create: `apps/api/app/services/live_account_service.py`
- Modify: `apps/api/app/api/routes_live_account.py`
- Modify: `apps/api/app/services/live_account_session.py`

**Step 1: Write the failing test**

```python
from app.services.live_account_service import build_live_account_snapshot


def test_build_live_account_snapshot_normalizes_account_and_positions():
    snapshot = build_live_account_snapshot(
        account_raw={"total": "1200", "available": "900"},
        positions_raw=[
            {
                "contract": "BTC_USDT",
                "size": "0.01",
                "leverage": "5",
                "entry_price": "64000",
                "mark_price": "64500",
                "unrealised_pnl": "5.0",
                "mode": "single",
            }
        ],
    )

    assert snapshot["account"]["equity"] == 1200.0
    assert snapshot["account"]["available_balance"] == 900.0
    assert snapshot["positions"][0]["symbol"] == "BTC_USDT"
    assert snapshot["positions"][0]["mark_price"] == 64500.0
```

**Step 2: Run test to verify it fails**

Run: `pytest apps/api/tests/test_live_account_service.py::test_build_live_account_snapshot_normalizes_account_and_positions -v`
Expected: FAIL because `live_account_service.py` does not exist.

**Step 3: Write minimal implementation**

在 `apps/api/app/services/live_account_service.py` 中新增：
- `build_live_account_snapshot(account_raw, positions_raw)`
- `connect_live_account(api_key, api_secret)`
- `refresh_live_account()`

实现细节：
- `connect_live_account()`：
  1. 写入 session 凭证
  2. 调 `fetch_futures_account()` 和 `fetch_futures_positions()`
  3. 标准化成前端可直接消费的数据
  4. 保存到 session snapshot
- `refresh_live_account()`：
  1. 检查 session 是否已有凭证
  2. 重新拉取账户/持仓
  3. 更新 `last_sync_at`
- `routes_live_account.py`：
  - `/connect` 调用 `connect_live_account()`
  - `/refresh` 调用 `refresh_live_account()`

标准化结构最少包含：

```python
{
    "account": {
        "equity": 1200.0,
        "available_balance": 900.0,
        "margin_used": 300.0,
        "unrealized_pnl": 5.0,
    },
    "positions": [
        {
            "symbol": "BTC_USDT",
            "side": "long",
            "leverage": 5,
            "size": 0.01,
            "entry_price": 64000.0,
            "mark_price": 64500.0,
            "unrealized_pnl": 5.0,
        }
    ],
}
```

**Step 4: Run test to verify it passes**

Run: `pytest apps/api/tests/test_live_account_service.py::test_build_live_account_snapshot_normalizes_account_and_positions -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/tests/test_live_account_service.py apps/api/app/services/live_account_service.py apps/api/app/api/routes_live_account.py apps/api/app/services/live_account_session.py
git commit -m "feat: add live account connect and refresh service"
```

### Task 5: 为真实账户接口补充失败路径测试

**Files:**
- Modify: `apps/api/tests/test_live_account_routes.py`
- Modify: `apps/api/tests/test_live_account_service.py`
- Modify: `apps/api/app/api/routes_live_account.py`
- Modify: `apps/api/app/services/live_account_service.py`

**Step 1: Write the failing test**

```python
def test_live_account_refresh_requires_credentials(client):
    response = client.post("/live-account/refresh")
    assert response.status_code == 400
    assert response.json()["detail"] == "live_account_not_connected"
```

**Step 2: Run test to verify it fails**

Run: `pytest apps/api/tests/test_live_account_routes.py::test_live_account_refresh_requires_credentials -v`
Expected: FAIL because the route does not validate missing credentials.

**Step 3: Write minimal implementation**

- 在 `refresh_live_account()` 中缺凭证时抛 `ValueError("live_account_not_connected")`
- 在 `routes_live_account.py` 中把该错误映射成 `HTTPException(status_code=400, detail="live_account_not_connected")`
- 为以下场景补最小测试和错误映射：
  - 连接时 key/secret 为空
  - Gate 返回鉴权失败
  - Gate 返回结构缺字段

**Step 4: Run test to verify it passes**

Run: `pytest apps/api/tests/test_live_account_routes.py apps/api/tests/test_live_account_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/tests/test_live_account_routes.py apps/api/tests/test_live_account_service.py apps/api/app/api/routes_live_account.py apps/api/app/services/live_account_service.py
git commit -m "test: cover live account route failures"
```

### Task 6: 扩展前端 API client 与类型

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/dashboard-types.ts`
- Test: `apps/web/tests/paper-live.spec.ts`

**Step 1: Write the failing test**

在 `apps/web/tests/paper-live.spec.ts` 追加一个导航与页面骨架测试：

```ts
test('合约实盘账户页面入口可见', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: '合约实盘账户' })).toBeVisible()
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "合约实盘账户页面入口可见"`
Expected: FAIL because the navigation item does not exist.

**Step 3: Write minimal implementation**

在 `apps/web/lib/api.ts` 新增：
- `LiveAccountStatusResponse`
- `LiveAccountConnectPayload`
- `getLiveAccountStatus()`
- `connectLiveAccount()`
- `refreshLiveAccount()`

在 `apps/web/components/dashboard-types.ts` 新增前端消费类型：
- `LiveAccountOverview`
- `LiveAccountPosition`
- `LiveAccountStatus`

先只补类型与请求函数，不急着完整 UI。

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "合约实盘账户页面入口可见"`
Expected: still FAIL until Task 7 adds navigation. That is acceptable for this task because this task只补 API/types；改为运行前端类型检查验证无语法错误。

Run instead: `pnpm --dir apps/web exec tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/lib/api.ts apps/web/components/dashboard-types.ts
git commit -m "feat: add live account frontend api client"
```

### Task 7: 新增“合约实盘账户”独立页面与导航入口

**Files:**
- Create: `apps/web/app/live-account/page.tsx`
- Modify: `apps/web/app/page.tsx`
- Create: `apps/web/components/LiveAccountShell.tsx`
- Test: `apps/web/tests/paper-live.spec.ts`

**Step 1: Write the failing test**

```ts
test('合约实盘账户页面入口可跳转到独立页面', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: '合约实盘账户' }).click()
  await expect(page).toHaveURL(/\/live-account/)
  await expect(page.getByRole('heading', { name: '合约实盘账户' })).toBeVisible()
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "合约实盘账户页面入口可跳转到独立页面"`
Expected: FAIL because the page and navigation do not exist.

**Step 3: Write minimal implementation**

- 在 `apps/web/app/page.tsx` 的侧边栏“工作区”区域增加 `Link` 到 `/live-account`
- 新建 `apps/web/app/live-account/page.tsx`，渲染标题、描述、占位骨架
- 新建 `apps/web/components/LiveAccountShell.tsx`，先输出固定标题与空态容器

最小页面结构：

```tsx
export default function LiveAccountPage() {
  return <LiveAccountShell />
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "合约实盘账户页面入口可跳转到独立页面"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/app/page.tsx apps/web/app/live-account/page.tsx apps/web/components/LiveAccountShell.tsx apps/web/tests/paper-live.spec.ts
git commit -m "feat: add live account workspace page"
```

### Task 8: 实现未连接态与连接表单

**Files:**
- Modify: `apps/web/components/LiveAccountShell.tsx`
- Create: `apps/web/components/LiveAccountConnectCard.tsx`
- Modify: `apps/web/app/live-account/page.tsx`
- Test: `apps/web/tests/paper-live.spec.ts`

**Step 1: Write the failing test**

```ts
test('合约实盘账户页面在未连接时显示连接表单', async ({ page }) => {
  await page.goto('/live-account')
  await expect(page.getByLabel('API Key')).toBeVisible()
  await expect(page.getByLabel('API Secret')).toBeVisible()
  await expect(page.getByRole('button', { name: '测试连接' })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存并连接' })).toBeVisible()
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "未连接时显示连接表单"`
Expected: FAIL because the page only has a shell.

**Step 3: Write minimal implementation**

- 新建 `LiveAccountConnectCard.tsx`
- 在 `LiveAccountShell.tsx` 中：
  - `useEffect` 首次调用 `getLiveAccountStatus()`
  - 若 `connected === false`，渲染连接表单
  - 表单包含 API Key、API Secret、测试连接、保存并连接、错误信息区
- 交互最小闭环：
  - 测试连接按钮调用 `connectLiveAccount()`
  - 请求期间禁用按钮并显示 loading 文案

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "未连接时显示连接表单"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/components/LiveAccountShell.tsx apps/web/components/LiveAccountConnectCard.tsx apps/web/app/live-account/page.tsx apps/web/tests/paper-live.spec.ts
git commit -m "feat: add live account connect form"
```

### Task 9: 实现已连接态总览卡与持仓表

**Files:**
- Modify: `apps/web/components/LiveAccountShell.tsx`
- Create: `apps/web/components/LiveAccountOverviewCards.tsx`
- Create: `apps/web/components/LiveAccountPositionsTable.tsx`
- Test: `apps/web/tests/paper-live.spec.ts`

**Step 1: Write the failing test**

```ts
test('合约实盘账户页面在已连接时显示总览与持仓', async ({ page }) => {
  await page.goto('/live-account')
  await expect(page.getByText('账户权益')).toBeVisible()
  await expect(page.getByText('可用余额')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '合约' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '标记价' })).toBeVisible()
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "已连接时显示总览与持仓"`
Expected: FAIL because connected-state UI is missing.

**Step 3: Write minimal implementation**

- 新建 `LiveAccountOverviewCards.tsx` 渲染 4 个指标卡：
  - 账户权益
  - 可用余额
  - 保证金占用
  - 未实现盈亏
- 新建 `LiveAccountPositionsTable.tsx` 渲染列：
  - 合约
  - 方向
  - 杠杆
  - 数量
  - 开仓价
  - 标记价
  - 未实现盈亏
- `LiveAccountShell.tsx` 在 `connected === true` 时改渲染 overview + table

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "已连接时显示总览与持仓"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/components/LiveAccountShell.tsx apps/web/components/LiveAccountOverviewCards.tsx apps/web/components/LiveAccountPositionsTable.tsx apps/web/tests/paper-live.spec.ts
git commit -m "feat: render live account overview and positions"
```

### Task 10: 增加连接状态栏、手动刷新与同步信息

**Files:**
- Modify: `apps/web/components/LiveAccountShell.tsx`
- Modify: `apps/web/components/LiveAccountConnectCard.tsx`
- Test: `apps/web/tests/paper-live.spec.ts`

**Step 1: Write the failing test**

```ts
test('合约实盘账户页面显示连接状态和手动刷新入口', async ({ page }) => {
  await page.goto('/live-account')
  await expect(page.getByRole('button', { name: '手动刷新' })).toBeVisible()
  await expect(page.getByText(/未连接|连接中|已连接|连接失败/)).toBeVisible()
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "显示连接状态和手动刷新入口"`
Expected: FAIL because status bar is incomplete.

**Step 3: Write minimal implementation**

- `LiveAccountShell.tsx` 顶部增加状态栏：
  - 页面标题
  - 状态 badge
  - 手动刷新按钮
- 刷新按钮调用 `refreshLiveAccount()`
- 底部增加同步信息区：
  - 最近同步时间
  - 最近错误
  - 数据来源 `Gate Futures Live Account`
- 处理空态/加载态/错误态：
  - 页面初始加载 skeleton
  - connect/refresh 中按钮 loading
  - 刷新失败保留旧数据并显示错误

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "显示连接状态和手动刷新入口"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/components/LiveAccountShell.tsx apps/web/components/LiveAccountConnectCard.tsx apps/web/tests/paper-live.spec.ts
git commit -m "feat: add live account status and refresh controls"
```

### Task 11: 端到端验证后端与前端主链路

**Files:**
- Modify: `apps/web/tests/paper-live.spec.ts`
- Modify: `apps/api/tests/test_live_account_routes.py`
- Check: `apps/api/app/main.py`
- Check: `apps/web/app/live-account/page.tsx`

**Step 1: Write the failing test**

追加一个带 mock 的浏览器测试，避免真实依赖用户密钥：

```ts
test('合约实盘账户页面可完成连接并展示返回数据', async ({ page }) => {
  await page.route('http://127.0.0.1:8012/live-account/status', async (route) => {
    await route.fulfill({ json: { connected: false, has_credentials: false, last_sync_at: null, last_error: null, account: null, positions: [], source: 'gate_futures_live' } })
  })

  await page.route('http://127.0.0.1:8012/live-account/connect', async (route) => {
    await route.fulfill({
      json: {
        connected: true,
        has_credentials: true,
        last_sync_at: '2026-05-16T10:00:00Z',
        last_error: null,
        source: 'gate_futures_live',
        account: { equity: 1200, available_balance: 900, margin_used: 300, unrealized_pnl: 5 },
        positions: [{ symbol: 'BTC_USDT', side: 'long', leverage: 5, size: 0.01, entry_price: 64000, mark_price: 64500, unrealized_pnl: 5 }],
      },
    })
  })

  await page.goto('/live-account')
  await page.getByLabel('API Key').fill('demo-key')
  await page.getByLabel('API Secret').fill('demo-secret')
  await page.getByRole('button', { name: '保存并连接' }).click()

  await expect(page.getByText('账户权益')).toBeVisible()
  await expect(page.getByText('1200')).toBeVisible()
  await expect(page.getByText('BTC_USDT')).toBeVisible()
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "可完成连接并展示返回数据"`
Expected: FAIL until connect + render flow is complete.

**Step 3: Write minimal implementation**

- 修正 `LiveAccountShell.tsx` 中的连接后状态切换
- 让连接成功后直接用响应体刷新本地 state，而不是强依赖二次拉 `/status`
- 确保错误消息、loading 状态、已连接状态切换都可见

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts --grep "合约实盘账户页面"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/tests/paper-live.spec.ts apps/web/components/LiveAccountShell.tsx apps/api/tests/test_live_account_routes.py
git commit -m "test: verify live account workspace flow"
```

### Task 12: 全量回归检查

**Files:**
- Check: `apps/api/tests/test_live_account_routes.py`
- Check: `apps/api/tests/test_live_account_session.py`
- Check: `apps/api/tests/test_gate_live_private_api.py`
- Check: `apps/api/tests/test_live_account_service.py`
- Check: `apps/web/tests/paper-live.spec.ts`
- Check: `apps/web/lib/api.ts`
- Check: `apps/web/components/LiveAccountShell.tsx`

**Step 1: Run focused backend tests**

Run: `pytest apps/api/tests/test_live_account_routes.py apps/api/tests/test_live_account_session.py apps/api/tests/test_gate_live_private_api.py apps/api/tests/test_live_account_service.py -v`
Expected: PASS

**Step 2: Run frontend type checks**

Run: `pnpm --dir apps/web exec tsc --noEmit`
Expected: PASS

**Step 3: Run Playwright tests**

Run: `pnpm --dir apps/web exec playwright test tests/paper-live.spec.ts`
Expected: PASS

**Step 4: Manual verification**

Run backend and frontend locally, then verify in browser:

```bash
# terminal 1
cd apps/api && uvicorn app.main:app --reload --port 8012

# terminal 2
cd apps/web && pnpm dev --port 3002
```

Manual checklist:
- 主页侧边栏能进入“合约实盘账户”
- 未连接时看到 API Key / Secret 表单
- 输入错误凭证时显示错误，不崩页面
- 输入正确凭证后显示总览卡与持仓表
- 点击“手动刷新”后更新时间变化
- 页面刷新后，如果进程仍在，`/status` 能恢复当前连接态

**Step 5: Commit**

```bash
git add apps/api/tests/test_live_account_routes.py apps/api/tests/test_live_account_session.py apps/api/tests/test_gate_live_private_api.py apps/api/tests/test_live_account_service.py apps/web/lib/api.ts apps/web/components/dashboard-types.ts apps/web/app/page.tsx apps/web/app/live-account/page.tsx apps/web/components/LiveAccountShell.tsx apps/web/components/LiveAccountConnectCard.tsx apps/web/components/LiveAccountOverviewCards.tsx apps/web/components/LiveAccountPositionsTable.tsx apps/web/tests/paper-live.spec.ts
git commit -m "feat: add gate live account workspace"
```
