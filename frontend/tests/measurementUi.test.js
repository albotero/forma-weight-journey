import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

let server
let MeasurementOverview
let LabEvolutionCharts
let CatalogEntryEditor
let ModuleWorkspace
let ActivityEntryEditor
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: "custom" })
  ;({ MeasurementOverview } = await server.ssrLoadModule("/src/components/charts/MeasurementOverview.tsx"))
  ;({ LabEvolutionCharts } = await server.ssrLoadModule("/src/components/charts/LabEvolutionCharts.tsx"))
  ;({ CatalogEntryEditor } = await server.ssrLoadModule("/src/components/editors/CatalogEntryEditor.tsx"))
  ;({ ModuleWorkspace } = await server.ssrLoadModule("/src/components/modules/ModuleWorkspace.tsx"))
  ;({ ActivityEntryEditor } = await server.ssrLoadModule("/src/components/editors/ActivityEntryEditor.tsx"))
})
after(async () => { await server?.close() })

const timezone = "America/Bogota"
const now = new Date().toISOString()
const catalogItem = (id, name, is_blood_pressure = false) => ({
  id, name, category: "lab", unit: is_blood_pressure ? "mmHg" : "mg/dL", is_blood_pressure,
  sort_order: id, normal_min: 70, normal_max: 100, diastolic_normal_min: 60,
  diastolic_normal_max: 80, symptom_category: null,
})
const labs = [catalogItem(1, "Glucosa"), catalogItem(2, "Colesterol")]
const bp = catalogItem(3, "Presión arterial", true)
const result = (id, value, extra = {}) => ({
  catalog_item_id: id, name: [...labs, bp].find((item) => item.id === id).name,
  unit: id === bp.id ? "mmHg" : "mg/dL", value, systolic: null, diastolic: null,
  mean: null, text_value: null, severity: null, intensity: null, category: null, ...extra,
})
const mixed = {
  id: 1, module: "labs", title: "Resultados antiguos", occurred_at: now, notes: null,
  data: { results: [result(1, 95), result(2, 180), result(3, null, { systolic: 120, diastolic: 80, mean: 100 })] },
}
const markup = (component, props) => renderToStaticMarkup(createElement(component, props))
const occurrences = (html, text) => html.split(text).length - 1

test("measurement overview renders four cards, period controls and metric tabs with one chart", () => {
  const html = markup(MeasurementOverview, {
    title: "Medidas", timezone,
    series: [
      { id: "waist", label: "Cintura", unit: "cm", points: [{ occurredAt: now, date: "Hoy", value: 90 }] },
      { id: "neck", label: "Cuello", unit: "cm", points: [{ occurredAt: now, date: "Hoy", value: 38 }] },
    ],
  })
  assert.equal(occurrences(html, 'class="panel activity-total-card"'), 4)
  assert.equal(occurrences(html, 'class="chart-wrap"'), 1)
  assert.match(html, /Último valor/)
  assert.match(html, /90 cm/)
  assert.match(html, /Métrica de medidas/)
  assert.match(html, /Cuello/)
  assert.match(html, /aria-pressed="true">90 días<\/button>/)
  assert.match(html, /6 meses/)
})

test("multiple lab tests render only one chart and preserve the normal range", () => {
  const html = markup(LabEvolutionCharts, { catalog: labs, entries: [mixed], timezone })
  assert.equal(occurrences(html, 'class="chart-wrap"'), 1)
  assert.match(html, /<h2>Glucosa<\/h2>/)
  assert.match(html, /Colesterol/)
  assert.match(html, /Normal: 70–100 mg\/dL/)
  assert.match(html, /95 mg\/dL/)
  assert.match(html, /aria-pressed="true">1 año<\/button>/)
  assert.doesNotMatch(html, /Sistólica/)
})

test("blood pressure overview combines three metrics in every card and one chart", () => {
  const html = markup(LabEvolutionCharts, { catalog: [bp], entries: [mixed], timezone, bloodPressure: true })
  assert.equal(occurrences(html, 'class="chart-wrap"'), 1)
  assert.doesNotMatch(html, /Métrica de presión arterial/)
  assert.equal(occurrences(html, "<dt>Sistólica</dt>"), 4)
  assert.equal(occurrences(html, "<dt>Diastólica</dt>"), 4)
  assert.equal(occurrences(html, "<dt>Media registrada</dt>"), 4)
  assert.match(html, /<strong>120 mmHg<\/strong>/)
  assert.match(html, /<strong>80 mmHg<\/strong>/)
  assert.match(html, /<strong>100 mmHg<\/strong>/)
  assert.match(html, /aria-pressed="true">90 días<\/button>/)
  assert.match(html, /<p class="activity-disclaimer">Las tarjetas y la gráfica comparan todas las series/)
  assert.doesNotMatch(html, /Colesterol/)
})

const formProps = {
  category: "lab", timezone, onClose: () => {},
  onSave: async () => {}, onAddCatalogItem: async () => {},
}
test("new blood pressure form has required pressure inputs without lab fields or checkboxes", () => {
  const html = markup(CatalogEntryEditor, { ...formProps, catalog: [bp], bloodPressure: true })
  assert.match(html, /Registrar presión arterial/)
  assert.match(html, /Sistólica \(mmHg\)/)
  assert.match(html, /Diastólica \(mmHg\)/)
  assert.equal(occurrences(html, 'required="" type="number"'), 2)
  assert.doesNotMatch(html, /type="checkbox"/)
  assert.doesNotMatch(html, /Laboratorio <span/)
  assert.doesNotMatch(html, /Contexto/)
  assert.doesNotMatch(html, /Añadir elemento nuevo/)
})

test("lab form never asks for blood pressure and retains numeric or text results", () => {
  const html = markup(CatalogEntryEditor, { ...formProps, catalog: labs, entry: mixed })
  assert.match(html, /Registrar|Editar resultados de laboratorio/)
  assert.match(html, /Valor numérico o texto/)
  assert.match(html, /Glucosa/)
  assert.match(html, /Colesterol/)
  assert.doesNotMatch(html, /Sistólica/)
  assert.doesNotMatch(html, /Diastólica/)
})

test("legacy mixed blood pressure editor preloads both pressure values and explains shared metadata", () => {
  const html = markup(CatalogEntryEditor, {
    ...formProps, catalog: [bp], entry: mixed, bloodPressure: true, mixedRecord: true,
  })
  assert.match(html, /value="120"/)
  assert.match(html, /value="80"/)
  assert.match(html, /fecha y las notas son compartidas/)
  assert.doesNotMatch(html, /type="checkbox"/)
})

test("text-only lab results do not create a numeric chart or a zero measurement", () => {
  const entry = { ...mixed, data: { results: [result(1, null, { text_value: "Negativo" })] } }
  const html = markup(LabEvolutionCharts, { catalog: labs, entries: [entry], timezone })
  assert.equal(occurrences(html, 'class="chart-wrap"'), 0)
  assert.match(html, /Sin datos/)
})

const workspaceProps = {
  token: "fixture", timezone, entries: [], weights: [], measurements: [], medications: [], doses: [], photos: [],
  profile: { id: 1, height_cm: 170, initial_weight_kg: 85, timezone, reminder_time: "09:00", medications_reviewed: true },
  hasGoals: false, autoOpenEntry: false, onAutoOpenHandled: () => {}, onNavigate: () => {},
  onRefresh: async () => {}, onError: () => {}, onNewWeight: () => {}, onNewDose: () => {},
  onEditWeight: () => {}, onEditDose: () => {}, onEditMedication: () => {}, onDelete: async () => {},
}
for (const section of ["Peso", "Composición", "Medidas", "Objetivos", "Laboratorios", "Presión arterial"]) {
  test(`${section} page wires one four-card measurement overview`, () => {
    const html = markup(ModuleWorkspace, { ...workspaceProps, section })
    assert.equal(occurrences(html, 'class="measurement-overview"'), 1)
    assert.equal(occurrences(html, 'class="panel activity-total-card"'), 4)
    const defaultLabel = section === "Laboratorios" ? "1 año" :
      ["Medidas", "Objetivos"].includes(section) ? "6 meses" : "90 días"
    assert.match(html, new RegExp(`aria-pressed="true">${defaultLabel}</button>`))
  })

  test("symptoms page retains its forms and histories without charts or statistics cards", () => {
    const html = markup(ModuleWorkspace, { ...workspaceProps, section: "Síntomas" })
    assert.equal(occurrences(html, 'class="measurement-overview"'), 0)
    assert.equal(occurrences(html, 'class="panel activity-total-card"'), 0)
    assert.equal(occurrences(html, 'class="chart-wrap"'), 0)
    assert.match(html, /Check-ins semanales/)
    assert.match(html, /Síntomas registrados/)
  })

  test("weight and moving average share all four cards and one chart without metric tabs", () => {
    const html = markup(ModuleWorkspace, {
      ...workspaceProps, section: "Peso",
      weights: [{ id: 1, measured_at: now, weight_kg: 80 }],
    })
    assert.equal(occurrences(html, "<dt>Peso</dt>"), 4)
    assert.equal(occurrences(html, "<dt>Promedio móvil de 7 días</dt>"), 4)
    assert.equal(occurrences(html, 'class="chart-wrap"'), 1)
    assert.doesNotMatch(html, /Métrica de peso/)
  })

  test("blood pressure handles absent systolic readings and historical catalog replacements", () => {
    const historicalBp = { ...bp, id: 4 }
    const entry = { ...mixed, data: { results: [
      { ...result(3, null, { diastolic: 75, mean: 95 }), catalog_item_id: 4 },
    ] } }
    const html = markup(LabEvolutionCharts, {
      catalog: [bp, historicalBp], entries: [entry], timezone, bloodPressure: true,
    })
    assert.equal(occurrences(html, "<dt>Sistólica</dt>"), 4)
    assert.equal(occurrences(html, "<dt>Diastólica</dt>"), 4)
    assert.match(html, /<strong>75 mmHg<\/strong>/)
    assert.match(html, /<strong>95 mmHg<\/strong>/)
    assert.match(html, /Sin datos/)
    assert.equal(occurrences(html, 'class="chart-wrap"'), 1)
  })

  test("weekly editor opens saved totals without multiplying again", () => {
    const html = markup(ActivityEntryEditor, {
      timezone, onClose: () => {}, onSave: async () => {},
      entry: { id: 1, module: "activity", title: "Resumen semanal", occurred_at: now, notes: null,
        data: { entry_type: "weekly", week_end: now.slice(0, 10),
          weekly_steps: 7000, weekly_calories_kcal: 1400, weekly_distance_km: 7 } },
    })
    assert.match(html, /aria-pressed="true">Total semanal<\/button>/)
    assert.match(html, /value="7000"/)
    assert.match(html, /value="1400"/)
    assert.match(html, /Promedio diario/)
  })

  test("activity has rolling periods and summary-date wording with a separate compact disclaimer", () => {
    const html = markup(ModuleWorkspace, {
      ...workspaceProps, section: "Actividad",
      entries: [{ id: 1, module: "activity", title: "Resumen semanal", occurred_at: now,
        data: { entry_type: "weekly", week_end: now.slice(0, 10), weekly_calories_kcal: 1400 } }],
    })
    assert.match(html, /aria-pressed="true">90 días<\/button>/)
    assert.match(html, /class="activity-disclaimer"/)
    assert.match(html, /fecha final del período/)
    assert.match(html, /anclados al último resumen/)
    assert.doesNotMatch(html, /lunes a domingo/)
    assert.equal(occurrences(html, 'class="chart-wrap"'), 1)
  })
}

test("labs page scopes both its chart and history away from blood pressure", () => {
  const html = markup(ModuleWorkspace, { ...workspaceProps, section: "Laboratorios", entries: [mixed] })
  assert.equal(occurrences(html, 'class="chart-wrap"'), 1)
  assert.match(html, /Glucosa/)
  assert.match(html, /Colesterol/)
  assert.doesNotMatch(html, /120\/80/)
  assert.doesNotMatch(html, /Sistólica/)
})

test("blood pressure page scopes both its chart and history away from labs", () => {
  const html = markup(ModuleWorkspace, { ...workspaceProps, section: "Presión arterial", entries: [mixed] })
  assert.equal(occurrences(html, 'class="chart-wrap"'), 1)
  assert.match(html, /120\/80/)
  assert.doesNotMatch(html, /Glucosa/)
  assert.doesNotMatch(html, /Colesterol/)
})

test("weight cards and chart use the newest reading when timestamps match", () => {
  const html = markup(ModuleWorkspace, {
    ...workspaceProps, section: "Peso",
    weights: [{ id: 2, measured_at: now, weight_kg: 80 }, { id: 1, measured_at: now, weight_kg: 82 }],
  })
  assert.match(html, /<strong>80 kg<\/strong>/)
  assert.match(html, /<strong>-2 kg<\/strong>/)
  assert.match(html, /<strong>81 kg<\/strong>/)
  assert.equal(occurrences(html, 'class="chart-wrap"'), 1)
})

test("history labels independent blood pressure readings separately", () => {
  const html = markup(ModuleWorkspace, {
    ...workspaceProps, section: "Historial",
    entries: [{ ...mixed, title: "Presión arterial", data: { results: [mixed.data.results[2]] } }],
  })
  assert.match(html, /Presión arterial/)
  assert.doesNotMatch(html, /Laboratorios/)
})
