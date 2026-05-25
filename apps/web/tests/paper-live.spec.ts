import { expect, test } from '@playwright/test'

test.describe('Paper trading window live integration', () => {
  test('paper 窗口可加载实时价格并执行精确仓位链路', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/Quant Gate MVP|正在加载 Quant Gate 控制台/)).toBeVisible()
    await expect(page.getByText('Quant Gate MVP')).toBeVisible({ timeout: 30000 })

    await page.getByRole('button', { name: /模拟交易/ }).click()
    await expect(page.getByRole('heading', { name: '模拟交易', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '模拟交易执行台' }).first()).toBeVisible()

    await expect(page.getByText(/实时最新价：/)).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(/实时标记价：/)).toBeVisible({ timeout: 30000 })

    const paperCard = page.locator('div').filter({
      has: page.getByRole('heading', { name: '模拟交易执行台' }).first(),
    }).first()

    await paperCard.getByRole('combobox', { name: '交易对' }).first().selectOption('BTC_USDT')
    await paperCard.getByRole('combobox', { name: '运行模式' }).selectOption('manual')
    await paperCard.getByRole('combobox', { name: '方向' }).last().selectOption('long')
    await paperCard.getByRole('button', { name: /手动开仓|已启动机器人/ }).click()

    await expect(page.getByText(/操作目标仓位/)).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(/当前选中：/)).toBeVisible({ timeout: 30000 })

    const positionSelect = paperCard.getByRole('combobox', { name: '操作目标仓位' })
    const targetPositionId = await positionSelect.inputValue()
    expect(targetPositionId).toBeTruthy()

    await paperCard.getByRole('button', { name: '更新标记价' }).click()
    await paperCard.getByRole('button', { name: '模拟平仓' }).click()

    await expect.poll(async () => {
      const ordersResp = await page.request.get('http://127.0.0.1:8012/history/orders?limit=20&symbol=BTC_USDT')
      const ordersJson = await ordersResp.json()
      const items = Array.isArray(ordersJson.items) ? ordersJson.items : []
      const matched = items.filter((item: any) => item.position_id === targetPositionId)
      return {
        hasMark: matched.some((item: any) => item.event_type === 'mark'),
        hasClose: matched.some((item: any) => item.event_type === 'close'),
      }
    }, { timeout: 30000 }).toEqual({ hasMark: true, hasClose: true })
  })

  test('合约实盘账户页面入口可跳转到独立页面', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: '合约实盘账户' }).click()
    await expect(page).toHaveURL(/\/live-account/)
    await expect(page.getByRole('heading', { name: '合约实盘账户' })).toBeVisible()
  })
})
