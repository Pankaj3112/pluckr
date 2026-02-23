import "dotenv/config";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { Scraper } from "../src/index.js";

const scraper = new Scraper({
  model: google("gemini-flash-lite-latest"),
});

const BookSchema = z.object({
  title: z.string(),
  price: z.string(),
  availability: z.string(),
  description: z.string(),
});

async function main() {
  console.log("--- First run (LLM generates selectors) ---");
  const start1 = Date.now();
  const book = await scraper.scrape({
    url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    schema: BookSchema,
  });
  console.log(`Completed in ${Date.now() - start1}ms`);
  console.log(book);

  console.log("\n--- Second run (cached, no LLM call) ---");
  const start2 = Date.now();
  const book2 = await scraper.scrape({
    url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    schema: BookSchema,
  });
  console.log(`Completed in ${Date.now() - start2}ms`);
  console.log(book2);

  scraper.close();
}

main().catch((err) => {
  console.error(err.message ?? err);
  if (err.cause) console.error("Cause:", err.cause.message ?? err.cause);
  scraper.close();
  process.exit(1);
});
