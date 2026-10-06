// Drive logo (designer artwork, raster). Served by the host from
// `/drive-logo.png`; rendered as a square image so it weighs the same as its
// neighbours in the waffle menu. Signature matches the icon slots (size +
// className + title).
interface DriveLogoProps {
  size?:      number
  className?: string
  title?:     string
}

export function DriveLogo({ size = 24, className, title = 'Drive' }: DriveLogoProps) {
  return (
    <img
      src="/drive-logo.png"
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}

export default DriveLogo
