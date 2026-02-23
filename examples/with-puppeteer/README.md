# Pluckr + Puppeteer

Uses [Puppeteer](https://pptr.dev/) with the [stealth plugin](https://github.com/nicknisi/puppeteer-extra-plugin-stealth) to scrape a Hacker News post, extracting 5 fields including derived numbers.

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

Launches a stealth-enabled headless browser, fetches a Hacker News item page, and extracts:

```json
{
  "title": "Show HN: ...",
  "score": 142,
  "author": "username",
  "commentCount": 85,
  "url": "https://example.com/article"
}
```

## Key concept

The stealth plugin patches Puppeteer to avoid common bot-detection mechanisms. This is useful when scraping sites that block headless browsers.
