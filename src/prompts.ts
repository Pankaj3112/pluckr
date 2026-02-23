export interface FieldInfo {
  name: string
  type: string
  description?: string
}

export const GENERATE_SELECTORS_SYSTEM = `You are an expert web scraper. Given cleaned HTML and a list of data fields to extract, return one CSS selector and one JavaScript transform expression per field.

Rules for selectors:
- Return exactly one CSS selector per field
- Prefer stable attributes: id, data-*, aria-label over class names
- Prefer semantic elements (h1, main, article) over generic divs
- Each selector should match exactly one element on the page
- Do not use overly specific selectors that break on minor HTML changes
- Do not use nth-child or positional selectors unless absolutely necessary

Rules for transforms:
- Each transform is a JavaScript expression that receives a variable \`value\` (string) and returns the correctly typed result
- If the field has an instruction, follow it for the transform
- For number fields without instruction: parseFloat(value.replace(/[^0-9.-]/g, ''))
- For boolean fields without instruction: Boolean(value.trim())
- For string fields without instruction: value.trim()`

export function generateSelectorsPrompt(
  html: string,
  fields: FieldInfo[],
): string {
  const fieldList = fields
    .map((f) => {
      const parts = [`"${f.name}" (type: ${f.type})`]
      if (f.description) {
        parts[0] = `"${f.name}" (type: ${f.type}, instruction: "${f.description}")`
      }
      return `- ${parts[0]}`
    })
    .join('\n')

  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I need to extract the following fields:
${fieldList}

For each field, provide a CSS selector that targets the element containing its value and a JavaScript transform expression that converts the raw text to the correct type. The transform receives a variable \`value\` (string).`
}

export const FIX_SELECTORS_SYSTEM = `You are an expert web scraper debugging extraction failures. Given the HTML, previously attempted CSS selectors with transforms, and the validation errors that occurred, fix the broken selectors and/or transforms.

Rules:
- Only fix fields that failed validation
- Keep working selectors and transforms unchanged
- Analyze why the previous attempt failed (wrong element? no match? wrong transform?)
- Prefer stable attributes: id, data-*, aria-label over class names
- Each selector should match exactly one element on the page
- Each transform is a JavaScript expression receiving \`value\` (string)`

export function fixSelectorsPrompt(
  html: string,
  previousMappings: Record<string, { selector: string; transform: string }>,
  errors: string,
  rawData: unknown,
): string {
  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I previously used these field mappings (selector + transform per field):
${JSON.stringify(previousMappings, null, 2)}

The extracted raw data was:
${JSON.stringify(rawData, null, 2)}

Validation failed with these errors:
${errors}

Fix the broken selectors and/or transforms and return the complete set (both working and fixed) as a JSON object mapping field names to {selector, transform} objects.`
}
