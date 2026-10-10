/** The walkthrough video: opens it in its own window, which can go on another screen. */
import { call } from '../lib/ipc.ts'
import { useUi, type UiApi } from '../shared/ui.tsx'
import { IconVideo } from '../shared/icons.tsx'

/** Opens the walkthrough video in its own window (it can go on another screen). */
export async function openWalkthrough(ui: UiApi): Promise<void> {
  const ok = await call('app:openTutorial', undefined).catch(() => false)
  if (!ok) ui.toast('The walkthrough video isn’t part of this build of Spellforge.', true)
}

/** The start screen's button for it. */
export function WalkthroughButton({ label = false }: { label?: boolean }) {
  const ui = useUi()
  return (
    <button
      className={label ? 'ghost' : 'ghost square'}
      onClick={() => openWalkthrough(ui)}
      title="Watch the walkthrough: every part of Spellforge, step by step (opens its own window)"
    >
      <IconVideo />
      {label && 'Walkthrough'}
    </button>
  )
}
