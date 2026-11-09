export function apiErrorMessage(detail, fallback = "No se pudo completar la solicitud.") {
  if (typeof detail === "string" && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (!item || typeof item.msg !== "string") return []
      const path = Array.isArray(item.loc) ? item.loc.filter((part) => part !== "body").join(".") : ""
      return [`${path ? `${path}: ` : ""}${item.msg}`]
    })
    if (messages.length) return messages.join("; ")
  }
  return fallback
}
