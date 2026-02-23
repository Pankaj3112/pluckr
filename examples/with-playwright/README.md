# Pluckr + Playwright

Extracts data from a JavaScript-rendered page using [Playwright](https://playwright.dev/). This page returns an empty shell to `fetch()` — the content is rendered client-side with JS.

## Setup

1. Install dependencies:

   ```bash
   npm install
   npx playwright install chromium
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

Launches a headless Chromium browser, navigates to a JS-rendered quotes page, waits for content to render, then extracts:

```json
{
  "text": "The world as we have created it is a process of our thinking...",
  "author": "Albert Einstein",
  "tags": "change, deep-thoughts, thinking, world"
}
```

## When to use Playwright

Use Playwright (or Puppeteer) when the target page:

- Renders content with JavaScript (SPAs, React, Vue, etc.)
- Requires interaction (clicking, scrolling) before data appears
- Needs `networkidle` or specific element selectors to wait for
