# Examples

Standalone examples showing how to use [`@pluckr/core`](https://www.npmjs.com/package/@pluckr/core) with different HTML-fetching methods.

Each example is a self-contained project. `cd` into any directory and run `npm install && npm start`.

| Example | Fetcher | Description |
|---------|---------|-------------|
| [`with-fetch`](./with-fetch) | Native `fetch()` | Simplest setup — extract book data from a static page |
| [`with-cheerio`](./with-cheerio) | cheerio | Pre-process HTML to strip noise before extraction |
| [`with-playwright`](./with-playwright) | Playwright | Extract from JS-rendered SPAs |
| [`with-puppeteer`](./with-puppeteer) | Puppeteer | Stealth browser with bot-detection avoidance |
| [`with-sqlite`](./with-sqlite) | fetch + SQLite cache | Persistent selector caching across runs |
| [`with-redis`](./with-redis) | fetch + Redis cache | Shared selector caching with optional TTL |

## Prerequisites

- Node.js 18+
- A Google AI API key ([get one here](https://aistudio.google.com/apikey))

## Quick start

```bash
cd examples/with-fetch
npm install
echo "GOOGLE_GENERATIVE_AI_API_KEY=your-key" > .env
npm start
```
