/**
 * A small icon set (24-unit grid, 1.75 stroke, round joins) so the main
 * controls read at a glance. Icons inherit the text colour.
 */
import type { ReactNode } from 'react'

function Svg({ children, size = 16, title }: { children: ReactNode; size?: number; title?: string }) {
  return (
    <svg
      className="icon-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  )
}

type P = { size?: number; title?: string }

/** Params & effects: stacked layers. */
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
    <path d="m3 12 9 4.5 9-4.5" />
    <path d="m3 16.5 9 4.5 9-4.5" />
  </Svg>
)
/** Enemies: a horned helm. */
/** What is this ID?: a number sign. */
export const IconHash = (p: P) => (
  <Svg {...p}>
    <path d="M10 4 8 20M16 4l-2 16M5 9h15M4 15h15" />
  </Svg>
)

export const IconSkull = (p: P) => (
  <Svg {...p}>
    <path d="M5 11a7 7 0 0 1 14 0v3.5a2 2 0 0 1-1 1.73V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-2.77a2 2 0 0 1-1-1.73V11Z" />
    <path d="M5.5 8.5 3 4l4.5 2.5" />
    <path d="M18.5 8.5 21 4l-4.5 2.5" />
    <path d="M8.5 13h2.5M13 13h2.5" />
    <path d="M12 15v2" />
  </Svg>
)
/** Animations: a figure mid-stride. */
export const IconMotion = (p: P) => (
  <Svg {...p}>
    <circle cx="14" cy="4.5" r="1.8" />
    <path d="M9 21l2.5-6 2.5 2.5V22" />
    <path d="M6.5 10.5 10 8l4 1 2.5 3.5 3 .5" />
    <path d="m10 8 1.5 7" />
  </Svg>
)
/** Events: a flag on its pole (the world's event flags). */
export const IconEvents = (p: P) => (
  <Svg {...p}>
    <path d="M6 21V3.5" />
    <path d="M6 4h11.5l-2.5 4 2.5 4H6" />
  </Svg>
)
/** Text: lines of writing with a speech tail. */
export const IconText = (p: P) => (
  <Svg {...p}>
    <path d="M4 5h16v11H9l-4 3.5V16H4Z" />
    <path d="M8 9h8" />
    <path d="M8 12.5h5" />
  </Svg>
)
export const IconSave = (p: P) => (
  <Svg {...p}>
    <path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2Z" />
    <path d="M8 3v5h7V3" />
    <rect x="7.5" y="13" width="9" height="6" rx="1" />
  </Svg>
)
export const IconPalette = (p: P) => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.5-1.5-2-1.5-3.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-3.9-4-7-9-7Z" />
    <circle cx="7.5" cy="11" r="1" />
    <circle cx="10" cy="7" r="1" />
    <circle cx="15" cy="7" r="1" />
  </Svg>
)
/** About: an i in a circle. */
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Svg>
)
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)
export const IconFolder = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </Svg>
)
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M7 5v14l11-7L7 5Z" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconPause = (p: P) => (
  <Svg {...p}>
    <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconStepBack = (p: P) => (
  <Svg {...p}>
    <path d="M16 6 9 12l7 6" />
  </Svg>
)
export const IconStepForward = (p: P) => (
  <Svg {...p}>
    <path d="m8 6 7 6-7 6" />
  </Svg>
)
export const IconToStart = (p: P) => (
  <Svg {...p}>
    <path d="M6 5v14" />
    <path d="M18 6l-8 6 8 6V6Z" />
  </Svg>
)
export const IconToEnd = (p: P) => (
  <Svg {...p}>
    <path d="M18 5v14" />
    <path d="M6 6l8 6-8 6V6Z" />
  </Svg>
)
export const IconLoop = (p: P) => (
  <Svg {...p}>
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </Svg>
)
export const IconOnce = (p: P) => (
  <Svg {...p}>
    <path d="M4 12h14" />
    <path d="m14 7 5 5-5 5" />
  </Svg>
)
/** Equipment: a helm. */
export const IconHelm = (p: P) => (
  <Svg {...p}>
    <path d="M5 13a7 7 0 0 1 14 0v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5Z" />
    <path d="M9 13h6" />
    <path d="M12 6V3" />
  </Svg>
)
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
)
/** Helpers: axes. */
export const IconAxes = (p: P) => (
  <Svg {...p}>
    <path d="M5 19V5" />
    <path d="M5 19h14" />
    <path d="m5 19 8-8" />
    <path d="m3 7 2-2 2 2M17 17l2 2-2 2" />
  </Svg>
)
/** The walkthrough video: a play button in a frame. */
export const IconVideo = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m10.2 9.2 4.8 2.8-4.8 2.8z" />
  </Svg>
)
/** Pin a panel: a push pin. */
export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M9 3.5h6l-1 5.5 3.2 3.2v1.8H6.8v-1.8L10 9z" />
    <path d="M12 14v6.5" />
  </Svg>
)
/** Frame the weapon: a crosshair. */
export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
)

export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Svg>
)
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconSpark = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="m6.3 6.3 2.4 2.4M15.3 15.3l2.4 2.4M6.3 17.7l2.4-2.4M15.3 8.7l2.4-2.4" />
  </Svg>
)
/** Pop a panel out into its own window. */
export const IconPopout = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="m20 4-8 8" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
)
/** Put a popped-out panel back into the main window. */
export const IconDockIn = (p: P) => (
  <Svg {...p}>
    <path d="M10 14H4v6" />
    <path d="m4 20 8-8" />
    <path d="M14 4h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
  </Svg>
)
export const IconMaximize = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
)
export const IconRestore = (p: P) => (
  <Svg {...p}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </Svg>
)
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Svg>
)
export const IconForward = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Svg>
)
/** Window layout: panes. */
export const IconLayout = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M9.5 4.5v15M9.5 11h11" />
  </Svg>
)
/** Reload in the running game: a circular arrow around a play mark. */
export const IconReload = (p: P) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v4h-4" />
    <path d="m10 9 5 3-5 3z" />
  </Svg>
)
/** Sound on: a speaker with waves. */
export const IconSound = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
)
/** Sound off: a speaker, crossed out. */
export const IconMute = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="m16 9.5 5 5" />
    <path d="m21 9.5-5 5" />
  </Svg>
)
/** Move (the viewer's tool): arrows out along the axes. */
export const IconMove = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v18M3 12h18" />
    <path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
  </Svg>
)
/** Rotate (the viewer's tool): a turning arc. */
export const IconRotate = (p: P) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v4h-4" />
  </Svg>
)
/** Snap: a magnet. */
export const IconMagnet = (p: P) => (
  <Svg {...p}>
    <path d="M6 4v7a6 6 0 0 0 12 0V4" />
    <path d="M6 8h3M15 8h3" />
  </Svg>
)
