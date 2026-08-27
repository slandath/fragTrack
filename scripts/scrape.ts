import { config } from "dotenv";
import { scrapePrice } from "../server/scraper/index.js";

config();

const API_URL = process.env.API_URL;
const API_KEY = process.env.API_KEY;

if (!API_URL || !API_KEY) {
  console.error("Missing API_URL or API_KEY in .env");
  process.exit(1);
}

async function readTrpcResponse(res: Response) {
  const json = await res.json();
  const payload = Array.isArray(json) ? json[0] : json;
  if (!res.ok || payload.error) {
    throw new Error(payload.error?.json?.message ?? `tRPC request failed (${res.status})`);
  }
  return payload.result.data;
}

async function trpcQuery(path: string) {
  const res = await fetch(`${API_URL}/trpc/${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return readTrpcResponse(res);
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/trpc/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return readTrpcResponse(res);
}

async function main() {
  const urls: {
    retailer_url: { id: string; url: string };
    fragrance: { brand: string; name: string };
  }[] = await trpcQuery("getUserUrls");

  console.log(`\nScraping ${urls.length} URLs...\n`);
  let stored = 0;
  let failed = 0;

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
        stored++;
        console.log(`$${price.amount}`);
      } else {
        failed++;
        console.log("No price found");
      }
    } catch (err) {
      failed++;
      console.log(`Error: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone: ${stored} observations stored, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
