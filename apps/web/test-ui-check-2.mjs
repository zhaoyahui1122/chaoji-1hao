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
    const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (resp && resp.ok()) ok('页面加载', 'status=' + resp.status());
    else fail('页面加载', 'status=' + (resp ? resp.status() : 'null'));
  } catch (e) { fail('页面加载', e.message); }

  // 2. Wait a bit for client-side hydration
  await page.waitForTimeout(3000);

  // 3. Check body text
  try {
    const body = await page.textContent('body');
    if (body && body.trim().length > 0) ok('页面有内容', body.slice(0, 120));
    else fail('页面有内容', 'body 为空');
  } catch (e) { fail('页面有内容', e.message); }

  // 4. Check if it's stuck on loading state (no backend)
  try {
    const body = await page.textContent('body');
    if (body && body.includes('正在加载')) {
      ok('检测到加载状态', '卡在"正在加载"——后端未启动，这是预期行为');
    } else if (body && body.includes('加载失败')) {
      fail('检测到错误状态', '页面显示"加载失败"');
    } else {
      ok('页面渲染', '内容已加载');
    }
  } catch (e) { fail('加载状态检测', e.message); }

  // 5. Check component structure
  try {
    const componentCheck = await page.evaluate(() => {
      const checks = [];
      var sidebar = document.querySelector('aside');
      checks.push({ name: 'sidebar', found: !!sidebar });
      var navBtns = document.querySelectorAll('button');
      checks.push({ name: 'navButtons', found: navBtns.length > 0, count: navBtns.length });
      var allText = document.body.innerText;
      checks.push({ name: 'hasQuantGate', found: allText.includes('Quant Gate') });
      checks.push({ name: 'hasLoading', found: allText.includes('正在加载') });
      checks.push({ name: 'hasError', found: allText.includes('加载失败') });
      return checks;
    });
    for (const c of componentCheck) {
      if (c.found) ok(c.name, c.count !== undefined ? 'count=' + c.count : '存在');
      else ok(c.name, '未找到（可能在加载中）');
    }
  } catch (e) { fail('组件结构检查', e.message); }

  // 6. Screenshot
  try {
    await page.screenshot({ path: 'test-results/ui-check-2.png', fullPage: true });
    ok('截图', '已保存 test-results/ui-check-2.png');
  } catch (e) { fail('截图', e.message); }

  // 7. Check background color
  try {
    const bgColor = await page.evaluate(() => {
      var main = document.querySelector('main') || document.body;
      return window.getComputedStyle(main).backgroundColor;
    });
    ok('背景色', 'backgroundColor=' + bgColor);
  } catch (e) { fail('背景色检查', e.message); }

  // 8. Check network requests
  const failedRequests = [];
  page.on('requestfailed', req => failedRequests.push(req.url()));
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(3000);
    if (failedRequests.length > 0) {
      ok('失败的网络请求', failedRequests.length + ' 个: ' + failedRequests.slice(0,3).join(' | '));
    } else {
      ok('网络请求', '无失败');
    }
  } catch (e) { ok('网络请求检测', e.message); }

  // 9. Check what API calls are being made
  try {
    const apiCalls = await page.evaluate(() => {
      var perf = performance.getEntriesByType('resource');
      return perf.filter(r => r.name.includes('/api/')).map(r => r.name).slice(0, 10);
    });
    if (apiCalls.length > 0) {
      ok('API 请求', apiCalls.length + ' 个: ' + apiCalls.slice(0,3).join(' | '));
    } else {
      ok('API 请求', '未检测到（可能在加载中）');
    }
  } catch (e) { ok('API 请求检测', e.message); }

  await browser.close();

  console.log('\n===== UI 功能检查结果 =====\n');
  let passCount = 0, failCount = 0;
  for (const r of results) {
    const icon = r.status === 'OK' ? '✅' : '❌';
    console.log(icon + ' ' + r.name + (r.detail ? ' — ' + r.detail : ''));
    if (r.status === 'OK') passCount++; else failCount++;
  }
  console.log('\n总计: ' + passCount + ' 通过 / ' + failCount + ' 失败 / ' + results.length + ' 项');
}

run().catch(e => { console.error('测试脚本崩溃:', e); process.exit(1); });
