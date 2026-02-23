# Pluckr + Redis

Demonstrates persistent selector caching with [`@pluckr/redis`](https://www.npmjs.com/package/@pluckr/redis). On the first run, Pluckr uses the LLM to find CSS selectors. On subsequent runs, cached selectors are reused instantly — no LLM calls needed. Cached entries automatically expire after 24 hours.

## Setup

1. Start a Redis server (if you don't have one running):

   ```bash
   # With Docker
   docker run -d -p 6379:6379 redis

   # Or with Homebrew (macOS)
   brew services start redis
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file:

   ```
   GOOGLE_GENERATIVE_AI_API_KEY=your-key-here
   ```

4. Run:

   ```bash
   npm start
   ```

5. Run again to see caching in action:

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

Unlike SQLite (file-based), Redis caching is ideal for distributed deployments where multiple server instances need to share the same selector cache. The optional TTL ensures stale selectors are automatically cleaned up.
