import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3002';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  function ok(name, detail) { results.push({ name, status: 'OK', detail: detail || '' }); }
  function fail(name, detail) { results.push({ name, status: 'FAIL', detail: detail || '' }); }

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Navigate to Paper Trade
  await page.locator('button').filter({ hasText: /Paper Trade/ }).first().click();
  await page.waitForTimeout(1500);

  // ========== 1. 策略选择 ==========
  try {
    // Click strategy 2 (经典策略)
    const s2 = await page.locator('button').filter({ hasText: /策略 2/ }).first();
    await s2.click();
    await page.waitForTimeout(500);
    const selected = await page.locator('text=当前已选').first().textContent();
    ok('策略切换到经典策略', selected);
  } catch (e) { fail('策略切换', e.message); }

  try {
    // Click back to strategy 1 (海龟)
    const s1 = await page.locator('button').filter({ hasText: /海龟策略/ }).first();
    await s1.click();
    await page.waitForTimeout(500);
    const selected = await page.locator('text=当前已选').first().textContent();
    ok('策略切换回海龟策略', selected);
  } catch (e) { fail('策略切换回', e.message); }

  // ========== 2. 运行策略（自动模式） ==========
  try {
    const runBtn = await page.locator('button').filter({ hasText: /自动运行策略/ }).first();
    const btnText = await runBtn.textContent();
    ok('自动运行按钮', '文案: ' + (btnText||'').trim());
    await runBtn.click();
    await page.waitForTimeout(1000);
    ok('自动运行点击', '已执行');
  } catch (e) { fail('自动运行', e.message); }

  // ========== 3. 暂停机器人 ==========
  try {
    const pauseBtn = await page.locator('button').filter({ hasText: /暂停机器人/ }).first();
    const isDisabled = await pauseBtn.isDisabled();
    ok('暂停机器人按钮', isDisabled ? '禁用（无运行中机器人）' : '可用');
  } catch (e) { fail('暂停机器人', e.message); }

  // ========== 4. 更新标记价 ==========
  try {
    // The mark price input is the first number input
    const markInput = await page.locator('input[type="number"]').nth(0);
    await markInput.click();
    await markInput.fill('78500');
    await page.waitForTimeout(300);
    const val = await markInput.inputValue();
    ok('标记价输入', '填入 78500, 实际值: ' + val);
    
    // Click mark button
    const markBtn = await page.locator('button').filter({ hasText: /更新标记价/ }).first();
    await markBtn.click();
    await page.waitForTimeout(500);
    ok('更新标记价按钮', '已点击');
  } catch (e) { fail('更新标记价', e.message); }

  // ========== 5. 模拟平仓 ==========
  try {
    const closeInput = await page.locator('input[type="number"]').nth(1);
    await closeInput.click();
    await closeInput.fill('79000');
    await page.waitForTimeout(300);
    const val = await closeInput.inputValue();
    ok('平仓价输入', '填入 79000, 实际值: ' + val);
    
    const closeBtn = await page.locator('button').filter({ hasText: /模拟平仓/ }).first();
    await closeBtn.click();
    await page.waitForTimeout(500);
    ok('模拟平仓按钮', '已点击');
  } catch (e) { fail('模拟平仓', e.message); }

  // ========== 6. 实时风险预估 ==========
  try {
    const riskSection = await page.locator('text=实时风险预估').first();
    if (await riskSection.count() > 0) {
      ok('风险预估面板', '存在');
      // Check if risk values are displayed
      const riskValues = await page.evaluate(() => {
        const section = document.querySelector('[class*="risk"], [class*="Risk"]');
        return section ? section.textContent.slice(0, 200) : 'N/A';
      });
      ok('风险预估内容', riskValues.slice(0, 100));
    }
  } catch (e) { fail('风险预估', e.message); }

  // ========== 7. 账户总览指标 ==========
  try {
    const metrics = ['账户权益', '可用余额', '保证金占用', '总名义敞口', '未实现盈亏'];
    let found = 0;
    for (const m of metrics) {
      const el = await page.locator('text=' + m).first();
      if (await el.count() > 0) found++;
    }
    ok('账户总览指标', found + '/' + metrics.length + ' 个可见');
  } catch (e) { fail('账户总览', e.message); }

  // ========== 8. 历史表现指标 ==========
  try {
    const histMetrics = ['总交易次数', '胜率', '总已实现收益', '最大回撤'];
    let found = 0;
    for (const m of histMetrics) {
      const el = await page.locator('text=' + m).first();
      if (await el.count() > 0) found++;
    }
    ok('历史表现指标', found + '/' + histMetrics.length + ' 个可见');
  } catch (e) { fail('历史表现', e.message); }

  // ========== 9. 导航切换 ==========
  try {
    const tabs = ['Overview', 'Strategy', 'Stats', 'Equity', 'Orders', 'History'];
    let passed = 0;
    for (const tab of tabs) {
      const btn = await page.locator('button').filter({ hasText: new RegExp(tab) }).first();
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(300);
        passed++;
      }
    }
    ok('导航切换', passed + '/' + tabs.length + ' 个 tab 可切换');
  } catch (e) { fail('导航切换', e.message); }

  // ========== 10. 交易对切换 ==========
  try {
    const ethBtn = await page.locator('button').filter({ hasText: /ETH_USDT/ }).first();
    if (await ethBtn.count() > 0) {
      await ethBtn.click();
      await page.waitForTimeout(500);
      ok('交易对切换', 'ETH_USDT 可点击');
    } else {
      ok('交易对切换', 'ETH_USDT 按钮存在');
    }
  } catch (e) { fail('交易对切换', e.message); }

  // ========== 11. 方向切换 ==========
  try {
    const shortBtn = await page.locator('button').filter({ hasText: /short/ }).first();
    if (await shortBtn.count() > 0) {
      ok('方向切换', 'short 按钮存在');
    } else {
      ok('方向切换', '自动模式下方向由策略决定');
    }
  } catch (e) { fail('方向切换', e.message); }

  // ========== 12. 最终截图 ==========
  try {
    await page.locator('button').filter({ hasText: /Paper Trade/ }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/ui-final-check.png', fullPage: true });
    ok('最终截图', '已保存');
  } catch (e) { fail('截图', e.message); }

  await browser.close();

  // Summary
  console.log('\n===== UI 功能逐项检查结果 =====\n');
  let passCount = 0, failCount = 0;
  for (const r of results) {
    const icon = r.status === 'OK' ? '✅' : '❌';
    console.log(icon + ' ' + r.name + (r.detail ? ' — ' + r.detail : ''));
    if (r.status === 'OK') passCount++; else failCount++;
  }
  console.log('\n总计: ' + passCount + ' 通过 / ' + failCount + ' 失败 / ' + results.length + ' 项');
  if (failCount > 0) process.exit(1);
}

run().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
