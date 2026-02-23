import crypto from 'node:crypto'
import { type LanguageModel } from 'ai'
import { type ZodObject, type ZodRawShape } from 'zod'
import type { FieldMappings, ScrapeResult } from './types.js'
import { type FieldInfo } from './prompts.js'
import { SelectorCache } from './cache.js'
import { cleanHtml } from './cleaner.js'
import { extractWithTools } from './llm.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'

const MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_MAX_TOOL_CALLS_PER_FIELD = 3

export interface ScraperConfig {
  model: LanguageModel
  cachePath?: string
  debug?: boolean
  maxToolCallsPerField?: number
}

export interface ScrapeOptions<T extends ZodRawShape> {
  html: string
  schema: ZodObject<T>
  cacheKey?: string
}

function extractFieldInfo(schema: ZodObject<ZodRawShape>): FieldInfo[] {
  return Object.entries(schema.shape).map(([name, field]) => {
    let current = field as any
    while (current._def?.innerType) {
      current = current._def.innerType
    }
    return {
      name,
      type: current.constructor.name,
      description: (field as any).description,
    }
  })
}

function computeSchemaHash(schema: ZodObject<ZodRawShape>): string {
  const fields: Record<string, { type: string; description?: string }> = {}
  for (const [key, value] of Object.entries(schema.shape)) {
    let current = value as any
    while (current._def?.innerType) {
      current = current._def.innerType
    }
    fields[key] = {
      type: current.constructor.name,
      description: (value as any).description,
    }
  }
  const sorted: Record<string, { type: string; description?: string }> = {}
  for (const key of Object.keys(fields).sort()) {
    sorted[key] = fields[key]
  }
  const content = JSON.stringify(sorted)
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

export class Scraper {
  private cache: SelectorCache
  private model: LanguageModel
  private debug: boolean
  private maxToolCallsPerField: number

  constructor(config: ScraperConfig) {
    this.cache = new SelectorCache(config.cachePath)
    this.model = config.model
    this.debug = config.debug ?? false
    this.maxToolCallsPerField = config.maxToolCallsPerField ?? DEFAULT_MAX_TOOL_CALLS_PER_FIELD
  }

  async scrape<T extends ZodRawShape>(
    options: ScrapeOptions<T>,
  ): Promise<ScrapeResult<ReturnType<ZodObject<T>['parse']>>> {
    const { html, schema, cacheKey } = options
    const schemaHash = computeSchemaHash(schema as unknown as ZodObject<ZodRawShape>)
    const cleanedHtml = cleanHtml(html)

    // Guard: check for permanent failure (only when caching is enabled)
    if (cacheKey) {
      const failureCount = this.cache.getFailureCount(cacheKey, schemaHash)
      if (failureCount > MAX_CONSECUTIVE_FAILURES) {
        return {
          success: false,
          error: {
            code: 'PERMANENT_FAILURE',
            message: `Scraping has failed ${failureCount} consecutive times for cache key "${cacheKey}". Clear the cache to retry.`,
          },
        }
      }
    }

    // Check cache for field mappings (only when caching is enabled)
    const cachedMappings = cacheKey ? this.cache.get(cacheKey, schemaHash) : null

    // If cached, try running them directly first
    if (cachedMappings) {
      const rawData = runSelectors(cleanedHtml, cachedMappings)
      const result = validate(schema, rawData)

      if (result.success) {
        if (this.debug) {
          console.log('[debug] Cache hit — validated successfully')
        }
        return { success: true, data: result.data }
      }

      if (this.debug) {
        console.log('[debug] Cache hit but validation failed, running tool loop with hint')
      }
    }

    // Run tool-based extraction
    const fieldInfos = extractFieldInfo(schema as unknown as ZodObject<ZodRawShape>)
    const extractionResult = await extractWithTools({
      html: cleanedHtml,
      fields: fieldInfos,
      schema: schema as unknown as ZodObject<ZodRawShape>,
      model: this.model,
      maxToolCalls: this.maxToolCallsPerField * fieldInfos.length,
      cachedMappings: cachedMappings ?? undefined,
      debug: this.debug,
    })

    if (extractionResult.success) {
      if (cacheKey) {
        this.cache.set(cacheKey, schemaHash, extractionResult.fieldMappings)
        this.cache.resetFailures(cacheKey, schemaHash)
      }
      return { success: true, data: extractionResult.data as ReturnType<ZodObject<T>['parse']> }
    }

    // Track failures for EXTRACTION_FAILED (only when caching is enabled)
    if (cacheKey && extractionResult.error.code === 'EXTRACTION_FAILED') {
      this.cache.incrementFailures(cacheKey, schemaHash)
    }

    return extractionResult
  }

  close(): void {
    this.cache.close()
  }
}
