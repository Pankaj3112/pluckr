import "dotenv/config";
import { google } from "@ai-sdk/google";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { z } from "zod";
import { Scraper } from "../src/index.js";

puppeteer.use(StealthPlugin());

const scraper = new Scraper({
  model: google("gemini-2.5-pro"),
  debug: true,
});

// --- Schemas ---

const BookSchema = z.object({
  title: z.string(),
  price: z.number().describe("strip currency symbol and parse as decimal"),
  availability: z.boolean().describe("true if the text contains 'in stock'"),
  description: z.string().describe("the product description paragraph"),
});

const HackerNewsSchema = z.object({
  title: z.string().describe("the title of the post"),
  score: z.number().describe("extract the point count as a number"),
  author: z.string().describe("the username of the post's author"),
  commentCount: z
    .number()
    .describe("extract number of comments from text like '15 comments'"),
});

const GitHubRepoSchema = z.object({
  name: z.string().describe("repository name"),
  description: z.string(),
  stars: z
    .number()
    .describe("star count, e.g. '14.2k' should become 14200"),
  language: z.string().describe("primary programming language"),
});

const WikipediaSchema = z.object({
  title: z.string(),
  firstParagraph: z
    .string()
    .describe("the first paragraph of the article"),
  developer: z.string().describe("developer from the infobox"),
});

const IMDbSchema = z.object({
  title: z.string(),
  rating: z.number().describe("IMDb rating out of 10"),
  year: z.number().describe("release year"),
  summary: z.string().describe("plot summary text"),
});

// --- Test runner ---
interface TestCase {
  name: string;
  url: string;
  schema: z.ZodObject<any>;
}

const tests: TestCase[] = [
  {
    name: "Books to Scrape",
    url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    schema: BookSchema,
  },
  {
    name: "Hacker News",
    url: "https://news.ycombinator.com/item?id=47120899",
    schema: HackerNewsSchema,
  },
  {
    name: "GitHub Repo",
    url: "https://github.com/vitest-dev/vitest",
    schema: GitHubRepoSchema,
  },
  {
    name: "Wikipedia",
    url: "https://en.wikipedia.org/wiki/TypeScript",
    schema: WikipediaSchema,
  },
  {
    name: "IMDb",
    url: "https://www.imdb.com/title/tt0111161/",
    schema: IMDbSchema,
  },
];

async function main() {
  const target = process.argv[2];

  const toRun = target
    ? tests.filter((t) => t.name.toLowerCase().includes(target.toLowerCase()))
    : tests;

  if (toRun.length === 0) {
    console.error(`No test matching "${target}". Available: ${tests.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({ headless: true });

  for (const test of toRun) {
    console.log(`\n=== ${test.name} ===`);
    console.log(`URL: ${test.url}\n`);

    const page = await browser.newPage();
    const start = Date.now();
    await page.goto(test.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const html = await page.content();
    await page.close();
    console.log(`Fetched in ${Date.now() - start}ms (${html.length} chars)`);

    const extractStart = Date.now();
    const result = await scraper.scrape({
      html,
      schema: test.schema,
      cacheKey: test.url,
    });
    console.log(`Extracted in ${Date.now() - extractStart}ms`);

    if (result.success) {
      console.log("Data:", result.data);
    } else {
      console.error(`FAILED [${result.error.code}]:`, result.error.message);
      if (result.error.partialData) {
        console.error("Partial data:", result.error.partialData);
      }
    }
  }

  await browser.close();
  scraper.close();
}

main().catch(async (err) => {
  console.error(err);
  scraper.close();
  process.exit(1);
});
