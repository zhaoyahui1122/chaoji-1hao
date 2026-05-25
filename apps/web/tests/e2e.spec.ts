import { expect, test } from '@playwright/test'

async function openWindow(page: any, name: string) {
  await page.getByRole('button', { name: new RegExp(name) }).first().click()
}

async function ensureSourceHistory(page: any, source: 'manual' | 'runner') {
  const existing = await page.request.get(`http://127.0.0.1:8012/history/orders?limit=20&source=${source}`)
  const existingData = await existing.json()
  if (Array.isArray(existingData.items) && existingData.items.length > 0) return

  if (source === 'runner') {
    const snapshotResp = await page.request.get('http://127.0.0.1:8012/paper/snapshot')
    const snapshotData = await snapshotResp.json()
    const existingBtcPosition = Array.isArray(snapshotData?.positions)
      ? snapshotData.positions.find((item: any) => item.symbol === 'BTC_USDT')
      : null

    if (!existingBtcPosition) {
      const seedResp = await page.request.post('http://127.0.0.1:8012/paper/order', {
        data: {
          symbol: 'BTC_USDT',
          side: 'long',
          price: 80800,
          leverage: 5,
          allocated_margin: 100,
          stop_loss_price: 78376,
          source: 'manual',
        },
      })
      const seedData = await seedResp.json()
      if (!seedData?.ok) {
        throw new Error(`failed to seed BTC position for runner history: ${JSON.stringify(seedData)}`)
      }
    }

    const runResp = await page.request.post('http://127.0.0.1:8012/runner/run-once', {
      data: {
        symbol: 'BTC_USDT',
        timeframe: '15m',
        strategy_type: 'classic',
        data_source: 'gate',
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
      },
    })
    const runData = await runResp.json()
    if (!runData?.ok) {
      throw new Error(`failed to seed runner history: ${JSON.stringify(runData)}`)
    }

    await expect.poll(async () => {
      const resp = await page.request.get('http://127.0.0.1:8012/history/orders?limit=20&source=runner')
      const data = await resp.json()
      return Array.isArray(data.items) ? data.items.length : 0
    }, { timeout: 30000 }).toBeGreaterThan(0)
    return
  }

  const snapshotResp = await page.request.get('http://127.0.0.1:8012/paper/snapshot')
  const snapshotData = await snapshotResp.json()
  const price = 3200
  const leverage = 5
  const allocatedMargin = 100
  const stopLossPrice = price * 0.97

  const orderResp = await page.request.post('http://127.0.0.1:8012/paper/order', {
    data: {
      symbol: 'ETH_USDT',
      side: 'long',
      price,
      leverage,
      allocated_margin: allocatedMargin,
      stop_loss_price: stopLossPrice,
      source,
    },
  })
  const orderData = await orderResp.json()
  if (!orderData?.ok) {
    throw new Error(`failed to seed ${source} history: ${JSON.stringify(orderData)}`)
  }

  const hasExistingPosition = Array.isArray(snapshotData?.positions) && snapshotData.positions.some((item: any) => item.symbol === 'ETH_USDT')
  if (!hasExistingPosition) {
    const positionId = orderData?.order?.position_id
    if (positionId) {
      await page.request.post('http://127.0.0.1:8012/paper/close', {
        data: {
          symbol: 'ETH_USDT',
          price,
          position_id: positionId,
          source,
        },
      })
    }
  }
}

async function expectOrderSourceVisible(page: any, source: 'manual' | 'runner') {
  await expect.poll(async () => {
    await page.request.get(`http://127.0.0.1:8012/history/orders?limit=20&source=${source}`)
    return page.getByText(new RegExp(`来源：${source}`)).first().isVisible().catch(() => false)
  }, { timeout: 30000 }).toBe(true)
}

async function expectHistoryHeaderChips(page: any, heading: '历史订单' | '历史持仓', chips: string[]) {
  const chipWrap = page.locator(heading === '历史订单' ? '[data-testid="order-history-filter-chips"]' : '[data-testid="position-history-filter-chips"]').first()

  await expect(chipWrap).toBeVisible()

  for (const chip of chips) {
    await expect(chipWrap.getByText(chip, { exact: true })).toBeVisible()
  }

  return chipWrap
}

test.describe('Quant Gate MVP 页面联调', () => {
  test('回测结果显示数据源透明字段与实时参考价', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Quant Gate MVP')).toBeVisible()

    await openWindow(page, '策略控制')
    await expect(page.getByRole('heading', { name: '策略控制台', exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '运行回测' }).click()

    const backtestCard = page.locator('div').filter({
      has: page.getByRole('heading', { name: '回测结果' }),
    }).first()

    await expect(backtestCard.getByText(/请求数据源：/)).toBeVisible({ timeout: 30000 })
    await expect(backtestCard.getByText(/实际数据源：/)).toBeVisible({ timeout: 30000 })
    await expect(backtestCard.getByText(/gate → gate|gate → mock（已回退）/).first()).toBeVisible({ timeout: 30000 })
  })

  test('运行一次策略执行后显示 runner 数据源透明字段', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Quant Gate MVP')).toBeVisible()

    await openWindow(page, '策略控制')
    await page.getByRole('button', { name: '运行一次策略执行' }).click()

    const runnerCard = page.locator('div').filter({
      has: page.getByRole('heading', { name: 'Runner 状态' }),
    }).first()

    await expect(runnerCard.getByText('市场数据源：')).toBeVisible({ timeout: 30000 })
    await expect(runnerCard.getByText(/gate → gate|gate → mock（已回退）|未知/).first()).toBeVisible({ timeout: 30000 })
  })

  test('历史筛选可以联动更新当前筛选显示', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/Quant Gate MVP|正在加载 Quant Gate 控制台/)).toBeVisible()
    await expect(page.getByText('Quant Gate MVP')).toBeVisible({ timeout: 30000 })

    await openWindow(page, '历史筛选')
    await expect(page.getByRole('heading', { name: '历史筛选', exact: true }).first()).toBeVisible()

    const filterCard = page.locator('div').filter({
      has: page.getByRole('heading', { name: '历史筛选', exact: true }).first(),
    }).first()

    await filterCard.locator('select').nth(0).selectOption('BTC_USDT')
    await filterCard.locator('select').nth(1).selectOption('filled')

    await openWindow(page, '历史订单')
    await expectHistoryHeaderChips(page, '历史订单', ['BTC_USDT', 'filled', '全部事件', '全部来源'])

    await openWindow(page, '历史筛选')
    await filterCard.getByRole('button', { name: '清空筛选' }).click()

    await openWindow(page, '历史订单')
    await expectHistoryHeaderChips(page, '历史订单', ['全部交易对', '全部状态', '全部事件', '全部来源'])
  })

  test('来源筛选可以区分 manual 和 runner 订单', async ({ page }) => {
    await ensureSourceHistory(page, 'manual')
    await ensureSourceHistory(page, 'runner')

    await page.goto('/')
    await expect(page.getByText(/Quant Gate MVP|正在加载 Quant Gate 控制台/)).toBeVisible()
    await expect(page.getByText('Quant Gate MVP')).toBeVisible({ timeout: 30000 })

    await openWindow(page, '历史筛选')
    const filterCard = page.locator('div').filter({
      has: page.getByRole('heading', { name: '历史筛选', exact: true }).first(),
    }).first()

    await filterCard.locator('select').nth(3).selectOption('runner')
    await openWindow(page, '历史订单')
    await expectHistoryHeaderChips(page, '历史订单', ['全部交易对', '全部状态', '全部事件', 'runner'])
    await expectOrderSourceVisible(page, 'runner')

    await openWindow(page, '历史筛选')
    await filterCard.locator('select').nth(3).selectOption('manual')
    await openWindow(page, '历史订单')
    await expectHistoryHeaderChips(page, '历史订单', ['全部交易对', '全部状态', '全部事件', 'manual'])
    await expectOrderSourceVisible(page, 'manual')
  })

  test('事件类型筛选和订单事件展示可联调', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Quant Gate MVP')).toBeVisible()

    await openWindow(page, '模拟交易')
    const paperCard = page.locator('div').filter({
      has: page.getByRole('heading', { name: '模拟交易执行台' }).first(),
    }).first()

    await paperCard.getByRole('combobox', { name: '交易对' }).first().selectOption('ETH_USDT')
    await paperCard.getByRole('combobox', { name: '运行模式' }).selectOption('manual')
    await paperCard.getByRole('combobox', { name: '方向' }).last().selectOption('long')
    await paperCard.getByRole('button', { name: /手动开仓|已启动机器人/ }).click()
    await paperCard.getByRole('button', { name: '更新标记价' }).click()
    await paperCard.getByRole('button', { name: '模拟平仓' }).click()

    await openWindow(page, '历史筛选')
    const filterCard = page.locator('div').filter({
      has: page.getByRole('heading', { name: '历史筛选', exact: true }).first(),
    }).first()
    await filterCard.locator('select').nth(0).selectOption('ETH_USDT')
    await filterCard.locator('select').nth(2).selectOption('close')

    await openWindow(page, '历史订单')
    await expectHistoryHeaderChips(page, '历史订单', ['ETH_USDT', '全部状态', 'close', '全部来源'])
    await expect(page.getByText('close', { exact: true }).first()).toBeVisible()

    await openWindow(page, '历史筛选')
    await filterCard.locator('select').nth(2).selectOption('mark')
    await openWindow(page, '历史订单')
    await expectHistoryHeaderChips(page, '历史订单', ['ETH_USDT', '全部状态', 'mark', '全部来源'])
    await expect(page.getByText('mark', { exact: true }).first()).toBeVisible()
  })
})
