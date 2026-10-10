/** The app's root: the setup screen (sources, projects, kept changes) until a project is open, then its workspace. */
import { useEffect, useState } from 'react'
import type { ProjectSummary, RecoveryInfo, SetupStatus, ThemeSettings } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { projectChanged } from '../lib/projectCaches.ts'
import { UiProvider, useUi } from '../shared/ui.tsx'
import { Workspace } from './Workspace.tsx'
import { AboutDialog } from './AboutDialog.tsx'
import { AppearanceDialog, BrandMark } from './Appearance.tsx'
import { IconFolder, IconInfo, IconPalette } from '../shared/icons.tsx'
import { WalkthroughButton } from './Walkthrough.tsx'
import { version } from '../../../package.json'
import { applyTheme } from './theme.ts'
import { KeptChanges, RestoreDialog } from './Recovery.tsx'
import { plural } from '../../shared/format.ts'

export function App() {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  )
}

function Shell() {
  const ui = useUi()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  /** Projects Spellforge closed on with changes unsaved (kept to bring back). */
  const [kept, setKept] = useState<RecoveryInfo[]>([])
  /** A project just opened that has some: asking whether to bring them back. */
  const [asking, setAsking] = useState<{ info: RecoveryInfo; summary: ProjectSummary } | null>(null)

  useEffect(() => {
    call('setup:status', undefined).then(setStatus)
  }, [])
  const refreshKept = () =>
    call('recovery:list', undefined)
      .then(setKept)
      .catch(() => setKept([]))
  useEffect(() => {
    if (!project) refreshKept()
  }, [project])

  // Apply the saved theme whenever settings load or change.
  useEffect(() => {
    if (status?.settings.theme) applyTheme(status.settings.theme)
  }, [status?.settings.theme])

  const saveTheme = async (theme: ThemeSettings) => setStatus(await call('setup:save', { theme }))

  const restore = async (summary: ProjectSummary) => {
    const r = await ui.run('Bringing back your unsaved changes', () => call('recovery:restore', undefined))
    if (r) {
      ui.toast(
        r.failed.length
          ? `Brought back ${r.applied} of ${r.applied + r.failed.length} unsaved changes; ${r.failed.length} couldn’t be made again (${r.failed[0].error}).`
          : `Brought back ${plural(r.applied, 'unsaved change')}, exactly as they were. Save to write them into your mod folder.`,
        r.failed.length > 0,
      )
    }
    setAsking(null)
    setProject(summary)
  }
  const discard = async (summary: ProjectSummary) => {
    await ui.run('Discarding the kept changes', () => call('recovery:discard', {}))
    setAsking(null)
    setProject(summary)
  }

  /** Opens a project; if it has changes kept from last time, asks (or, `restoreNow`, brings them back). */
  const openProject = (modDir: string, restoreNow = false) =>
    ui.run('Loading project', async () => {
      const summary = await call('project:open', { modDir })
      projectChanged()
      // Files an earlier Spellforge wrote wrongly, fixed in memory: the next save writes them. One toast
      // for them all (there's one toast at a time: shown one by one, only the last would be seen).
      if (summary.repaired?.length) ui.toast(summary.repaired.join('\n\n'))
      const info = await call('recovery:status', undefined)
      if (!info) setProject(summary)
      else if (restoreNow) await restore(summary)
      else setAsking({ info, summary })
    })

  if (!status) return <div className="setup-screen" />
  const appearance = appearanceOpen && (
    <AppearanceDialog theme={status.settings.theme} onSave={saveTheme} onClose={() => setAppearanceOpen(false)} />
  )
  const about = aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />
  const askRestore = asking && (
    <RestoreDialog
      info={asking.info}
      onRestore={() => restore(asking.summary)}
      onDiscard={() => discard(asking.summary)}
    />
  )
  if (project)
    return (
      <>
        <Workspace
          project={project}
          onClose={() => setProject(null)}
          onAppearance={() => setAppearanceOpen(true)}
          onAbout={() => setAboutOpen(true)}
          onReopened={setProject}
        />
        {appearance}
        {about}
      </>
    )
  return (
    <>
      <Setup
        status={status}
        onStatus={setStatus}
        onOpen={(modDir) => openProject(modDir)}
        onAppearance={() => setAppearanceOpen(true)}
        onAbout={() => setAboutOpen(true)}
        kept={kept}
        onRestoreKept={(modDir) => openProject(modDir, true)}
      />
      {appearance}
      {about}
      {askRestore}
    </>
  )
}

function Setup({
  status,
  onStatus,
  onOpen,
  onAppearance,
  onAbout,
  kept,
  onRestoreKept,
}: {
  status: SetupStatus
  onStatus: (s: SetupStatus) => void
  onOpen: (modDir: string) => void
  onAppearance: () => void
  onAbout: () => void
  /** Projects with unsaved changes kept from last time. */
  kept: RecoveryInfo[]
  onRestoreKept: (modDir: string) => void
}) {
  const ui = useUi()
  const s = status.settings
  const ready = status.problems.length === 0

  const pick = async (key: 'gameDir' | 'smithboxDir', title: string) => {
    const dir = await call('dialog:pickFolder', { title, defaultPath: s[key] || undefined })
    if (dir) onStatus(await call('setup:save', { [key]: dir }))
  }

  const findGame = async () => {
    const found = await ui.run('Looking for Elden Ring', () => call('setup:findGame', undefined))
    if (!found) return
    if (!found.length) {
      ui.toast('Couldn’t find Elden Ring in your Steam libraries. Use “Choose…” and pick its Game folder.', true)
      return
    }
    onStatus(await call('setup:save', { gameDir: found[0] }))
    ui.toast(
      found.length > 1 ? `Found ${found.length} installs; using ${found[0]}.` : `Found Elden Ring at ${found[0]}.`,
    )
  }

  const importNames = async () => {
    const file = await call('dialog:pickFile', {
      title: 'Choose a CSV of effect IDs and names',
      extensions: ['csv', 'txt'],
    })
    if (!file) return
    const count = await ui.run('Reading effect names', () => call('setup:effectNames', { file }))
    if (count === undefined) return
    ui.toast(count ? `Loaded ${count} effect names.` : 'No "id, name" rows found in that file.', count === 0)
    onStatus(await call('setup:status', undefined))
  }

  const pickProject = async () => {
    const dir = await call('dialog:pickFolder', { title: 'Choose your project’s ModEngine2 "mod" folder' })
    if (!dir) return
    if (!/[\\/]mod$/i.test(dir)) {
      ui.toast(
        'Tip: pick the "mod" folder inside your ModEngine2 project. Spellforge writes regulation.bin and sfx files there.',
      )
    }
    onOpen(dir)
  }

  return (
    <div className="setup-screen">
      <div className="setup">
        <div className="setup-hero">
          <span style={{ color: 'var(--gold)', display: 'flex' }}>
            <BrandMark />
          </span>
          <div className="grow">
            <h1>
              Spellforge <span className="version">{version}</span>
            </h1>
            <div className="dim">Params, effects, animations and behaviour scripts for Elden Ring mods</div>
          </div>
          <WalkthroughButton label />
          <button className="ghost" onClick={onAppearance}>
            <IconPalette />
            Appearance
          </button>
          <button className="ghost" onClick={onAbout} title="Version, licence and credits">
            <IconInfo />
            About
          </button>
        </div>

        <section className="section">
          <header>
            <h3>Projects</h3>
          </header>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {s.recentProjects.map((p) => (
              <div key={p} className="recent">
                <span className="mono ellipsis grow" title={p}>
                  {p}
                </span>
                <button disabled={!ready} onClick={() => onOpen(p)}>
                  Open
                </button>
                <button
                  className="ghost"
                  title="Remove from this list (doesn’t delete anything on disk)"
                  onClick={async () =>
                    onStatus(await call('setup:save', { recentProjects: s.recentProjects.filter((r) => r !== p) }))
                  }
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="row">
              <button
                className="primary"
                disabled={!ready}
                onClick={pickProject}
                title="A ModEngine project’s mod folder, e.g. …\ME2 - My Mod\mod: all changes are written there"
              >
                <IconFolder />
                Open a mod folder…
              </button>
            </div>
          </div>
        </section>

        {ready && <KeptChanges list={kept} onRestore={onRestoreKept} />}

        <section className="section">
          <header>
            <h3>Sources</h3>
            <span className="faint">read-only</span>
          </header>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="path-field">
              <span>Elden Ring</span>
              <span className="ellipsis" title={s.gameDir}>
                <span className={`mono ${status.gameOk ? '' : 'faint'}`}>{s.gameDir || 'not found yet'}</span>
                {status.gameKind && (
                  <span
                    className="faint"
                    title={
                      status.gameKind === 'install' ? 'Read straight from its archives: no unpacking needed' : undefined
                    }
                  >
                    {'  '}
                    {status.gameKind === 'install' ? 'installed game' : 'unpacked copy'}
                  </span>
                )}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button onClick={findGame} title="Look for Elden Ring in your Steam libraries">
                  Find automatically
                </button>
                <button
                  onClick={() =>
                    pick('gameDir', 'Choose Elden Ring’s "Game" folder (…\\ELDEN RING\\Game), or an unpacked copy')
                  }
                >
                  Choose…
                </button>
              </span>
            </div>
            {!status.gameOk && (
              <div className="faint" style={{ fontSize: 12 }}>
                Usually <span className="mono">…\steamapps\common\ELDEN RING\Game</span>.
              </div>
            )}
            <div className="path-field">
              <span>Param data</span>
              <span className="ellipsis" title={status.dataSource.path}>
                {status.dataSource.kind === 'bundled' ? (
                  <>
                    Built-in <span className="faint">({status.dataSource.version})</span>
                  </>
                ) : (
                  <>
                    Smithbox <span className="mono faint">{status.dataSource.path}</span>
                  </>
                )}
              </span>
              {status.dataSource.kind === 'bundled' ? (
                <button
                  title="Optional: use a newer Smithbox install's param definitions and names"
                  onClick={() => pick('smithboxDir', 'Choose a Smithbox folder to use its (newer) param data')}
                >
                  Use Smithbox…
                </button>
              ) : (
                <button onClick={async () => onStatus(await call('setup:save', { smithboxDir: '' }))}>
                  Use built-in
                </button>
              )}
            </div>
            <div className="path-field">
              <span>Effect names</span>
              <span
                className={`mono ellipsis ${s.effectNamesCsv ? '' : 'faint'}`}
                title="A CSV export of the community FXR ID sheet, for its effect names (release builds have them built in)"
              >
                {s.effectNamesCsv || 'optional'}
              </span>
              <button onClick={importNames}>Import…</button>
            </div>
            <div className="checks">
              <span className={status.gameOk ? 'ok' : 'bad'}>{status.gameOk ? '✓' : '✗'} game</span>
              <span className="ok">✓ param data</span>
              <span className={status.oodleOk ? 'ok' : 'bad'}>{status.oodleOk ? '✓' : '✗'} Oodle</span>
            </div>
            {status.problems.map((p) => (
              <div key={p} className="warn">
                {p}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
