import { chromium } from "playwright";
import { domainConfigs } from "./configs.js";

export async function scrapePrice(url: string) {
  try {
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    await page.goto(url, { waitUntil: "load" });

    const hostname = new URL(url).hostname;
    const config = domainConfigs[hostname];
    let amount: string | null = null;
    let currency: string | null = null;

    if (config) {
      await page.waitForSelector(config.selectors.price, { timeout: 10000 }).catch(() => {});

      const el = await page.$(config.selectors.price);
      if (el) {
        const raw = (await el.textContent())?.trim().replace(/[^0-9.]/g, "") ?? null;
        if (raw) {
          amount = raw;
          currency = config.selectors.currency ?? "USD";
        }
      }
    }

    await browser.close();
    return { amount, currency };
  } catch (error) {
    console.error("Scrape failed:", error);
    return { amount: null, currency: null };
  }
}
