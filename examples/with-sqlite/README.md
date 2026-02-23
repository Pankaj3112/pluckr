# Pluckr + SQLite

Demonstrates persistent selector caching with [`@pluckr/sqlite`](https://www.npmjs.com/package/@pluckr/sqlite). On the first run, Pluckr uses the LLM to find CSS selectors. On subsequent runs, cached selectors are reused instantly — no LLM calls needed.

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

4. Run again to see caching in action:

   ```bash
   npm start
   ```

## What it does

Extracts 7 fields from a Wikipedia article, including infobox data:

```json
{
  "title": "TypeScript",
  "firstParagraph": "TypeScript is a free and open-source...",
  "developer": "Microsoft",
  "firstRelease": "1 October 2012",
  "license": "Apache License 2.0",
  "stableRelease": "5.7.3",
  "website": "https://www.typescriptlang.org"
}
```

## Key concept

The first run calls the LLM (~5-15 seconds). The second run uses cached selectors (~50ms). If the page structure changes, Pluckr automatically re-extracts and updates the cache.

Cache is stored in `.pluckr/cache.db` (SQLite). Delete this file to clear the cache.
