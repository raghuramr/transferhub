/**
 * TransferHub brand assets (src/ui/public):
 *  - logo.png       full lockup (mark + wordmark), 1200x630, transparent, no padding
 *  - logo-mark.png  the mark only, cropped tight to its artwork (no empty margin)
 *  - logo-icon.png  512 square with margin, used for the favicon only
 * Components render them edge to edge (no inner padding) so the artwork fills
 * whatever box it is placed in.
 */

/** The mark alone, sized by width (height follows the artwork's aspect). Use where space is tight. */
export function LogoMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo-mark.png?v=3"
      alt="TransferHub"
      width={size}
      height={Math.round((size * 288) / 483)}
      className={className}
      style={{ width: size, height: 'auto', objectFit: 'contain', display: 'block' }}
    />
  );
}

/** The full lockup (mark + "TransferHub" wordmark), sized by height. */
export function LogoFull({ height = 40, className = '' }: { height?: number; className?: string }) {
  return (
    <img
      src="/logo.png?v=3"
      alt="TransferHub"
      width={Math.round((height * 1200) / 630)}
      height={height}
      className={className}
      style={{ height, width: 'auto', objectFit: 'contain', display: 'block' }}
    />
  );
}

/** White rounded tile that the full logo fills edge to edge, for dark backgrounds. */
export function LogoTile({ width = 200, className = '' }: { width?: number; className?: string }) {
  return (
    <div
      className={`inline-block overflow-hidden rounded-2xl bg-white shadow-lg ${className}`}
      style={{ width, aspectRatio: '1200 / 630' }}
    >
      <img src="/logo.png?v=3" alt="TransferHub" className="block h-full w-full object-cover" />
    </div>
  );
}
