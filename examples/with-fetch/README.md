# Pluckr + Fetch

The simplest possible Pluckr example. Uses native `fetch()` to get HTML from a static page and extracts structured data.

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

Fetches a book page from [books.toscrape.com](https://books.toscrape.com) and extracts:

```json
{
  "title": "A Light in the Attic",
  "price": 51.77,
  "availability": true,
  "description": "It's hard to imagine a world without..."
}
```
