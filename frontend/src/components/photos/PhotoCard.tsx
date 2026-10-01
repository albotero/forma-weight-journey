import { useEffect, useState } from "react"
import { loadPhoto, type PhotoEntry } from "../../api"
import { formatDateTime } from "../../lib/format"
import { PhotoEditor } from "./PhotoEditor"

export function PhotoCard({
  photo,
  token,
  timezone,
  onRefresh,
  onDelete,
}: {
  photo: PhotoEntry
  token: string
  timezone: string
  onRefresh: () => Promise<void>
  onDelete: () => void
}) {
  const [src, setSrc] = useState("")
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    let url = ""
    void loadPhoto(token, photo.id)
      .then((value) => {
        url = value
        setSrc(value)
      })
      .catch(() => undefined)
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [token, photo.id])
  return (
    <>
      <article className="photo-card">
        {src ? (
          <img src={src} alt={photo.caption ?? "Foto privada de seguimiento"} />
        ) : (
          <div className="photo-loading">Cargando foto…</div>
        )}
        <div>
          {photo.caption && <strong>{photo.caption}</strong>}
          <time>{formatDateTime(photo.taken_at, timezone)}</time>
          <button className="small-action" onClick={() => setEditing(true)}>
            Editar
          </button>
          <button className="small-action danger" onClick={onDelete}>
            Eliminar
          </button>
        </div>
      </article>
      {editing && (
        <PhotoEditor
          photo={photo}
          token={token}
          timezone={timezone}
          onClose={() => setEditing(false)}
          onSave={async () => {
            await onRefresh()
            setEditing(false)
          }}
        />
      )}
    </>
  )
}
