/**
 * The parts of `DetailsPanel.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { formatSize } from "@kubuno/drive"
import { Button } from "@ui"
import { Eye, Download, Calendar, Camera, MapPin, Image, Save, History } from "lucide-react"
import { hasReclaimableHistory, versionBytes, versionCount } from "./fileVersions"
import type { DetailsPanel } from './DetailsPanel'

function InfoRow({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {icon && <span className="text-text-tertiary mt-0.5 shrink-0">{icon}</span>}
      <span className="text-text-tertiary shrink-0">{label}</span>
      <span className="text-text-primary ml-auto text-right break-words">{value}</span>
    </div>
  )
}
export { InfoRow }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      {children}
    </div>
  )
}
export { Section }

export function Part1({ thumb, file }: { thumb: NonNullable<DetailsPanel['thumb']>; file: NonNullable<DetailsPanel['props']['file']> }) {
  return (
    <img src={thumb} alt={file.name} className="max-h-40 object-contain mx-auto rounded-lg" />
  )
}

export function Part2({ file, openHistory, t }: { file: NonNullable<DetailsPanel['props']['file']>; openHistory: DetailsPanel['openHistory']; t: NonNullable<DetailsPanel['tr']> }) {
  return (
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
              {/* Kept revisions are billed to the quota, so the panel states what
                * they weigh and opens the history that lets the user reclaim it.
                * Most files have none and gain no extra row at all. */}
              {hasReclaimableHistory(file) && (
                <button
                  type="button"
                  onClick={() => void openHistory()}
                  title={t('version.open_history')}
                  className="flex items-center gap-2 w-full -mx-1.5 px-1.5 py-1 rounded-lg text-sm text-left
                             hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <History size={14} className="text-text-tertiary shrink-0" />
                  <span className="text-text-tertiary">{t('version.title')}</span>
                  <span className="text-text-primary ml-auto text-right">
                    {t('version.stats', {
                      count: versionCount(file),
                      size:  formatSize(versionBytes(file)),
                    })}
                  </span>
                </button>
              )}
            </Section>
  )
}

export function Part3({ access, access_last_viewed_at, accessLoaded }: { access: NonNullable<DetailsPanel['access']>; access_last_viewed_at: string; accessLoaded: NonNullable<DetailsPanel['accessLoaded']> }) {
  return (
    <Section title="Statistiques d'accès">
              {access ? (
                <div className="space-y-2">
                  <InfoRow icon={<Eye size={14} />} label="Consultations" value={access.view_count} />
                  <InfoRow icon={<Download size={14} />} label="Téléchargements" value={access.download_count} />
                  {access.last_viewed_at && (
                    <InfoRow
                      label="Dernière consultation"
                      value={new Date(access_last_viewed_at).toLocaleString('fr-FR')}
                    />
                  )}
                </div>
              ) : (
                accessLoaded && <p className="text-sm text-text-tertiary">Aucune consultation</p>
              )}
            </Section>
  )
}

export function Part4({ hasDims, meta, exifRows, gps }: { hasDims: NonNullable<DetailsPanel['hasDims']>; meta: DetailsPanel['meta']; exifRows: NonNullable<DetailsPanel['exifRows']>; gps: NonNullable<DetailsPanel['gps']> }) {
  return (
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
  )
}

export function Part5({ desc, setDesc, saveDescription, saving, saved }: { desc: NonNullable<DetailsPanel['desc']>; setDesc: NonNullable<DetailsPanel['setDesc']>; saveDescription: DetailsPanel['saveDescription']; saving: NonNullable<DetailsPanel['saving']>; saved: NonNullable<DetailsPanel['saved']> }) {
  return (
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
  )
}
