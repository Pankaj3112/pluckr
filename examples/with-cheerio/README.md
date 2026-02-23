# Pluckr + Cheerio

Demonstrates using [cheerio](https://cheerio.js.org/) to pre-process HTML before passing it to Pluckr. Strips ads, nav, and other noise to reduce token usage and improve extraction accuracy.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file:

   ```
   GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
   ```

3. Run:

   ```bash
   npm start
   ```

## What it does

Fetches a recipe page, uses cheerio to strip non-content elements, then extracts 8 fields:

```json
{
  "title": "Best Chocolate Chip Cookies",
  "totalTime": "1 hr 5 mins",
  "servings": 48,
  "rating": 4.6,
  "reviewCount": 14320,
  "description": "...",
  "author": "...",
  "category": "Dessert"
}
```

## Key concept

Pluckr already cleans HTML internally, but pre-processing with cheerio lets you:

- Extract only the relevant `<article>` section
- Remove site-specific noise (ads, nav, overlays)
- Significantly reduce token count for large pages
