import crypto from 'node:crypto'
import { type LanguageModel } from 'ai'
import { type ZodObject, type ZodRawShape } from 'zod'
import type { FieldMappings } from './types.js'
import { type FieldInfo } from './prompts.js'
import { SelectorCache } from './cache.js'
import { fetchAndClean } from './fetcher.js'
import { generateFieldMappings, fixFieldMappings } from './llm.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'
import { ExtractionFailed, PermanentFailure } from './exceptions.js'

const MAX_CONSECUTIVE_FAILURES = 3

export interface ScraperConfig {
  model: LanguageModel
  cachePath?: string
  debug?: boolean
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

  constructor(config: ScraperConfig) {
    this.cache = new SelectorCache(config.cachePath)
    this.model = config.model
    this.debug = config.debug ?? false
  }

  async scrape<T extends ZodRawShape>(
    options: ScrapeOptions<T>,
  ): Promise<ReturnType<ZodObject<T>['parse']>> {
    const { url, schema } = options
    const schemaHash = computeSchemaHash(schema as unknown as ZodObject<ZodRawShape>)

    // Guard: check for permanent failure
    const failureCount = this.cache.getFailureCount(url, schemaHash)
    if (failureCount > MAX_CONSECUTIVE_FAILURES) {
      throw new PermanentFailure({ url, failureCount })
    }

    // 1. Fetch and clean page
    const cleanedHtml = await fetchAndClean(url)

    // 2. Check cache for field mappings
    let fieldMappings = this.cache.get(url, schemaHash)

    // 3. Generate field mappings if no cache
    if (!fieldMappings) {
      const fieldInfos = extractFieldInfo(schema as unknown as ZodObject<ZodRawShape>)
      if (this.debug) {
        console.log('[debug] Field infos sent to LLM:', JSON.stringify(fieldInfos, null, 2))
        console.log('[debug] Cleaned HTML length:', cleanedHtml.length, 'chars')
      }
      fieldMappings = await generateFieldMappings(cleanedHtml, fieldInfos, this.model)
      if (this.debug) {
        console.log('[debug] LLM returned field mappings:', JSON.stringify(fieldMappings, null, 2))
      }
      this.cache.set(url, schemaHash, fieldMappings)
    } else if (this.debug) {
      console.log('[debug] Using cached field mappings:', JSON.stringify(fieldMappings, null, 2))
    }

    // 4. Run selectors with transforms
    const rawData = runSelectors(cleanedHtml, fieldMappings)
    if (this.debug) {
      console.log('[debug] Extracted raw data:', JSON.stringify(rawData, null, 2))
    }

    // 5. Validate
    const result = validate(schema, rawData)

    if (result.success) {
      this.cache.set(url, schemaHash, fieldMappings)
      this.cache.resetFailures(url, schemaHash)
      return result.data
    }

    if (this.debug) {
      console.log('[debug] Validation failed:', result.errors)
      console.log('[debug] Attempting heal...')
    }

    // 6. Healing attempt
    const fixedMappings = await fixFieldMappings(
      cleanedHtml,
      fieldMappings,
      result.errors,
      result.rawData,
      this.model,
    )
    if (this.debug) {
      console.log('[debug] Healed field mappings:', JSON.stringify(fixedMappings, null, 2))
    }
    const retryRawData = runSelectors(cleanedHtml, fixedMappings)
    if (this.debug) {
      console.log('[debug] Healed raw data:', JSON.stringify(retryRawData, null, 2))
    }
    const retryResult = validate(schema, retryRawData)

    if (retryResult.success) {
      this.cache.set(url, schemaHash, fixedMappings)
      this.cache.resetFailures(url, schemaHash)
      return retryResult.data
    }

    // 7. Failure
    this.cache.incrementFailures(url, schemaHash)
    throw new ExtractionFailed({
      url,
      errors: retryResult.errors,
      rawData: retryResult.rawData,
      fieldMappings: fixedMappings,
    })
  }

  close(): void {
    this.cache.close()
  }
}
