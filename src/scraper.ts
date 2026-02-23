import crypto from 'node:crypto'
import { type LanguageModel } from 'ai'
import { type ZodObject, type ZodRawShape } from 'zod'
import type { FieldMappings, ScrapeResult } from './types.js'
import { type FieldInfo } from './prompts.js'
import { SelectorCache } from './cache.js'
import { fetchAndClean } from './fetcher.js'
import { extractWithTools } from './llm.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'

const MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_MAX_TOOL_CALLS = 3

export interface ScraperConfig {
  model: LanguageModel
  cachePath?: string
  debug?: boolean
  maxToolCalls?: number
}

interface ScrapeOptions<T extends ZodRawShape> {
  url: string
  schema: ZodObject<T>
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
  private maxToolCalls: number

  constructor(config: ScraperConfig) {
    this.cache = new SelectorCache(config.cachePath)
    this.model = config.model
    this.debug = config.debug ?? false
    this.maxToolCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS
  }

  async scrape<T extends ZodRawShape>(
    options: ScrapeOptions<T>,
  ): Promise<ScrapeResult<ReturnType<ZodObject<T>['parse']>>> {
    const { url, schema } = options
    const schemaHash = computeSchemaHash(schema as unknown as ZodObject<ZodRawShape>)

    // Guard: check for permanent failure
    const failureCount = this.cache.getFailureCount(url, schemaHash)
    if (failureCount > MAX_CONSECUTIVE_FAILURES) {
      return {
        success: false,
        error: {
          code: 'PERMANENT_FAILURE',
          message: `Scraping ${url} has failed ${failureCount} consecutive times. Clear the cache to retry.`,
        },
      }
    }

    // 1. Fetch and clean page
    let cleanedHtml: string
    try {
      cleanedHtml = await fetchAndClean(url)
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }

    // 2. Check cache for field mappings
    const cachedMappings = this.cache.get(url, schemaHash)

    // 3. If cached, try running them directly first
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

    // 4. Run tool-based extraction
    const fieldInfos = extractFieldInfo(schema as unknown as ZodObject<ZodRawShape>)
    const extractionResult = await extractWithTools({
      html: cleanedHtml,
      fields: fieldInfos,
      schema: schema as unknown as ZodObject<ZodRawShape>,
      model: this.model,
      maxToolCalls: this.maxToolCalls,
      cachedMappings: cachedMappings ?? undefined,
      debug: this.debug,
    })

    if (extractionResult.success) {
      this.cache.set(url, schemaHash, extractionResult.fieldMappings)
      this.cache.resetFailures(url, schemaHash)
      return { success: true, data: extractionResult.data }
    }

    // Track failures for EXTRACTION_FAILED
    if (extractionResult.error.code === 'EXTRACTION_FAILED') {
      this.cache.incrementFailures(url, schemaHash)
    }

    return extractionResult
  }

  close(): void {
    this.cache.close()
  }
}
