import { chromium as playwrightChromium } from "playwright";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { domainConfigs } from "./configs.js";
import { parseAmountToMinor } from "../utils/money.js";

const chromium = addExtra(playwrightChromium);
chromium.use(StealthPlugin());

const CURRENCY_WORDS = ["usd", "eur", "gbp", "cad", "aud", "jpy", "chf"];

/** Parse price text to integer minor units, or null when ambiguous. */
export function parsePriceToMinor(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let text = raw.trim().toLowerCase();
  if (!text) return null;
  for (const word of CURRENCY_WORDS) text = text.split(word).join(" ");
  text = text.replace(/[$€£¥₹]/g, " ").replace(/,/g, "").trim().replace(/\s+/g, " ");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return parseAmountToMinor(text);
}

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
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const config = domainConfigs[hostname];
    let amountMinor: number | null = null;
    let currency: string | null = null;

    if (config) {
      await page.waitForSelector(config.selectors.price, { timeout: 10000 }).catch(() => {});
      const el = await page.$(config.selectors.price);
      if (el) {
        const minor = parsePriceToMinor(await el.textContent());
        if (minor !== null) {
          amountMinor = minor;
          currency = config.selectors.currency ?? "USD";
        }
      }
    }
    await browser.close();
    return { amountMinor, currency };
  } catch (error) {
    console.error("Scrape failed:", error);
    return { amountMinor: null, currency: null };
  }
}
