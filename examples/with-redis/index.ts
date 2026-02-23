import "dotenv/config";
import { google } from "@ai-sdk/google";
import { Pluckr } from "@pluckr/core";
import { RedisStorage } from "@pluckr/redis";
import { z } from "zod";

const storage = new RedisStorage({
  // url: "redis://localhost:6379",  // default, or set REDIS_URL
  ttl: 60 * 60 * 24, // cache selectors for 24 hours
});

const pluckr = new Pluckr({
  model: google("gemini-2.5-pro"),
  storage,
  debug: true,
});

const WikipediaArticleSchema = z.object({
  title: z.string().describe("the article title / main heading"),
  firstParagraph: z
    .string()
    .describe("the first paragraph of the article body"),
  developer: z
    .string()
    .describe("developer or creator from the infobox sidebar"),
  firstRelease: z
    .string()
    .describe("initial release date from the infobox"),
  license: z.string().describe("software license from the infobox"),
  stableRelease: z
    .string()
    .describe("latest stable release version from the infobox"),
  website: z
    .string()
    .describe("official website URL from the infobox"),
});

async function main() {
  const url = "https://en.wikipedia.org/wiki/TypeScript";
  const response = await fetch(url);
  const html = await response.text();

  console.log(`Fetched ${url} (${html.length} chars)\n`);

  const start = Date.now();
  const result = await pluckr.extract({
    html,
    schema: WikipediaArticleSchema,
    cacheKey: url,
  });
  const elapsed = Date.now() - start;

  if (result.success) {
    console.log(`Extracted in ${elapsed}ms:`);
    console.log(JSON.stringify(result.data, null, 2));
    console.log(
      "\nRun again to see the cache hit — extraction will be instant."
    );
  } else {
    console.error(`Error [${result.error.code}]: ${result.error.message}`);
  }

  await pluckr.close();
}

main().catch(console.error);
