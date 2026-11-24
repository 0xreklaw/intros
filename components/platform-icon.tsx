import { PLATFORM_LABEL, type SocialPlatform } from "@/src/clients/types"
import { cn } from "@/lib/utils"

/**
 * Brand marks for the networks we read, drawn as inline SVG so they stay sharp at any size
 * and need no image requests. Each sits on its brand colour as a small rounded tile.
 */

const XMARK =
  "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"

const LINKEDIN =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125Zm1.782 13.019H3.555V9h3.564v11.452Z"

type Glyph = { tile: string; mark: React.ReactNode }

const GLYPHS: Record<SocialPlatform, Glyph> = {
  x: {
    tile: "bg-black",
    mark: <path d={XMARK} transform="translate(3.6 3.6) scale(0.7)" />,
  },
  linkedin: {
    tile: "bg-[#0A66C2]",
    mark: <path d={LINKEDIN} transform="translate(2.6 2.6) scale(0.78)" />,
  },
  instagram: {
    tile: "bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285AEB_90%)]",
    mark: (
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4.5" y="4.5" width="15" height="15" rx="4.5" />
        <circle cx="12" cy="12" r="3.6" />
        <circle
          cx="16.9"
          cy="7.1"
          r="0.6"
          fill="currentColor"
          strokeWidth="0.8"
        />
      </g>
    ),
  },
}

/** A network's logo as a small tile in its brand colour. */
export function PlatformIcon({
  platform,
  className,
}: {
  platform: SocialPlatform
  /** Size and any extras; defaults to a 20px tile. */
  className?: string
}) {
  const glyph = GLYPHS[platform]
  return (
    <span
      role="img"
      aria-label={PLATFORM_LABEL[platform]}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] text-white",
        glyph.tile,
        className
      )}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-full">
        {glyph.mark}
      </svg>
    </span>
  )
}
