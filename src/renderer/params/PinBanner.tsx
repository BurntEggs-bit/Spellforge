/** The strip across a pinned panel, which keeps what it shows while you browse. */
import { IconPin } from '../shared/icons.tsx'

/** The strip across a pinned panel. */
export function PinBanner({ what, onUnpin }: { what: string; onUnpin: () => void }) {
  return (
    <div className="pin-banner" title={`Pinned: ${what} stays here while you browse`}>
      <IconPin size={13} />
      <span>Pinned</span>
      <button className="ghost" onClick={onUnpin}>
        Unpin
      </button>
    </div>
  )
}
