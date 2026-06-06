import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const WEB_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100'
export const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:8001'
export const ADMIN_USERNAME = process.env.PLAYWRIGHT_ADMIN_USERNAME || 'admin'
export const ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD || '666666'

export async function loginToDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle', timeout: 30_000 })

  const usernameInput = page.locator('input[autocomplete="username"]')
  if (await usernameInput.count()) {
    await usernameInput.fill(ADMIN_USERNAME)
    await page.locator('input[autocomplete="current-password"]').fill(ADMIN_PASSWORD)
    await page.locator('button[type="submit"]').click()
  }

  await expect
    .poll(async () => {
      const bodyText = await page.textContent('body').catch(() => '')
      return bodyText || ''
    }, { timeout: 30_000 })
    .toContain('Quant Gate MVP')
}

export async function getAuthCookie(request: APIRequestContext) {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    data: {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    },
  })
  expect(response.ok()).toBeTruthy()

  const setCookie = response.headers()['set-cookie'] || ''
  const sessionCookie = setCookie.split(';')[0]
  expect(sessionCookie).toContain('=')
  return sessionCookie
}

export async function authedGet(request: APIRequestContext, path: string) {
  const cookie = await getAuthCookie(request)
  return request.get(`${API_BASE_URL}${path}`, {
    headers: {
      Cookie: cookie,
    },
  })
}

export async function authedPost(request: APIRequestContext, path: string, data: unknown) {
  const cookie = await getAuthCookie(request)
  return request.post(`${API_BASE_URL}${path}`, {
    data,
    headers: {
      Cookie: cookie,
    },
  })
}
