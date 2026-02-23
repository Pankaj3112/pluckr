import type { FieldMappings } from './types.js'

/** @deprecated Legacy exception class. Use ScrapeResult discriminated union instead. */
export class ExtractionFailed extends Error {
  readonly errors: string
  readonly rawData: unknown
  readonly fieldMappings: FieldMappings

  constructor({ errors, rawData, fieldMappings }: { errors: string; rawData: unknown; fieldMappings: FieldMappings }) {
    super(`Failed to extract data: ${errors}`)
    this.name = 'ExtractionFailed'
    this.errors = errors
    this.rawData = rawData
    this.fieldMappings = fieldMappings
  }
}

/** @deprecated Legacy exception class. Use ScrapeResult discriminated union instead. */
export class PermanentFailure extends Error {
  readonly failureCount: number

  constructor({ failureCount }: { failureCount: number }) {
    super(
      `Scraping has failed ${failureCount} consecutive times. ` +
      `The site structure may have changed. Clear the cache to retry.`
    )
    this.name = 'PermanentFailure'
    this.failureCount = failureCount
  }
}
