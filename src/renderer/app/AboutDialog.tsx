/**
 * About Spellforge: its version and licence, why the GPL work it learned
 * from leaves that licence as it is, the game's notice, and everyone whose
 * work it uses or learned from (src/shared/credits.ts, the list CREDITS.md
 * is written from).
 */
import { version } from '../../../package.json'
import { CREDITS, CREDIT_SECTIONS, GAME_NOTICE, GPL_NOTICE, LICENSE_NOTICE } from '../../shared/credits.ts'
import { Modal } from '../shared/Modal.tsx'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={`Spellforge ${version}`} width={720} onClose={onClose} escapeCloses bodyClassName="about-credits">
      <p>{LICENSE_NOTICE}</p>
      <p>{GPL_NOTICE}</p>
      <p className="dim">{GAME_NOTICE}</p>
      {CREDIT_SECTIONS.map(([kind, title]) => {
        const credits = CREDITS.filter((c) => c.kinds[0] === kind)
        if (!credits.length) return null
        return (
          <section key={kind}>
            <h3>{title}</h3>
            <ul>
              {credits.map((c) => (
                <li key={c.name}>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.name}
                    </a>
                  ) : (
                    <b>{c.name}</b>
                  )}
                  <span className="dim">
                    , by {c.by}
                    {c.license ? ` (${c.license})` : ''}
                  </span>
                  : {c.use}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </Modal>
  )
}
