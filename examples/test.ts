import "dotenv/config";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { Scraper, ExtractionFailed } from "../src/index.js";

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

  for (const test of toRun) {
    console.log(`\n=== ${test.name} ===`);
    console.log(`URL: ${test.url}\n`);

    try {
      const start = Date.now();
      const result = await scraper.scrape({
        url: test.url,
        schema: test.schema,
      });
      console.log(`Completed in ${Date.now() - start}ms`);
      console.log(result);
    } catch (err) {
      if (err instanceof ExtractionFailed) {
        console.error("FAILED:", err.message);
        console.error("Field mappings:", JSON.stringify(err.fieldMappings, null, 2));
        console.error("Raw data:", err.rawData);
      } else {
        console.error("ERROR:", (err as Error).message ?? err);
      }
    }
  }

  scraper.close();
}

main().catch((err) => {
  console.error(err);
  scraper.close();
  process.exit(1);
});
