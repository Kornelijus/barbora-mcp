import type { BrowserLauncher } from "./browser-sign-in.ts";
import type { SessionCookie } from "./password-sign-in.ts";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function chromeLauncher(): BrowserLauncher {
  return {
    async open(input) {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ channel: "chrome", headless: false });
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(input.loginUrl);
        const deadline = Date.now() + FIVE_MINUTES_MS;
        while (Date.now() < deadline) {
          if (page.isClosed()) return { ok: false, reason: "cancelled" };
          const response = await context.request.get(input.cartUrl, {
            failOnStatusCode: false,
            maxRedirects: 0,
            headers: { accept: "application/json", "x-target": input.target },
          });
          if (response.status() === 200) {
            const cookies = await context.cookies();
            return { ok: true, cookies: cookies.map(toSessionCookie) };
          }
          await page.waitForTimeout(1000);
        }
        return { ok: false, reason: "timed-out" };
      } catch (error) {
        if (isClosedTarget(error)) return { ok: false, reason: "cancelled" };
        throw error;
      } finally {
        await browser.close();
      }
    },
  };
}

function isClosedTarget(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("has been closed") || message.includes("Target closed");
}

function toSessionCookie(cookie: { name: string; value: string; domain: string; path: string }): SessionCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain.replace(/^\./, ""),
    path: cookie.path || "/",
  };
}
