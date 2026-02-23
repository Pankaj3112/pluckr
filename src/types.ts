export interface FieldMapping {
  selector: string
  transform: string
}

export type FieldMappings = Record<string, FieldMapping>
