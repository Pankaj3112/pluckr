export interface FieldMapping {
  selector: string
  transform: string
  attribute?: string  // "href", "value", "src", "alt", etc. Default: text content
}

export type FieldMappings = Record<string, FieldMapping>

export interface CacheEntry {
  fieldMappings: FieldMappings
  consecutiveFailures: number
}

export interface Storage {
  get(key: string, schemaHash: string): Promise<CacheEntry | null>
  set(key: string, schemaHash: string, entry: CacheEntry): Promise<void>
  close(): Promise<void>
}

export interface ExtractError {
  code: 'NO_DATA' | 'EXTRACTION_FAILED' | 'PERMANENT_FAILURE'
  message: string
  partialData?: Record<string, unknown>
}

export type ExtractResult<T> =
  | { success: true; data: T }
  | { success: false; error: ExtractError }
