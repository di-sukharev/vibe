import { expect, test } from '@playwright/test'

test('keeps the public site usable when WebGL initialization fails', async ({ page }) => {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
        Reflect.set(window, 'webglFailed', true)
        return null
      }
      return originalGetContext.call(this, type, ...args)
    } as typeof originalGetContext
  })

  await page.goto('/')
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'webglFailed'))).toBe(true)

  // Let the rejected renderer configuration reach React before using the page.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await page.getByRole('navigation', { name: 'Основная навигация', exact: true })
    .getByRole('link').first().click()
  await expect(page).toHaveURL(/#features$/)
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.locator('[data-hero-scene-fallback]')).toBeVisible()
})
