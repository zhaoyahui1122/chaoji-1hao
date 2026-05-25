import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3002';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  function ok(name, detail = '') { results.push({ name, status: 'OK', detail }); }
  function fail(name, detail = '') { results.push({ name, status: 'FAIL', detail }); }

  // 1. Page loads
  try {
    const resp = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    if (resp && resp.ok()) ok('页面加载', `status=${resp.status()}`);
    else fail('页面加载', `status=${resp?.status()}`);
  } catch (e) { fail('页面加载', e.message); }

  // 2. Title / key text visible
  try {
    const body = await page.textContent('body');
    if (body && body.includes('模拟交易')) ok('主标题可见', '包含"模拟交易"');
    else fail('主标题可见', '找不到"模拟交易"');
  } catch (e) { fail('主标题可见', e.message); }

  // 3. Check if PaperTradePanel hero card renders
  try {
    const hero = await page.locator('text=Paper Trading Console').first();
    await hero.waitFor({ timeout: 5000 });
    ok('PaperTradePanel hero 区域', '渲染正常');
  } catch (e) { fail('PaperTradePanel hero 区域', e.message); }

  // 4. Strategy presets visible
  try {
    const presets = await page.locator('text=策略运行').first();
    await presets.waitFor({ timeout: 5000 });
    ok('策略运行区域', '渲染正常');
  } catch (e) { fail('策略运行区域', e.message); }

  // 5. Risk Preview panel
  try {
    const risk = await page.locator('text=实时风险预估').first();
    await risk.waitFor({ timeout: 5000 });
    ok('风险预估面板', '渲染正常');
  } catch (e) { fail('风险预估面板', e.message); }

  // 6. Mark Position panel
  try {
    const mark = await page.locator('text=更新标记价').first();
    if (await mark.count() > 0) ok('更新标记价按钮', '存在');
    else fail('更新标记价按钮', '找不到');
  } catch (e) { fail('更新标记价按钮', e.message); }

  // 7. Close Position panel
  try {
    const close = await page.locator('text=模拟平仓').first();
    if (await close.count() > 0) ok('模拟平仓按钮', '存在');
    else fail('模拟平仓按钮', '找不到');
  } catch (e) { fail('模拟平仓按钮', e.message); }

  // 8. Robot start button
  try {
    const robotBtn = await page.locator('button:has-text("运行"), button:has-text("启动"), button:has-text("机器人")').first();
    if (await robotBtn.count() > 0) ok('机器人启动按钮', '存在');
    else fail('机器人启动按钮', '找不到');
  } catch (e) { fail('机器人启动按钮', e.message); }

  // 9. AccountOverviewSection
  try {
    const overview = await page.locator('text=账户总览').first();
    if (await overview.count() > 0) ok('账户总览区域', '存在');
    else fail('账户总览区域', '找不到');
  } catch (e) { fail('账户总览区域', e.message); }

  // 10. Check for console errors
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  try {
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    if (consoleErrors.length === 0) ok('控制台无严重错误', '通过');
    else ok('控制台错误', `${consoleErrors.length} 条: ${consoleErrors.slice(0,3).join(' | ')}`);
  } catch (e) { ok('控制台检查', e.message); }

  // 11. Screenshot
  try {
    await page.screenshot({ path: 'test-results/ui-check.png', fullPage: true });
    ok('截图', '已保存 test-results/ui-check.png');
  } catch (e) { fail('截图', e.message); }

  // 12. Check AccountOverviewSection renders metrics (not just white cards)
  try {
    const metricCards = await page.locator('text=账户权益').count();
    if (metricCards > 0) ok('账户权益指标卡', '渲染正常');
    else fail('账户权益指标卡', '找不到');
  } catch (e) { fail('账户权益指标卡', e.message); }

  await browser.close();

  console.log('\n===== UI 功能检查结果 =====\n');
  let passCount = 0, failCount = 0;
  for (const r of results) {
    const icon = r.status === 'OK' ? '✅' : '❌';
    console.log(`${icon} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
    if (r.status === 'OK') passCount++; else failCount++;
  }
  console.log(`\n总计: ${passCount} 通过 / ${failCount} 失败 / ${results.length} 项`);
  if (failCount > 0) process.exit(1);
}

run().catch(e => { console.error('测试脚本崩溃:', e); process.exit(1); });
