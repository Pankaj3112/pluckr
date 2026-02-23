export interface FieldMapping {
  selector: string
  transform: string
  attribute?: string  // "href", "value", "src", "alt", etc. Default: text content
}

export type FieldMappings = Record<string, FieldMapping>
