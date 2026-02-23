import crypto from 'node:crypto'
import { type ZodObject, type ZodRawShape } from 'zod'
import { SelectorCache } from './cache.js'
import { fetchAndClean } from './fetcher.js'
import { generateSelectors, fixSelectors, type LLMConfig } from './llm.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'
import { ExtractionFailed, PermanentFailure } from './exceptions.js'

const MAX_CONSECUTIVE_FAILURES = 3

export interface ScraperConfig {
  provider: 'anthropic' | 'openai'
  apiKey: string
  model: string
  cachePath?: string
}

interface ScrapeOptions<T extends ZodRawShape> {
  url: string
  schema: ZodObject<T>
}

function computeSchemaHash(schema: ZodObject<ZodRawShape>): string {
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(schema.shape)) {
    fields[key] = value.constructor.name
  }
  const content = JSON.stringify(fields, Object.keys(fields).sort())
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

export class Scraper {
  private cache: SelectorCache
  private llmConfig: LLMConfig

  constructor(config: ScraperConfig) {
    this.cache = new SelectorCache(config.cachePath)
    this.llmConfig = {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
    }
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

    // 2. Check cache for selectors
    let selectors = this.cache.get(url, schemaHash)

    // 3. Generate selectors if no cache
    const fieldNames = Object.keys(schema.shape)
    if (!selectors) {
      selectors = await generateSelectors(cleanedHtml, fieldNames, this.llmConfig)
      // Store generated selectors so failure tracking has a row to update
      this.cache.set(url, schemaHash, selectors)
    }

    // 4. Run selectors
    const rawData = runSelectors(cleanedHtml, selectors)

    // 5. Validate
    const result = validate(schema, rawData)

    if (result.success) {
      this.cache.set(url, schemaHash, selectors)
      this.cache.resetFailures(url, schemaHash)
      return result.data
    }

    // 6. Healing attempt
    const fixedSelectors = await fixSelectors(
      cleanedHtml,
      selectors,
      result.errors,
      result.rawData,
      this.llmConfig,
    )
    const retryRawData = runSelectors(cleanedHtml, fixedSelectors)
    const retryResult = validate(schema, retryRawData)

    if (retryResult.success) {
      this.cache.set(url, schemaHash, fixedSelectors)
      this.cache.resetFailures(url, schemaHash)
      return retryResult.data
    }

    // 7. Failure
    this.cache.incrementFailures(url, schemaHash)
    throw new ExtractionFailed({
      url,
      errors: retryResult.errors,
      rawData: retryResult.rawData,
      selectors: fixedSelectors,
    })
  }

  close(): void {
    this.cache.close()
  }
}
