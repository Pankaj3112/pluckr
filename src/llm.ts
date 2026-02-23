import { generateText, tool, stepCountIs, type LanguageModel } from 'ai'
import { z, type ZodObject, type ZodRawShape } from 'zod'
import type { FieldMappings, ScrapeError } from './types.js'
import { testSingleSelector } from './selector.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'
import {
  type FieldInfo,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildCachedHintPrompt,
} from './prompts.js'

export type ExtractionResult<T> =
  | { success: true; data: T; fieldMappings: FieldMappings }
  | { success: false; error: ScrapeError }

interface ExtractWithToolsOptions<T extends ZodRawShape> {
  html: string
  fields: FieldInfo[]
  schema: ZodObject<T>
  model: LanguageModel
  maxToolCalls: number
  cachedMappings?: FieldMappings
  debug?: boolean
}

export async function extractWithTools<T extends ZodRawShape>(
  options: ExtractWithToolsOptions<T>,
): Promise<ExtractionResult<ReturnType<ZodObject<T>['parse']>>> {
  const { html, fields, schema, model, maxToolCalls, cachedMappings, debug } = options

  // Track results from tool calls
  let finalResult: ExtractionResult<ReturnType<ZodObject<T>['parse']>> | null = null

  const prompt = cachedMappings
    ? buildCachedHintPrompt(html, fields, cachedMappings)
    : buildExtractionPrompt(html, fields)

  const response = await generateText({
    model,
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt,
    stopWhen: stepCountIs(maxToolCalls),
    tools: {
      testSelector: tool({
        description: 'Test a CSS selector against the page HTML. Returns the extracted raw value and optionally the transformed value. Use this to verify selectors before submitting.',
        inputSchema: z.object({
          selector: z.string().describe('CSS selector to test'),
          attribute: z.string().optional().describe('HTML attribute to extract (e.g. "href", "src"). Omit for text content.'),
          transform: z.string().optional().describe('JavaScript expression receiving `value` (string) to transform the raw value'),
        }),
        execute: async (params) => {
          const result = testSingleSelector(html, params)
          if (debug) {
            console.log('[debug] testSelector:', params.selector, '->', JSON.stringify(result))
          }
          return result
        },
      }),

      submitResult: tool({
        description: 'Submit the final field mappings for all fields. The system will run them against the HTML, validate against the schema, and return success or validation errors. Call this when you are confident in your selectors.',
        inputSchema: z.object({
          mappings: z.record(z.string(), z.object({
            selector: z.string(),
            transform: z.string(),
            attribute: z.string().optional(),
          })).describe('Map of field name to { selector, transform, attribute? }'),
        }),
        execute: async ({ mappings }) => {
          const rawData = runSelectors(html, mappings)
          const validationResult = validate(schema, rawData)

          if (debug) {
            console.log('[debug] submitResult rawData:', JSON.stringify(rawData))
            console.log('[debug] submitResult valid:', validationResult.success)
          }

          if (validationResult.success) {
            finalResult = {
              success: true,
              data: validationResult.data,
              fieldMappings: mappings,
            }
            return { valid: true, data: validationResult.data }
          }

          return {
            valid: false,
            errors: validationResult.errors,
            extractedData: rawData,
          }
        },
      }),

      reportNoData: tool({
        description: 'Report that the page does not contain the requested data. Use this only when you are certain the data is not present on the page.',
        inputSchema: z.object({
          reason: z.string().describe('Explanation of why the data is not present'),
        }),
        execute: async ({ reason }) => {
          finalResult = {
            success: false,
            error: {
              code: 'NO_DATA',
              message: reason,
            },
          }
          return { reported: true }
        },
      }),
    },
  })

  // If the AI submitted a valid result or reported no data via execute, return it
  if (finalResult) {
    return finalResult
  }

  // Also check the response steps for tool results (handles cases where
  // execute callbacks weren't invoked, e.g. in test mocks)
  for (const step of response.steps ?? []) {
    for (let i = 0; i < (step.toolCalls?.length ?? 0); i++) {
      const toolCall = step.toolCalls[i] as any
      const toolResult = step.toolResults?.[i] as any

      if (toolCall?.toolName === 'submitResult' && toolResult?.result?.valid) {
        return {
          success: true,
          data: toolResult.result.data,
          fieldMappings: toolCall.args.mappings,
        }
      }

      if (toolCall?.toolName === 'reportNoData') {
        return {
          success: false,
          error: {
            code: 'NO_DATA',
            message: toolCall.args.reason,
          },
        }
      }
    }
  }

  // Tool loop exhausted without a valid submission
  return {
    success: false,
    error: {
      code: 'EXTRACTION_FAILED',
      message: 'Tool loop exhausted without successful extraction',
    },
  }
}
