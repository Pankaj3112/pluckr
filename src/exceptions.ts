interface ExtractionFailedOptions {
  url: string
  errors: string
  rawData: unknown
  selectors: Record<string, string>
}

export class ExtractionFailed extends Error {
  readonly url: string
  readonly errors: string
  readonly rawData: unknown
  readonly selectors: Record<string, string>

  constructor({ url, errors, rawData, selectors }: ExtractionFailedOptions) {
    super(`Failed to extract data from ${url}: ${errors}`)
    this.name = 'ExtractionFailed'
    this.url = url
    this.errors = errors
    this.rawData = rawData
    this.selectors = selectors
  }
}

interface PermanentFailureOptions {
  url: string
  failureCount: number
}

export class PermanentFailure extends Error {
  readonly url: string
  readonly failureCount: number

  constructor({ url, failureCount }: PermanentFailureOptions) {
    super(
      `Scraping ${url} has failed ${failureCount} consecutive times. ` +
      `The site structure may have changed. Clear the cache to retry.`
    )
    this.name = 'PermanentFailure'
    this.url = url
    this.failureCount = failureCount
  }
}
