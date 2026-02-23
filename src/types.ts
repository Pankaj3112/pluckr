export interface FieldMapping {
  selector: string
  transform: string
  attribute?: string  // "href", "value", "src", "alt", etc. Default: text content
}

export type FieldMappings = Record<string, FieldMapping>

export interface ScrapeError {
  code: 'NO_DATA' | 'EXTRACTION_FAILED' | 'FETCH_FAILED' | 'PERMANENT_FAILURE'
  message: string
  partialData?: Record<string, unknown>
}

export type ScrapeResult<T> =
  | { success: true; data: T }
  | { success: false; error: ScrapeError }
