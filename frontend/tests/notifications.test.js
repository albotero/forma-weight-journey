import assert from "node:assert/strict"
import test from "node:test"

import { buildNotifications, pendingBrowserNotifications } from "../src/notifications.js"

const now = Date.parse("2026-09-28T12:00:00.000Z")

function reminder(id, data, title = `Reminder ${id}`) {
  return { id, module: "reminders", title, data }
}

test("shows only overdue enabled reminders that are not completed", () => {
  const notifications = buildNotifications({
    now,
    entries: [
      reminder(1, { enabled: "Sí", reminder_at: "2026-09-28T10:00:00Z", auto_key: "blood_pressure" }),
      reminder(2, { enabled: true, reminder_at: "2026-09-28T13:00:00Z", auto_key: "weight" }),
      reminder(3, { enabled: "No", reminder_at: "2026-09-28T10:00:00Z", auto_key: "dose" }),
      reminder(4, {
        enabled: "Sí",
        reminder_at: "2026-09-28T10:00:00Z",
        last_sent_epoch: 100,
        completed_reminder_epoch: 100,
      }),
      reminder(5, { enabled: "Sí", reminder_at: "not-a-date" }),
    ],
  })

  assert.deepEqual(notifications.slice(0, 1), [
    {
      id: "reminder-1-2026-09-28T10:00:00Z",
      title: "Reminder 1",
      body: "Programado para 2026-09-28T10:00:00Z",
      target: "Laboratorios",
      severity: "due",
    },
  ])
})

test("routes automatic reminders to their matching sections", () => {
  const keys = ["weight", "dose", "blood_pressure", "composition", "measurements", "unknown"]
  const notifications = buildNotifications({
    now,
    entries: keys.map((key, index) =>
      reminder(index + 1, { enabled: true, reminder_at: "2026-09-28T10:00:00Z", auto_key: key }),
    ),
  })

  assert.deepEqual(
    notifications.filter((item) => item.severity === "due").map((item) => item.target),
    ["Peso", "Medicación", "Laboratorios", "Composición", "Medidas", "Recordatorios"],
  )
})

test("shows daily weight alert only when no weight is recorded in the last 24 hours", () => {
  const missing = buildNotifications({ now, weights: [] })
  assert.equal(
    missing.some((item) => item.id === "checklist-weight-today"),
    true,
  )

  const recent = buildNotifications({
    now,
    weights: [{ measured_at: new Date(now - 23 * 60 * 60 * 1000).toISOString() }],
  })
  assert.equal(
    recent.some((item) => item.id === "checklist-weight-today"),
    false,
  )

  const old = buildNotifications({
    now,
    weights: [{ measured_at: new Date(now - 25 * 60 * 60 * 1000).toISOString() }],
  })
  assert.equal(
    old.some((item) => item.id === "checklist-weight-today"),
    true,
  )
})

test("shows medication review alert only for unreviewed active medications", () => {
  const notifications = buildNotifications({
    now,
    profile: { medications_reviewed: false },
    medications: [{ active: false }, { active: true }],
  })
  assert.equal(
    notifications.some((item) => item.id === "checklist-medications-review"),
    true,
  )

  const reviewed = buildNotifications({
    now,
    profile: { medications_reviewed: true },
    medications: [{ active: true }],
  })
  assert.equal(
    reviewed.some((item) => item.id === "checklist-medications-review"),
    false,
  )

  const archivedOnly = buildNotifications({
    now,
    profile: { medications_reviewed: false },
    medications: [{ active: false }],
  })
  assert.equal(
    archivedOnly.some((item) => item.id === "checklist-medications-review"),
    false,
  )
})

test("browser notification selection ignores informational items and saved IDs", () => {
  const notifications = buildNotifications({
    now,
    entries: [reminder(1, { enabled: true, reminder_at: "2026-09-28T10:00:00Z" })],
    weights: [],
  })
  const result = pendingBrowserNotifications(notifications, JSON.stringify(["reminder-1-2026-09-28T10:00:00Z"]))

  assert.deepEqual(result.pending, [])
  assert.equal(result.idsToStore.includes("checklist-weight-today"), false)
})

test("browser notification deduplication recovers from malformed stored IDs", () => {
  const notifications = buildNotifications({
    now,
    entries: [reminder(1, { enabled: true, reminder_at: "2026-09-28T10:00:00Z" })],
  })
  const result = pendingBrowserNotifications(notifications, "not-json")

  assert.deepEqual(
    result.pending.map((item) => item.id),
    ["reminder-1-2026-09-28T10:00:00Z"],
  )
  assert.deepEqual(result.idsToStore, ["reminder-1-2026-09-28T10:00:00Z"])
})
