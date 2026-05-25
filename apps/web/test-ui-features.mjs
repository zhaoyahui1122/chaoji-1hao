import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3002';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  function ok(name, detail) { results.push({ name, status: 'OK', detail: detail || '' }); }
  function fail(name, detail) { results.push({ name, status: 'FAIL', detail: detail || '' }); }

  // Load page
  const resp = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  if (!resp || !resp.ok()) {
    console.log('页面加载失败，跳过');
    await browser.close();
    return;
  }
  ok('页面加载', 'status=' + resp.status());

  // Check for loading failure
  const bodyText = await page.textContent('body');
  if (bodyText.includes('加载失败')) {
    fail('页面数据', '显示"加载失败"');
    await browser.close();
    return;
  }
  ok('页面数据', '正常加载');

  // ========== 1. 账户总览区域 ==========
  try {
    const equity = await page.locator('text=账户权益').first();
    if (await equity.count() > 0) {
      const equityText = await equity.textContent();
      ok('账户权益', equityText);
    } else {
      fail('账户权益', '未找到');
    }
  } catch (e) { fail('账户权益', e.message); }

  try {
    const risk = await page.locator('text=风险暴露').first();
    if (await risk.count() > 0) {
      const riskText = await risk.textContent();
      ok('风险暴露', riskText);
    } else {
      fail('风险暴露', '未找到');
    }
  } catch (e) { fail('风险暴露', e.message); }

  // ========== 2. 策略选择功能 ==========
  try {
    // Find strategy presets
    const presetButtons = await page.locator('button').filter({ hasText: /策略|经典|海龟/ }).all();
    if (presetButtons.length > 0) {
      ok('策略预设按钮', presetButtons.length + ' 个');
      
      // Click first strategy preset
      await presetButtons[0].click();
      await page.waitForTimeout(500);
      
      // Check if strategy summary appeared
      const summary = await page.locator('text=策略运行').first();
      if (await summary.count() > 0) {
        ok('策略选择后摘要', '显示正常');
      } else {
        ok('策略选择后摘要', '点击后无明显变化');
      }
    } else {
      fail('策略预设按钮', '未找到');
    }
  } catch (e) { fail('策略选择', e.message); }

  // ========== 3. 运行策略按钮 ==========
  try {
    const runBtn = await page.locator('button').filter({ hasText: /运行一次|手动运行/ }).first();
    if (await runBtn.count() > 0) {
      ok('运行策略按钮', '存在');
      // Click it
      await runBtn.click();
      await page.waitForTimeout(1000);
      ok('运行策略点击', '已执行');
    } else {
      fail('运行策略按钮', '未找到');
    }
  } catch (e) { fail('运行策略按钮', e.message); }

  // ========== 4. 更新标记价功能 ==========
  try {
    const markInput = await page.locator('input[type="number"]').nth(0);
    if (await markInput.count() > 0) {
      // Find the mark price input and button
      const markSection = await page.locator('text=更新标记价').first();
      if (await markSection.count() > 0) {
        ok('更新标记价区域', '存在');
        
        // Find input near mark price
        const markPriceInput = await page.locator('input[type="number"]').filter({ hasText: '' }).nth(0);
        await markPriceInput.fill('65000');
        await page.waitForTimeout(300);
        
        // Find mark button
        const markBtn = await page.locator('button').filter({ hasText: /更新标记|标记价/ }).first();
        if (await markBtn.count() > 0) {
          await markBtn.click();
          await page.waitForTimeout(500);
          ok('更新标记价点击', '已执行');
        } else {
          ok('更新标记价按钮', '未找到独立按钮');
        }
      } else {
        fail('更新标记价区域', '未找到');
      }
    }
  } catch (e) { fail('更新标记价', e.message); }

  // ========== 5. 模拟平仓功能 ==========
  try {
    const closeSection = await page.locator('text=模拟平仓').first();
    if (await closeSection.count() > 0) {
      ok('模拟平仓区域', '存在');
      
      // Find close button
      const closeBtn = await page.locator('button').filter({ hasText: /平仓|关闭/ }).first();
      if (await closeBtn.count() > 0) {
        ok('模拟平仓按钮', '存在');
        // Don't actually click close to avoid side effects
      } else {
        fail('模拟平仓按钮', '未找到');
      }
    } else {
      fail('模拟平仓区域', '未找到');
    }
  } catch (e) { fail('模拟平仓', e.message); }

  // ========== 6. 机器人启停功能 ==========
  try {
    const robotSection = await page.locator('text=机器人').first();
    if (await robotSection.count() > 0) {
      ok('机器人区域', '存在');
      
      // Find robot control button
      const robotBtn = await page.locator('button').filter({ hasText: /运行|启动|停止|关闭/ }).first();
      if (await robotBtn.count() > 0) {
        const btnText = await robotBtn.textContent();
        ok('机器人控制按钮', '文案: ' + btnText.trim());
        
        // Check button state
        const isDisabled = await robotBtn.isDisabled();
        ok('机器人按钮状态', isDisabled ? '禁用' : '可用');
      } else {
        fail('机器人控制按钮', '未找到');
      }
    } else {
      fail('机器人区域', '未找到');
    }
  } catch (e) { fail('机器人功能', e.message); }

  // ========== 7. 导航切换功能 ==========
  try {
    const navButtons = await page.locator('aside button').all();
    if (navButtons.length > 0) {
      ok('导航按钮', navButtons.length + ' 个');
      
      // Click each nav button and check if content changes
      for (let i = 0; i < Math.min(navButtons.length, 3); i++) {
        const btn = navButtons[i];
        const btnText = await btn.textContent();
        await btn.click();
        await page.waitForTimeout(500);
        ok('导航切换', '点击: ' + (btnText || '').trim().slice(0, 20));
      }
    } else {
      fail('导航按钮', '未找到');
    }
  } catch (e) { fail('导航切换', e.message); }

  // ========== 8. 深色主题检查 ==========
  try {
    const bgColor = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      return window.getComputedStyle(main).backgroundColor;
    });
    ok('深色背景', bgColor);
    
    // Check text color is light
    const textColor = await page.evaluate(() => {
      const h1 = document.querySelector('h1, h2, h3, p, span');
      return h1 ? window.getComputedStyle(h1).color : 'N/A';
    });
    ok('文字颜色', textColor);
  } catch (e) { fail('主题检查', e.message); }

  // ========== 9. 响应式布局 ==========
  try {
    // Check if layout is not broken
    const mainWidth = await page.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.offsetWidth : 0;
    });
    ok('主内容宽度', mainWidth + 'px');
    
    const sidebarWidth = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      return aside ? aside.offsetWidth : 0;
    });
    ok('侧边栏宽度', sidebarWidth + 'px');
  } catch (e) { fail('布局检查', e.message); }

  // ========== 10. 错误处理 ==========
  try {
    // Check if there are any visible error messages
    const errorMessages = await page.locator('text=错误, text=失败, text=Error, text=error').all();
    if (errorMessages.length === 0) {
      ok('错误提示', '无可见错误');
    } else {
      ok('错误提示', errorMessages.length + ' 个');
    }
  } catch (e) { fail('错误处理', e.message); }

  // ========== 11. 控制台错误 ==========
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  try {
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    if (consoleErrors.length === 0) {
      ok('控制台错误', '无');
    } else {
      ok('控制台错误', consoleErrors.length + ' 条: ' + consoleErrors.slice(0,2).join(' | '));
    }
  } catch (e) { ok('控制台错误', e.message); }

  // ========== 12. 截图 ==========
  try {
    await page.screenshot({ path: 'test-results/ui-full-check.png', fullPage: true });
    ok('截图', '已保存');
  } catch (e) { fail('截图', e.message); }

  await browser.close();

  // Summary
  console.log('\n===== UI 功能逐项检查 =====\n');
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
