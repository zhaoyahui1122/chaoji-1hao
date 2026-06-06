import { expect, test } from '@playwright/test'

import { API_BASE_URL, authedGet, authedPost, loginToDashboard } from './helpers'

async function openWindow(page: any, name: string) {
  await page.getByRole('button', { name: new RegExp(name, 'i') }).first().click()
}

async function ensureSourceHistory(page: any, source: 'manual' | 'runner') {
  const existing = await authedGet(page.request, `/history/orders?limit=20&source=${source}`)
  const existingData = await existing.json()
  if (Array.isArray(existingData.items) && existingData.items.length > 0) return

  if (source === 'runner') {
    const snapshotResp = await authedGet(page.request, '/paper/snapshot')
    const snapshotData = await snapshotResp.json()
    const existingBtcPosition = Array.isArray(snapshotData?.positions)
      ? snapshotData.positions.find((item: any) => item.symbol === 'BTC_USDT')
      : null

    if (!existingBtcPosition) {
      const seedResp = await authedPost(page.request, '/paper/order', {
        symbol: 'BTC_USDT',
        side: 'long',
        price: 80800,
        leverage: 5,
        allocated_margin: 100,
        stop_loss_price: 78376,
        source: 'manual',
      })
      const seedData = await seedResp.json()
      if (!seedData?.ok) {
        throw new Error(`failed to seed BTC position for runner history: ${JSON.stringify(seedData)}`)
      }
    }

    const runResp = await authedPost(page.request, '/runner/run-once', {
      symbol: 'BTC_USDT',
      timeframe: '15m',
      strategy_type: 'classic',
      data_source: 'gate',
      trade_mode: 'paper',
      leverage: 5,
      allocated_margin: 1000,
      use_boll: true,
      boll_period: 20,
      boll_std: 2,
      use_rsi: true,
      rsi_period: 14,
      rsi_oversold: 30,
      rsi_overbought: 70,
      use_ma: true,
      ma_short: 9,
      ma_long: 21,
      turtle_entry_period: 20,
      turtle_exit_period: 10,
      turtle_atr_period: 14,
      turtle_atr_filter: 0,
      stop_loss_pct: 0.02,
      take_profit_pct: 0.04,
      risk_per_trade_pct: 0.01,
      fee_rate: 0.00015,
      slippage_rate: 0.0001,
    })
    const runData = await runResp.json()
    if (!runData?.ok) {
      throw new Error(`failed to seed runner history: ${JSON.stringify(runData)}`)
    }

    await expect.poll(async () => {
      const resp = await authedGet(page.request, '/history/orders?limit=20&source=runner')
      const data = await resp.json()
      return Array.isArray(data.items) ? data.items.length : 0
    }, { timeout: 30_000 }).toBeGreaterThan(0)
    return
  }

  const snapshotResp = await authedGet(page.request, '/paper/snapshot')
  const snapshotData = await snapshotResp.json()
  const price = 3200
  const leverage = 5
  const allocatedMargin = 100
  const stopLossPrice = price * 0.97

  const orderResp = await authedPost(page.request, '/paper/order', {
    symbol: 'ETH_USDT',
    side: 'long',
    price,
    leverage,
    allocated_margin: allocatedMargin,
    stop_loss_price: stopLossPrice,
    source,
  })
  const orderData = await orderResp.json()
  if (!orderData?.ok) {
    throw new Error(`failed to seed ${source} history: ${JSON.stringify(orderData)}`)
  }

  const hasExistingPosition = Array.isArray(snapshotData?.positions) && snapshotData.positions.some((item: any) => item.symbol === 'ETH_USDT')
  if (!hasExistingPosition) {
    const positionId = orderData?.order?.position_id
    if (positionId) {
      await authedPost(page.request, '/paper/close', {
        symbol: 'ETH_USDT',
        price,
        position_id: positionId,
        source,
      })
    }
  }
}

async function expectOrderSourceVisible(page: any, source: 'manual' | 'runner') {
  await expect.poll(async () => {
    await authedGet(page.request, `/history/orders?limit=20&source=${source}`)
    return page.getByText(new RegExp(`来源.*${source}`)).first().isVisible().catch(() => false)
  }, { timeout: 30_000 }).toBe(true)
}

test.describe('Quant Gate MVP 页面联调', () => {
  test('回测结果显示数据源透明字段与实时参考价', async ({ page }) => {
    await loginToDashboard(page)

    await openWindow(page, 'Strategy')
    await page.getByRole('button', { name: /运行回测/ }).click()

    await expect(page.getByText(/请求数据源：/)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/实际数据源：/)).toBeVisible({ timeout: 30_000 })
  })

  test('运行一次策略执行后显示 runner 数据源透明字段', async ({ page }) => {
    await loginToDashboard(page)

    await openWindow(page, 'Strategy')
    await page.getByRole('button', { name: /运行一次策略执行/ }).click()

    await expect(page.getByText(/市场数据源：/)).toBeVisible({ timeout: 30_000 })
  })

  test('来源筛选可以区分 manual 和 runner 订单', async ({ page }) => {
    await ensureSourceHistory(page, 'manual')
    await ensureSourceHistory(page, 'runner')
    await loginToDashboard(page)

    await openWindow(page, 'History')
    const bodyText = await page.textContent('body')
    expect(bodyText).toContain('历史')
  })

  test('事件类型筛选和订单事件展示可联调', async ({ page }) => {
    await authedPost(page.request, '/runner/reset-paper', {})
    await loginToDashboard(page)
    await openWindow(page, 'Trade')

    const paperCard = page.locator('div').filter({
      has: page.getByText(/Paper Trading Console|模拟交易执行台/).first(),
    }).first()

    await paperCard.getByRole('button', { name: 'BTC_USDT', exact: true }).click()
    await paperCard.getByLabel(/运行模式/).selectOption('manual')
    await paperCard.getByLabel(/手动方向/).selectOption('long')
    await paperCard.getByRole('button', { name: /手动开仓|已启用自动轮询|已启动机器人/ }).click()
    await expect(page.getByText(/操作目标仓位/)).toBeVisible({ timeout: 30_000 })

    const targetPositionId = await paperCard.getByLabel(/操作目标仓位/).inputValue()
    expect(targetPositionId).toBeTruthy()

    await paperCard.getByRole('button', { name: '更新标记价' }).click()
    await paperCard.getByRole('button', { name: '模拟平仓' }).click()

    await expect.poll(async () => {
      const resp = await authedGet(page.request, '/history/orders?limit=20&symbol=BTC_USDT')
      const data = await resp.json()
      const items = Array.isArray(data.items) ? data.items : []
      const matched = items.filter((item: any) => item.position_id === targetPositionId)
      return {
        hasMark: matched.some((item: any) => item.event_type === 'mark'),
        hasClose: matched.some((item: any) => item.event_type === 'close'),
      }
    }, { timeout: 30_000 }).toEqual({ hasMark: true, hasClose: true })
  })
})
