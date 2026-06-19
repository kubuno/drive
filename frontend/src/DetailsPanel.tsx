// Right-hand side panel showing a file's details: thumbnail preview, tags,
// general info, access statistics, image EXIF metadata, and an editable
// user description. All data is fetched best-effort; failures stay silent.
import { useState, useEffect } from 'react'
import { api, useAuthStore } from '@kubuno/sdk'
import { formatSize } from '@kubuno/drive'
import { Button } from '@ui'
import { X, Eye, Download, Calendar, Camera, MapPin, Image, Tag, Save } from 'lucide-react'
import { TagDots } from './TagUI'

interface DetailFile {
  id:            string
  name:          string
  mime_type:     string
  size_bytes:    number
  created_at:    string
  updated_at:    string
  has_thumbnail: boolean
  metadata?:     Record<string, unknown>
}

interface Props {
  file:       DetailFile | null
  onClose:    () => void
  onEditTags: (file: DetailFile) => void
}

interface AccessStats {
  view_count:          number
  download_count:      number
  last_viewed_at:      string | null
  last_downloaded_at:  string | null
}

interface GpsPoint {
  lat: number
  lon: number
}

interface MetaExtra {
  exif:   Record<string, string | GpsPoint>
  width:  number | null
  height: number | null
}

/** EXIF keys we surface, in display order, with their French labels. */
const EXIF_LABELS: Array<[string, string]> = [
  ['camera_make',   'Appareil'],
  ['camera_model',  'Modèle'],
  ['taken_at',      'Pris le'],
  ['exposure_time', 'Exposition'],
  ['f_number',      'Ouverture'],
  ['iso',           'ISO'],
  ['focal_length',  'Focale'],
]

function isGps(v: string | GpsPoint | undefined): v is GpsPoint {
  return !!v && typeof v === 'object' && 'lat' in v && 'lon' in v
}

function InfoRow({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {icon && <span className="text-text-tertiary mt-0.5 shrink-0">{icon}</span>}
      <span className="text-text-tertiary shrink-0">{label}</span>
      <span className="text-text-primary ml-auto text-right break-words">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      {children}
    </div>
  )
}

export default function DetailsPanel({ file, onClose, onEditTags }: Props) {
  const [thumb, setThumb]   = useState<string>('')
  const [access, setAccess] = useState<AccessStats | null>(null)
  const [accessLoaded, setAccessLoaded] = useState(false)
  const [meta, setMeta]     = useState<MetaExtra | null>(null)
  const [desc, setDesc]     = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  const isImage = !!file && file.mime_type.startsWith('image/')

  // Authenticated thumbnail fetch → object URL.
  useEffect(() => {
    setThumb('')
    if (!file?.has_thumbnail) return
    let url = ''
    const token = useAuthStore.getState().accessToken
    fetch(`/api/v1/drive/${file.id}/thumbnail`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => {
        url = URL.createObjectURL(b)
        setThumb(url)
      })
      .catch(() => {})
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [file?.id])

  // Reset the editable description whenever the selected file changes.
  useEffect(() => {
    setDesc((file?.metadata?.description as string) ?? '')
    setSaved(false)
  }, [file?.id])

  // Access statistics (best-effort), guarded against races.
  useEffect(() => {
    if (!file) return
    let alive = true
    setAccess(null)
    setAccessLoaded(false)
    api
      .get<{ access: AccessStats | null }>(`/drive/${file.id}/access`)
      .then((res) => {
        if (!alive) return
        setAccess(res.data.access)
        setAccessLoaded(true)
      })
      .catch(() => {
        if (alive) setAccessLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [file?.id])

  // Image EXIF / dimensions (best-effort), only for images.
  useEffect(() => {
    if (!file || !isImage) {
      setMeta(null)
      return
    }
    let alive = true
    setMeta(null)
    api
      .get<MetaExtra>(`/drive/${file.id}/metadata-extra`)
      .then((res) => {
        if (alive) setMeta(res.data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [file?.id, isImage])

  if (!file) return null

  const saveDescription = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await api.patch(`/drive/${file.id}/user-metadata`, { description: desc })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      // Best-effort: keep the edited text on screen on failure.
    } finally {
      setSaving(false)
    }
  }

  const gps = isGps(meta?.exif.gps) ? meta?.exif.gps : undefined
  const hasDims = !!meta && meta.width != null && meta.height != null
  const exifRows = EXIF_LABELS.filter(([key]) => typeof meta?.exif[key] === 'string')

  return (
    <aside className="fixed top-0 right-0 h-full w-80 bg-white border-l border-border shadow-xl z-40 flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-border bg-white">
        <h2 className="text-base font-semibold text-text-primary">Détails</h2>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-surface-2 text-text-secondary transition-colors"
          title="Fermer"
        >
          <X size={18} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* 1. Preview */}
        <div className="flex items-center justify-center rounded-lg bg-surface-1 p-3 min-h-[8rem]">
          {file.has_thumbnail && thumb ? (
            <img src={thumb} alt={file.name} className="max-h-40 object-contain mx-auto rounded-lg" />
          ) : (
            <Image size={56} className="text-text-tertiary" />
          )}
        </div>

        {/* 2. Name + MIME type */}
        <div>
          <p className="font-bold text-text-primary break-words">{file.name}</p>
          <p className="text-xs text-text-tertiary mt-0.5">{file.mime_type}</p>
        </div>

        {/* 3. Tags */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-tertiary">Étiquettes</span>
          <TagDots itemId={file.id} />
          <button
            onClick={() => onEditTags(file)}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
            title="Gérer les étiquettes"
          >
            <Tag size={13} /> Gérer
          </button>
        </div>

        {/* 4. General info */}
        <Section title="Informations">
          <InfoRow label="Taille" value={formatSize(file.size_bytes)} />
          <InfoRow
            icon={<Calendar size={14} />}
            label="Créé le"
            value={new Date(file.created_at).toLocaleString('fr-FR')}
          />
          <InfoRow
            icon={<Calendar size={14} />}
            label="Modifié le"
            value={new Date(file.updated_at).toLocaleString('fr-FR')}
          />
        </Section>

        {/* 5. Access statistics */}
        <Section title="Statistiques d'accès">
          {access ? (
            <div className="space-y-2">
              <InfoRow icon={<Eye size={14} />} label="Consultations" value={access.view_count} />
              <InfoRow icon={<Download size={14} />} label="Téléchargements" value={access.download_count} />
              {access.last_viewed_at && (
                <InfoRow
                  label="Dernière consultation"
                  value={new Date(access.last_viewed_at).toLocaleString('fr-FR')}
                />
              )}
            </div>
          ) : (
            accessLoaded && <p className="text-sm text-text-tertiary">Aucune consultation</p>
          )}
        </Section>

        {/* 6. Image metadata */}
        {isImage && (hasDims || exifRows.length > 0 || gps) && (
          <Section title="Image">
            <div className="space-y-2">
              {hasDims && (
                <InfoRow icon={<Image size={14} />} label="Dimensions" value={`${meta!.width} × ${meta!.height} px`} />
              )}
              {exifRows.map(([key, label]) => (
                <InfoRow
                  key={key}
                  icon={key === 'camera_make' ? <Camera size={14} /> : undefined}
                  label={label}
                  value={meta!.exif[key] as string}
                />
              ))}
              {gps && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=15/${gps.lat}/${gps.lon}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <MapPin size={14} /> Voir sur la carte
                </a>
              )}
            </div>
          </Section>
        )}

        {/* 7. Editable description */}
        <Section title="Description">
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Ajouter une description…"
            rows={4}
            className="w-full rounded-lg border border-border bg-surface-1 p-2 text-sm text-text-primary outline-none focus:border-primary resize-y"
          />
          <div className="flex items-center gap-2">
            <Button onClick={() => void saveDescription()} loading={saving} icon={<Save size={15} />}>
              Enregistrer
            </Button>
            {saved && <span className="text-xs text-primary">✓ Enregistré</span>}
          </div>
        </Section>
      </div>
    </aside>
  )
}
