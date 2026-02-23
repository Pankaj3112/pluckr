export const GENERATE_SELECTORS_SYSTEM = `You are an expert web scraper. Given cleaned HTML and a list of data fields to extract, return one CSS selector per field that will match the element containing that field's value.

Rules:
- Return exactly one CSS selector per field
- Prefer stable attributes: id, data-*, aria-label over class names
- Prefer semantic elements (h1, main, article) over generic divs
- Each selector should match exactly one element on the page
- Do not use overly specific selectors that break on minor HTML changes
- Do not use nth-child or positional selectors unless absolutely necessary`

export function generateSelectorsPrompt(
  html: string,
  fields: { name: string; type: string }[],
): string {
  const fieldList = fields
    .map((f) => `- "${f.name}" (expected type: ${f.type})`)
    .join('\n')

  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I need to extract the following fields:
${fieldList}

For each field, provide a CSS selector that targets the element containing its value. Return a JSON object mapping field names to CSS selectors.`
}

export const FIX_SELECTORS_SYSTEM = `You are an expert web scraper debugging extraction failures. Given the HTML, previously attempted CSS selectors, and the validation errors that occurred, fix the broken selectors.

Rules:
- Only fix selectors for fields that failed validation
- Keep working selectors unchanged
- Analyze why the previous selector failed (wrong element? no match? wrong attribute?)
- Prefer stable attributes: id, data-*, aria-label over class names
- Each selector should match exactly one element on the page`

export function fixSelectorsPrompt(
  html: string,
  previousSelectors: Record<string, string>,
  errors: string,
  rawData: unknown,
): string {
  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I previously used these CSS selectors:
${JSON.stringify(previousSelectors, null, 2)}

The extracted raw data was:
${JSON.stringify(rawData, null, 2)}

Validation failed with these errors:
${errors}

Fix the broken selectors and return the complete set (both working and fixed selectors) as a JSON object mapping field names to CSS selectors.`
}
