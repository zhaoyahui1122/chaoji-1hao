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

  // Navigate to Paper Trade tab
  const paperTradeBtn = await page.locator('button').filter({ hasText: /Paper Trade|模拟交易/ }).first();
  await paperTradeBtn.click();
  await page.waitForTimeout(1500);

  // Get all visible text to understand the page structure
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('=== 页面文本（前2000字） ===');
  console.log(pageText.slice(0, 2000));
  console.log('=== END ===\n');

  // Get all buttons with their text
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.textContent.trim().slice(0, 60),
      disabled: b.disabled,
      visible: b.offsetParent !== null
    }));
  });
  console.log('=== 所有按钮 ===');
  for (const b of buttons) {
    console.log((b.disabled ? '[禁用] ' : '[可用] ') + (b.visible ? '' : '[隐藏] ') + b.text);
  }
  console.log('=== END ===\n');

  // Get all sections/headers
  const headers = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => h.textContent.trim());
  });
  console.log('=== 所有标题 ===');
  for (const h of headers) console.log('- ' + h);
  console.log('=== END ===\n');

  // Get all input states
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type,
      value: i.value,
      disabled: i.disabled,
      placeholder: i.placeholder
    }));
  });
  console.log('=== 所有输入框 ===');
  for (const i of inputs) {
    console.log((i.disabled ? '[禁用] ' : '[可用] ') + 'type=' + i.type + ' value=' + i.value + ' placeholder=' + i.placeholder);
  }
  console.log('=== END ===');

  await browser.close();
}

run().catch(e => { console.error('崩溃:', e); process.exit(1); });
