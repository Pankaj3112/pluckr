import "dotenv/config";
import { google } from "@ai-sdk/google";
import { Pluckr } from "@pluckr/core";
import { z } from "zod";

const pluckr = new Pluckr({
  model: google("gemini-2.5-pro"),
});

const BookSchema = z.object({
  title: z.string(),
  price: z.number().describe("strip currency symbol and parse as decimal"),
  availability: z.boolean().describe("true if the text contains 'In stock'"),
  description: z.string().describe("the product description paragraph"),
});

async function main() {
  const url =
    "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html";
  const response = await fetch(url);
  const html = await response.text();

  console.log(`Fetched ${url} (${html.length} chars)\n`);

  const result = await pluckr.extract({
    html,
    schema: BookSchema,
  });

  if (result.success) {
    console.log("Extracted data:");
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.error(`Error [${result.error.code}]: ${result.error.message}`);
  }

  await pluckr.close();
}

main().catch(console.error);
