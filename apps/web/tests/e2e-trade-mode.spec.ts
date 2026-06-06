import { expect, test } from '@playwright/test'

import { authedGet, loginToDashboard } from './helpers'

test.describe('trade_mode 历史记录过滤', () => {
  test('默认 paper 模式下历史记录 API 携带 trade_mode=paper', async ({ page }) => {
    const historyCalls: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/history/positions') || req.url().includes('/history/stats')) {
        historyCalls.push(req.url())
      }
    })

    await loginToDashboard(page)
    await page.waitForTimeout(3000)

    const paperCalls = historyCalls.filter((url) => new URL(url).searchParams.get('trade_mode') === 'paper')
    expect(paperCalls.length).toBeGreaterThan(0)
  })

  test('切换到交易工作区后可见实盘 / 模拟模式入口', async ({ page }) => {
    await loginToDashboard(page)
    await page.getByRole('button', { name: /Trade/i }).first().click()
    await page.waitForTimeout(1000)

    const bodyText = await page.textContent('body')
    expect(bodyText).toContain('实盘交易')
    expect(bodyText).toContain('模拟交易')
  })

  test('后端 API 过滤正确性验证', async ({ request }) => {
    const paperRes = await authedGet(request, '/history/positions?trade_mode=paper')
    const paperData = await paperRes.json()
    expect(paperData.count).toBeGreaterThan(0)
    expect(paperData.filters.trade_mode).toBe('paper')

    const liveRes = await authedGet(request, '/history/positions?trade_mode=live')
    const liveData = await liveRes.json()
    expect(liveData.count).toBe(0)
    expect(liveData.filters.trade_mode).toBe('live')

    const paperStats = await authedGet(request, '/history/stats?trade_mode=paper')
    const paperStatsData = await paperStats.json()
    expect(paperStatsData.total_trades).toBeGreaterThan(0)

    const liveStats = await authedGet(request, '/history/stats?trade_mode=live')
    const liveStatsData = await liveStats.json()
    expect(liveStatsData.total_trades).toBe(0)

    const paperEquity = await authedGet(request, '/history/equity-curve?trade_mode=paper&limit=10')
    const paperEquityData = await paperEquity.json()
    expect(paperEquityData.count).toBeGreaterThan(0)
  })
})
