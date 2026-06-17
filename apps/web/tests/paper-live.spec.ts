import { expect, test } from '@playwright/test'

import { authedGet, authedPost, loginToDashboard } from './helpers'

test.describe('Paper trading window live integration', () => {
  test('未登录访问实盘账户页时不暴露 API Key 表单', async ({ page }) => {
    await page.goto('/live-account')
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible()
    await expect(page.getByPlaceholder('输入 Gate.io API Key')).toHaveCount(0)
    await expect(page.getByPlaceholder('输入 Gate.io API Secret')).toHaveCount(0)
  })

  test('paper 窗口可加载实时价格并执行精确仓位链路', async ({ page }) => {
    await authedPost(page.request, '/runner/reset-paper', {})
    await loginToDashboard(page)

    await page.getByRole('button', { name: /Trade/i }).first().click()
    await expect(page.getByRole('button', { name: /实盘交易/i }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /模拟交易/i }).first()).toBeVisible()

    const paperCard = page.locator('div').filter({
      has: page.getByText(/Paper Trading Console|模拟交易执行台/).first(),
    }).first()

    await paperCard.getByRole('button', { name: 'BTC_USDT', exact: true }).click()
    await paperCard.getByLabel(/运行模式/).selectOption('manual')
    await paperCard.getByLabel(/手动方向/).selectOption('long')
    await paperCard.getByRole('button', { name: /手动开仓|已启用自动轮询|已启动机器人/ }).click()

    await expect(page.getByText(/操作目标仓位/)).toBeVisible({ timeout: 30_000 })

    const positionSelect = paperCard.getByLabel(/操作目标仓位/)
    const targetPositionId = await positionSelect.inputValue()
    expect(targetPositionId).toBeTruthy()

    await paperCard.getByRole('button', { name: '更新标记价' }).click()
    await paperCard.getByRole('button', { name: '模拟平仓' }).click()

    await expect.poll(async () => {
      const ordersResp = await authedGet(page.request, '/history/orders?limit=20&symbol=BTC_USDT')
      const ordersJson = await ordersResp.json()
      const items = Array.isArray(ordersJson.items) ? ordersJson.items : []
      const matched = items.filter((item: any) => item.position_id === targetPositionId)
      return {
        hasMark: matched.some((item: any) => item.event_type === 'mark'),
        hasClose: matched.some((item: any) => item.event_type === 'close'),
      }
    }, { timeout: 30_000 }).toEqual({ hasMark: true, hasClose: true })
  })

  test('合约实盘账户页面入口可跳转到独立页面', async ({ page }) => {
    await loginToDashboard(page)
    await page.goto('/live-account')
    await expect(page).toHaveURL(/\/live-account/)
  })
})
