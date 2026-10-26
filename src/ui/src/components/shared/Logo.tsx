/**
 * The TransferHub mark (src/ui/public/logo-icon.png), used everywhere the old
 * GraduationCap-in-a-rounded-square placeholder used to be: the app sidebar,
 * the mobile top bar, the public home page header, and the auth pages'
 * badge. One file so the brand mark only needs updating in one place.
 */
export function LogoMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo-icon.png?v=2"
      alt="TransferHub"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}

/** The full horizontal lockup (icon + "TransferHub" wordmark), for wide headers. */
export function LogoFull({ height = 40, className = '' }: { height?: number; className?: string }) {
  return (
    <img
      src="/logo.png?v=2"
      alt="TransferHub"
      height={height}
      className={className}
      style={{ height, width: 'auto', objectFit: 'contain' }}
    />
  );
}
