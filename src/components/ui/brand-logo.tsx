import { cn } from "@/lib/utils";

const LOCKUP_DARK = "/ksenda-dark.png";       // K + violet check + white wordmark, transparent bg
const LOCKUP_LIGHT = "/ksenda.png";           // K + violet check + black wordmark, transparent bg
const MARK_DARK = "/ksenda-mark-dark.png";    // just the K + violet check, white K, transparent bg
const MARK_LIGHT = "/ksenda-mark.png";        // just the K + violet check, black K, transparent bg

// Intrinsic aspect ratio of the trimmed lockup PNG (W / H ≈ 1170 / 269).
const LOCKUP_RATIO = 4.35;
// Intrinsic aspect ratio of the trimmed mark PNG (W / H ≈ 344 / 269).
const MARK_RATIO = 1.28;

interface BrandLogoProps {
  /** Pixel height of the rendered lockup. Width is derived from the lockup ratio. */
  height: number;
  /** Render the dark-canvas variant (white wordmark / white K). Default true. */
  dark?: boolean;
  /** Show only the K-with-check mark, no wordmark. Default false. */
  markOnly?: boolean;
  className?: string;
  priority?: boolean;
}

/*
 * BrandLogo. Four variants:
 *
 *   dark={true}  markOnly={false} — full lockup, white wordmark.
 *                                   Use on the app's dark canvas.
 *
 *   dark={false} markOnly={false} — full lockup, near-black wordmark.
 *                                   Use on a genuinely light surface.
 *
 *   dark={true}  markOnly={true}  — just the K-with-check mark, white K.
 *                                   Square-ish lockup, useful in tight headers.
 *
 *   dark={false} markOnly={true}  — just the K-with-check mark, black K.
 *
 * Violet check is constant across every variant.
 *
 * Uses a plain <img>: the asset is small and static, so next/image's
 * optimizer adds nothing.
 */
export function BrandLogo({
  height,
  dark = true,
  markOnly = false,
  className,
  priority,
}: BrandLogoProps) {
  const src = markOnly
    ? dark
      ? MARK_DARK
      : MARK_LIGHT
    : dark
      ? LOCKUP_DARK
      : LOCKUP_LIGHT;
  const ratio = markOnly ? MARK_RATIO : LOCKUP_RATIO;

  return (
    <span className={cn("inline-flex items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Ksenda"
        width={Math.round(height * ratio)}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        style={{ height, width: "auto", display: "block" }}
      />
    </span>
  );
}
