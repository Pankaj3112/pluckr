export interface FieldInfo {
  name: string
  type: string
  description?: string
}

export const EXTRACTION_SYSTEM_PROMPT = `You are an expert web scraper. You have tools to test CSS selectors against a page and submit your final extraction result.

Workflow:
1. Analyze the HTML to find elements containing the requested data fields.
2. Use the testSelector tool to verify your candidate selectors work and extract the right values.
3. Once confident, use submitResult to submit all field mappings at once.
4. If submitResult reports validation errors, analyze them, use testSelector to try corrected selectors/transforms, then submitResult again.
5. If the page genuinely does not contain the requested data, use reportNoData.

Rules for selectors:
- Prefer stable attributes: id, data-*, aria-label over class names
- Prefer semantic elements (h1, main, article) over generic divs
- Each selector should match exactly one element
- Do not use overly specific selectors that break on minor HTML changes

Rules for value extraction:
- By default, text content is extracted
- Set attribute if you need an HTML attribute (href, src, value, alt, etc.)

Rules for transforms:
- Each transform is a JavaScript expression receiving variable \`value\` (string) returning the correctly typed result
- For number fields: parseFloat(value.replace(/[^0-9.-]/g, ''))
- For boolean fields: Boolean(value.trim()) or a condition like value.includes('...')
- For string fields: value.trim()
- If a field has a description/instruction, follow it for the transform`

function formatFieldList(fields: FieldInfo[]): string {
  return fields
    .map((f) => {
      if (f.description) {
        return `- "${f.name}" (type: ${f.type}, instruction: "${f.description}")`
      }
      return `- "${f.name}" (type: ${f.type})`
    })
    .join('\n')
}

export function buildExtractionPrompt(
  html: string,
  fields: FieldInfo[],
): string {
  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I need to extract the following fields:
${formatFieldList(fields)}

Use testSelector to verify your selectors work, then submitResult with the complete field mappings. If the page does not contain this data, use reportNoData.`
}

export function buildCachedHintPrompt(
  html: string,
  fields: FieldInfo[],
  cachedMappings: Record<string, { selector: string; transform: string; attribute?: string }>,
): string {
  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I need to extract the following fields:
${formatFieldList(fields)}

These field mappings previously worked but may be stale:
${JSON.stringify(cachedMappings, null, 2)}

Test the cached selectors first with testSelector. If they still work, submit them. If not, find corrected selectors and submit those.`
}
