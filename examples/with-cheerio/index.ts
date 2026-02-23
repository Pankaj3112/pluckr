import "dotenv/config";
import { google } from "@ai-sdk/google";
import { Pluckr } from "@pluckr/core";
import * as cheerio from "cheerio";
import { z } from "zod";

const pluckr = new Pluckr({
  model: google("gemini-2.5-pro"),
});

// Complex schema with many fields and type coercion
const RecipeSchema = z.object({
  title: z.string().describe("recipe title / heading"),
  totalTime: z
    .string()
    .describe("total cook time as displayed, e.g. '1 hr 30 mins'"),
  servings: z
    .number()
    .describe("number of servings as an integer"),
  rating: z
    .number()
    .describe("average star rating out of 5"),
  reviewCount: z
    .number()
    .describe("total number of reviews"),
  description: z
    .string()
    .describe("short recipe description or summary paragraph"),
  author: z.string().describe("recipe author name"),
  category: z.string().describe("recipe category, e.g. 'Dessert', 'Main Dish'"),
});

async function main() {
  // Fetch HTML
  const url = "https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/";
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PluckrExample/1.0)" },
  });
  const html = await response.text();

  // Pre-process with cheerio — extract just the recipe article
  const $ = cheerio.load(html);
  $("header, footer, nav, .ad-container, [data-ad]").remove();
  const articleHtml = $.html("article") || $.html();

  console.log(
    `Fetched ${url}\nOriginal: ${html.length} chars → Trimmed: ${articleHtml.length} chars\n`
  );

  const result = await pluckr.extract({
    html: articleHtml,
    schema: RecipeSchema,
  });

  if (result.success) {
    console.log("Extracted recipe:");
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.error(`Error [${result.error.code}]: ${result.error.message}`);
  }

  await pluckr.close();
}

main().catch(console.error);
