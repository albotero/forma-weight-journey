export function isBloodPressureResult(result, catalog = []) {
  return result.systolic != null || result.diastolic != null ||
    catalog.some((item) => item.id === result.catalog_item_id && item.is_blood_pressure)
}

export function scopedCatalogResults(entry, bloodPressure, catalog = []) {
  if (!Array.isArray(entry.data.results)) return []
  return entry.data.results.filter((result) => isBloodPressureResult(result, catalog) === bloodPressure)
}

export function labRecordLabel(entry) {
  if (!scopedCatalogResults(entry, true).length) return "Laboratorios"
  return scopedCatalogResults(entry, false).length ? "Laboratorios y presión arterial" : "Presión arterial"
}

export function mergeScopedCatalogEntry(original, payload, bloodPressure, catalog = []) {
  if (!original) return payload
  const remaining = scopedCatalogResults(original, !bloodPressure, catalog)
  return {
    ...payload,
    title: bloodPressure && remaining.length ? original.title : payload.title,
    data: {
      ...original.data,
      ...payload.data,
      results: [...remaining, ...payload.data.results],
    },
  }
}

export function catalogWithHistoricalItems(catalog, entries, category) {
  const items = new Map(catalog.map((item) => [item.id, item]))
  for (const entry of entries) {
    if (!Array.isArray(entry.data.results)) continue
    for (const result of entry.data.results) {
      if (items.has(result.catalog_item_id)) continue
      items.set(result.catalog_item_id, {
        id: result.catalog_item_id,
        category,
        name: result.name,
        unit: result.unit,
        symptom_category: result.category,
        is_blood_pressure: isBloodPressureResult(result),
        sort_order: items.size,
        normal_min: null,
        normal_max: null,
        diastolic_normal_min: null,
        diastolic_normal_max: null,
      })
    }
  }
  return [...items.values()]
}
