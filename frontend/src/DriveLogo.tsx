// Logo Drive — « D » blanc (tracé) sur carré arrondi orange (#f97316).
// Couleurs de marque fixes (pas de currentColor). Signature compatible avec
// les slots d'icône (size + className).
interface DriveLogoProps {
  size?:      number
  className?: string
  title?:     string
}

export function DriveLogo({ size = 24, className, title = 'Drive' }: DriveLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1180 1180"
      role="img"
      aria-label={title}
      className={className}
      fillRule="evenodd"
      clipRule="evenodd"
      strokeLinecap="round"
    >
      <title>{title}</title>
      <path d="M1180.058,282.835l0,613.889c0,156.376 -126.957,283.333 -283.333,283.333l-613.889,0c-156.376,0 -283.333,-126.957 -283.333,-283.333l0,-613.889c0,-156.376 126.957,-283.333 283.333,-283.333l613.889,0c156.376,0 283.333,126.957 283.333,283.333Z" fill="#f97316" />
      <path d="M353.669,294.641l0,590.278" fill="none" stroke="#fff" strokeWidth="147.57" />
      <path d="M353.669,294.641c531.25,0 531.25,590.278 0,590.278" fill="none" stroke="#fff" strokeWidth="147.57" />
    </svg>
  )
}

export default DriveLogo
