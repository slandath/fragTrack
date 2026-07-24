import { config } from "dotenv";
import { scrapePrice } from "../server/scraper/index.js";

config();

const API_URL = process.env.API_URL;
const API_KEY = process.env.API_KEY;

if (!API_URL || !API_KEY) {
  console.error("Missing API_URL or API_KEY in .env");
  process.exit(1);
}

async function trpcQuery(path: string) {
  const res = await fetch(`${API_URL}/trpc/${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const json = await res.json();
  return (Array.isArray(json) ? json[0] : json).result.data;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/trpc/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ "0": input }),
  });
  const json = await res.json();
  return (Array.isArray(json) ? json[0] : json).result.data;
}

async function main() {
  const urls: {
    retailer_url: { id: string; url: string };
    fragrance: { brand: string; name: string };
  }[] = await trpcQuery("getUserUrls");

  console.log(`\nScraping ${urls.length} URLs...\n`);

  for (let i = 0; i < urls.length; i++) {
    const { retailer_url, fragrance } = urls[i];
    process.stdout.write(`[${i + 1}/${urls.length}] ${fragrance.brand} - ${fragrance.name}... `);

    try {
      const price = await scrapePrice(retailer_url.url);
      if (price.amount) {
        await trpcMutate("storePrice", {
          retailerUrlId: retailer_url.id,
          amount: price.amount,
          currency: price.currency ?? "USD",
        });
        console.log(`$${price.amount}`);
      } else {
        console.log("No price found");
      }
    } catch (err) {
      console.log(`Error: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone: ${urls.length}/${urls.length} URLs processed.\n`);
}

main().catch(console.error);
