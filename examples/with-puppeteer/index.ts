import "dotenv/config";
import { google } from "@ai-sdk/google";
import { Pluckr } from "@pluckr/core";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { z } from "zod";

puppeteer.use(StealthPlugin());

const pluckr = new Pluckr({
  model: google("gemini-2.5-pro"),
  debug: true,
});

const HackerNewsSchema = z.object({
  title: z.string().describe("the title of the post"),
  score: z.number().describe("extract the point count as a number"),
  author: z.string().describe("the username who submitted the post"),
  commentCount: z
    .number()
    .describe("extract the number of comments, e.g. '15 comments' → 15"),
  url: z
    .string()
    .describe("the external link URL the post points to, if any"),
});

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const url = "https://news.ycombinator.com/item?id=47120899";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const html = await page.content();

  await browser.close();

  console.log(`Fetched ${url} via Puppeteer (${html.length} chars)\n`);

  const result = await pluckr.extract({
    html,
    schema: HackerNewsSchema,
    cacheKey: url,
  });

  if (result.success) {
    console.log("Extracted Hacker News post:");
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.error(`Error [${result.error.code}]: ${result.error.message}`);
  }

  await pluckr.close();
}

main().catch(console.error);
