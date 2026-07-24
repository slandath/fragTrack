import { chromium } from "playwright";
import { domainConfigs } from "./configs.js";

export async function scrapePrice(url: string) {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

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
  } catch {
    return { amount: null, currency: null };
  }
}
