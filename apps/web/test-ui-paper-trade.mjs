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

  const bodyText = await page.textContent('body');
  if (bodyText.includes('加载失败')) {
    fail('页面数据', '显示"加载失败"');
    await browser.close();
    return;
  }

  // Navigate to Paper Trade tab
  const paperTradeBtn = await page.locator('button').filter({ hasText: /Paper Trade|模拟交易/ }).first();
  if (await paperTradeBtn.count() > 0) {
    await paperTradeBtn.click();
    await page.waitForTimeout(1000);
    ok('切换到 Paper Trade', '成功');
  } else {
    fail('Paper Trade 导航', '未找到');
    await browser.close();
    return;
  }

  // Take screenshot of Paper Trade page
  await page.screenshot({ path: 'test-results/paper-trade.png', fullPage: true });

  // ========== 1. 策略选择 ==========
  try {
    const presetBtns = await page.locator('button').filter({ hasText: /经典|海龟|策略/ }).all();
    if (presetBtns.length > 0) {
      ok('策略预设按钮', presetBtns.length + ' 个');
      await presetBtns[0].click();
      await page.waitForTimeout(500);
      ok('策略选择点击', '已执行');
    } else {
      fail('策略预设按钮', '未找到');
    }
  } catch (e) { fail('策略选择', e.message); }

  // ========== 2. 运行策略按钮 ==========
  try {
    const runBtn = await page.locator('button').filter({ hasText: /运行一次|手动运行|Run/ }).first();
    if (await runBtn.count() > 0) {
      ok('运行策略按钮', '存在');
      await runBtn.click();
      await page.waitForTimeout(1000);
      ok('运行策略点击', '已执行');
    } else {
      fail('运行策略按钮', '未找到');
    }
  } catch (e) { fail('运行策略按钮', e.message); }

  // ========== 3. 更新标记价 ==========
  try {
    // Find by looking for the text first
    const markText = await page.locator('text=更新标记价').first();
    if (await markText.count() > 0) {
      ok('更新标记价标题', '存在');
      
      // Find input near it
      const markInput = await page.locator('input[type="number"]').nth(0);
      if (await markInput.count() > 0) {
        await markInput.fill('65000');
        await page.waitForTimeout(300);
        ok('标记价输入', '已填入 65000');
      }
      
      // Find mark button
      const markBtn = await page.locator('button').filter({ hasText: /更新标记|标记|Mark/ }).first();
      if (await markBtn.count() > 0) {
        await markBtn.click();
        await page.waitForTimeout(500);
        ok('更新标记价按钮', '已点击');
      } else {
        fail('更新标记价按钮', '未找到');
      }
    } else {
      // Try alternate text
      const altMark = await page.locator('text=标记价').first();
      if (await altMark.count() > 0) {
        ok('标记价区域', '存在（备用文案）');
      } else {
        fail('更新标记价区域', '未找到');
      }
    }
  } catch (e) { fail('更新标记价', e.message); }

  // ========== 4. 模拟平仓 ==========
  try {
    const closeText = await page.locator('text=模拟平仓').first();
    if (await closeText.count() > 0) {
      ok('模拟平仓标题', '存在');
      
      const closeBtn = await page.locator('button').filter({ hasText: /平仓|Close|关闭/ }).first();
      if (await closeBtn.count() > 0) {
        ok('模拟平仓按钮', '存在');
        // Don't click to avoid side effects
      } else {
        fail('模拟平仓按钮', '未找到');
      }
    } else {
      fail('模拟平仓区域', '未找到');
    }
  } catch (e) { fail('模拟平仓', e.message); }

  // ========== 5. 机器人启停 ==========
  try {
    const robotText = await page.locator('text=机器人').first();
    if (await robotText.count() > 0) {
      ok('机器人标题', '存在');
      
      const robotBtn = await page.locator('button').filter({ hasText: /运行|启动|停止|Stop|Start/ }).first();
      if (await robotBtn.count() > 0) {
        const btnText = await robotBtn.textContent();
        const isDisabled = await robotBtn.isDisabled();
        ok('机器人按钮', '文案: ' + (btnText||'').trim() + ', 状态: ' + (isDisabled ? '禁用' : '可用'));
      } else {
        fail('机器人按钮', '未找到');
      }
    } else {
      fail('机器人区域', '未找到');
    }
  } catch (e) { fail('机器人', e.message); }

  // ========== 6. 风险预估面板 ==========
  try {
    const riskText = await page.locator('text=风险预估').first();
    if (await riskText.count() > 0) {
      ok('风险预估面板', '存在');
    } else {
      fail('风险预估面板', '未找到');
    }
  } catch (e) { fail('风险预估', e.message); }

  // ========== 7. 输入框交互 ==========
  try {
    const inputs = await page.locator('input').all();
    ok('输入框总数', inputs.length + ' 个');
    
    // Test price input
    const priceInput = await page.locator('input[type="number"]').nth(0);
    if (await priceInput.count() > 0) {
      await priceInput.fill('70000');
      const val = await priceInput.inputValue();
      ok('价格输入测试', '填入 70000, 实际值: ' + val);
    }
  } catch (e) { fail('输入框交互', e.message); }

  // ========== 8. 下拉选择 ==========
  try {
    const selects = await page.locator('select').all();
    ok('下拉框', selects.length + ' 个');
  } catch (e) { fail('下拉框', e.message); }

  // ========== 9. 按钮总数 ==========
  try {
    const allBtns = await page.locator('button').all();
    ok('页面按钮总数', allBtns.length + ' 个');
  } catch (e) { fail('按钮统计', e.message); }

  // ========== 10. 截图 ==========
  try {
    await page.screenshot({ path: 'test-results/paper-trade-full.png', fullPage: true });
    ok('截图', '已保存');
  } catch (e) { fail('截图', e.message); }

  await browser.close();

  // Summary
  console.log('\n===== Paper Trade 功能检查 =====\n');
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
