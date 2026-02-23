import "dotenv/config";
import { google } from "@ai-sdk/google";
import { Pluckr } from "@pluckr/core";
import { chromium } from "playwright";
import { z } from "zod";

const pluckr = new Pluckr({
  model: google("gemini-2.5-pro"),
});

// This page is JS-rendered — fetch() would return an empty shell
const QuoteSchema = z.object({
  text: z.string().describe("the quote text without surrounding quotation marks"),
  author: z.string().describe("the author name"),
  tags: z.string().describe("comma-separated list of tags"),
});

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const url = "https://quotes.toscrape.com/js/";
  await page.goto(url, { waitUntil: "networkidle" });
  const html = await page.content();

  await browser.close();

  console.log(`Fetched ${url} via Playwright (${html.length} chars)\n`);

  const result = await pluckr.extract({
    html,
    schema: QuoteSchema,
  });

  if (result.success) {
    console.log("Extracted quote:");
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.error(`Error [${result.error.code}]: ${result.error.message}`);
  }

  await pluckr.close();
}

main().catch(console.error);
