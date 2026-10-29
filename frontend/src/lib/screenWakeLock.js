export function keepScreenAwake(
  onChange,
  { wakeLock = globalThis.navigator?.wakeLock, visibility = globalThis.document } = {},
) {
  let disposed = false
  let pending = false
  let sentinel = null

  function released() {
    sentinel = null
    if (!disposed) onChange("released")
  }

  async function request() {
    if (disposed || pending || sentinel || visibility.visibilityState !== "visible") return
    if (!wakeLock?.request) {
      onChange("unavailable")
      return
    }
    pending = true
    onChange("requesting")
    try {
      const acquired = await wakeLock.request("screen")
      if (disposed) {
        await acquired.release()
        return
      }
      if (acquired.released) {
        onChange("released")
        return
      }
      sentinel = acquired
      sentinel.addEventListener("release", released, { once: true })
      onChange("active")
    } catch {
      if (!disposed) onChange("unavailable")
    } finally {
      pending = false
    }
  }

  visibility.addEventListener("visibilitychange", request)
  void request()
  return () => {
    disposed = true
    visibility.removeEventListener("visibilitychange", request)
    if (sentinel) {
      sentinel.removeEventListener("release", released)
      void sentinel.release().catch(() => {})
      sentinel = null
    }
  }
}