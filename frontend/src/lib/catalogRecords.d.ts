import type { CatalogCategory, CatalogItem, CatalogResult, JournalEntry } from "../api"
export function isBloodPressureResult(result: CatalogResult, catalog?: CatalogItem[]): boolean
export function scopedCatalogResults(entry: JournalEntry, bloodPressure: boolean, catalog?: CatalogItem[]): CatalogResult[]
export function labRecordLabel(entry: JournalEntry): "Laboratorios" | "Presión arterial" | "Laboratorios y presión arterial"
export function mergeScopedCatalogEntry(
  original: JournalEntry | null,
  payload: Omit<JournalEntry, "id">,
  bloodPressure: boolean,
  catalog?: CatalogItem[],
): Omit<JournalEntry, "id">
export function catalogWithHistoricalItems(catalog: CatalogItem[], entries: JournalEntry[], category: CatalogCategory): CatalogItem[]
