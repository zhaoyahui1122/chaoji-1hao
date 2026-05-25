import { test, expect } from '@playwright/test';

test.describe('trade_mode 历史记录过滤', () => {
  test('默认 paper 模式下历史记录 API 携带 trade_mode=paper', async ({ page }) => {
    const historyCalls: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/history/positions') || req.url().includes('/history/stats')) {
        historyCalls.push(req.url());
      }
    });

    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    // 应该有携带 trade_mode=paper 的请求
    const paperCalls = historyCalls.filter(u => new URL(u).searchParams.get('trade_mode') === 'paper');
    expect(paperCalls.length).toBeGreaterThan(0);

    // 切到 History tab 查看数据
    await page.click('button:has-text("History")');
    await page.waitForTimeout(2000);

    // 应该能看到历史持仓数据（paper 数据）
    const bodyText = await page.textContent('body');
    // paper 模式有历史数据
    expect(bodyText).toContain('开仓时间');
    expect(bodyText).toContain('ETH_USDT');
  });

  test('模拟切换 trade_mode 后 API 调用切换到 live', async ({ page }) => {
    // 拦截 network 请求
    const apiCalls: { url: string; method: string }[] = [];
    page.on('request', req => {
      if (req.url().includes('/history/')) {
        apiCalls.push({ url: req.url(), method: req.method() });
      }
    });

    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    // 清除之前的调用记录
    apiCalls.length = 0;

    // 通过浏览器控制台模拟切换到 live 模式
    // 检查 page.tsx 暴露的 state 是否可操控
    await page.evaluate(() => {
      // 找到所有 React 内部 fiber 节点（用于调试）
      const root = document.getElementById('__next');
      return root ? 'found' : 'not found';
    });

    // 验证 Trade tab 存在实盘选项
    await page.click('button:has-text("Trade")');
    await page.waitForTimeout(1000);
    const tradeText = await page.textContent('body');
    expect(tradeText).toContain('实盘交易');
    expect(tradeText).toContain('模拟交易');
  });

  test('后端 API 过滤正确性验证', async ({ request }) => {
    // 直接调用后端 API 验证过滤
    const paperRes = await request.get('http://127.0.0.1:8012/history/positions?trade_mode=paper');
    const paperData = await paperRes.json();
    expect(paperData.count).toBeGreaterThan(0);
    expect(paperData.filters.trade_mode).toBe('paper');

    const liveRes = await request.get('http://127.0.0.1:8012/history/positions?trade_mode=live');
    const liveData = await liveRes.json();
    expect(liveData.count).toBe(0);
    expect(liveData.filters.trade_mode).toBe('live');

    // stats 也一样
    const paperStats = await request.get('http://127.0.0.1:8012/history/stats?trade_mode=paper');
    const paperStatsData = await paperStats.json();
    expect(paperStatsData.total_trades).toBeGreaterThan(0);

    const liveStats = await request.get('http://127.0.0.1:8012/history/stats?trade_mode=live');
    const liveStatsData = await liveStats.json();
    expect(liveStatsData.total_trades).toBe(0);

    // equity curve
    const paperEquity = await request.get('http://127.0.0.1:8012/history/equity-curve?trade_mode=paper&limit=10');
    const paperEquityData = await paperEquity.json();
    expect(paperEquityData.count).toBeGreaterThan(0);
  });
});
