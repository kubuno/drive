import { Lock } from 'lucide-react'
import { useDriveExtras } from '../driveExtras'

/** Small amber padlock shown on cards when a file is locked. */
export default function LockBadge({ fileId }: { fileId: string }) {
  const locked = useDriveExtras(s => !!s.locks[fileId])
  if (!locked) return null
  return <Lock size={12} className="shrink-0 text-amber-500" />
}
