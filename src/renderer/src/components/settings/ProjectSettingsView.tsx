import { ReactNode, useEffect, useRef, useState } from 'react'
import { api, basename } from '../../lib/api'
import { projectStore, useProject, ProjectFeatures, ProjectSettings } from '../../lib/project'
import type { Settings, TrackerType } from '../../lib/types'
import { t } from '../../i18n/ko'
import { Icon, toast } from '../ui'
import { autoColor, defaultInitials, ProjectAvatar } from '../ProjectAvatar'
import { ComingSoon, NavGroup, PageHeader, Row, Section, SettingsShell, Toggle } from './Shell'
import { McpList } from './AppSettingsView'
import { EDITOR_FONTS, effectiveDisplay, setProjectDisplay, UI_SCALES } from '../../lib/display'

const P = t.projectView
const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

export type ProjectPage = 'appearance' | 'sharing' | 'permissions' | 'trackers' | 'providers' | 'mcp' | 'github' | 'extensions'

const GROUPS: NavGroup[] = [
  {
    title: P.group,
    items: [
      { id: 'appearance', label: P.pages.appearance, icon: 'palette' },
      { id: 'sharing', label: P.pages.sharing, icon: 'users', badge: P.beta },
      { id: 'permissions', label: P.pages.permissions, icon: 'shield' },
      { id: 'trackers', label: P.pages.trackers, icon: 'clipboard' },
      { id: 'providers', label: P.pages.providers, icon: 'robot' },
      { id: 'mcp', label: P.pages.mcp, icon: 'server' },
      { id: 'github', label: P.pages.github, icon: 'github' },
      { id: 'extensions', label: P.pages.extensions, icon: 'puzzle' }
    ]
  }
]

const MODELS = [
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-haiku-5-5', 'Haiku 5.5'],
  ['claude-fable-5-1', 'Fable 5.1']
]

/** 사용자 메뉴 → 프로젝트 설정 (프로젝트에 기능 추가는 '확장' 페이지로 열린다) */
export function ProjectSettingsView({
  workspace,
  settings,
  initialPage = 'appearance',
  onClose,
  onOpenFile
}: {
  workspace: string
  settings: Settings
  initialPage?: ProjectPage
  onClose: () => void
  onOpenFile: (p: string) => void
}) {
  const [page, setPage] = useState<ProjectPage>(initialPage)
  const project = useProject()
  let body: ReactNode = null
  if (!project) body = <p className="row-desc">{t.common.loading}</p>
  else
    switch (page) {
      case 'appearance':
        body = <AppearancePage workspace={workspace} settings={settings} />
        break
      case 'sharing':
        body = (
          <>
            <ComingSoon name={P.pages.sharing} />
            <p className="row-desc">{P.sharing.desc}</p>
          </>
        )
        break
      case 'permissions':
        body = <PermissionsPage project={project} settings={settings} onOpenFile={onOpenFile} />
        break
      case 'trackers':
        body = <TrackersPage project={project} />
        break
      case 'providers':
        body = <ProvidersPage project={project} settings={settings} />
        break
      case 'mcp':
        body = <McpPage onOpenFile={onOpenFile} />
        break
      case 'github':
        body = <GithubPage />
        break
      case 'extensions':
        body = <ExtensionsPage project={project} onOpenFile={onOpenFile} />
        break
    }
  return (
    <SettingsShell groups={GROUPS} active={page} onSelect={(id) => setPage(id as ProjectPage)} onClose={onClose}>
      {body}
    </SettingsShell>
  )
}

/* ---------------- 모양 ---------------- */

/** 고른 이미지를 128px 정사각형 PNG 로 줄여 data URL 로 만든다 (설정 파일이 커지지 않게) */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const size = 128
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')!
      const s = Math.min(img.width, img.height)
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'))
    img.src = url
  })
}

function AppearancePage({ workspace, settings }: { workspace: string; settings: Settings }) {
  const a = P.appearance
  const name = basename(workspace)
  const saved = settings.projectAppearance?.[workspace] ?? {}
  const [initials, setInitials] = useState(saved.initials ?? '')
  const [color, setColor] = useState(saved.color ?? '')
  const [image, setImage] = useState(saved.image ?? '')
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty = initials !== (saved.initials ?? '') || color !== (saved.color ?? '') || image !== (saved.image ?? '')
  const draft = { initials: initials.trim() || undefined, color: color || undefined, image: image || undefined }

  // 아이콘 항목만 바꾸고 화면 항목(테마·글꼴)은 그대로 둔다
  const write = (value: typeof draft): void => setProjectDisplay(settings, workspace, value)
  const display = effectiveDisplay(settings, workspace)
  const setDisplay = (patch: Parameters<typeof setProjectDisplay>[2]): void => setProjectDisplay(settings, workspace, patch)

  return (
    <>
      <PageHeader title={P.pages.appearance} desc={a.desc(name)} />
      <div className="appearance-card">
        <ProjectAvatar path={workspace} name={name} appearance={draft} size={56} />
        <div>
          <b>{name}</b>
          <div className="row-desc mono">{workspace}</div>
        </div>
      </div>
      <Section title={a.identity}>
        <Row title={a.initials} desc={a.initialsDesc(defaultInitials(name))} stacked>
          <input
            value={initials}
            placeholder={defaultInitials(name)}
            onChange={(e) => setInitials([...e.target.value].slice(0, 3).join(''))}
            style={{ width: 100 }}
          />
        </Row>
        <Row title={a.color} stacked>
          <div className="btn-row">
            <input type="color" className="color-input" value={color || autoColor(workspace)} onChange={(e) => setColor(e.target.value)} />
            <span>{color ? a.custom : a.automatic}</span>
            <button className="btn small" disabled={!color} onClick={() => setColor('')}>
              {a.useAuto}
            </button>
          </div>
        </Row>
        <Row title={a.image} desc={a.imageDesc} stacked>
          <div className="btn-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                if (f.size > 5 * 1024 * 1024) return toast(a.tooBig)
                try {
                  setImage(await shrinkImage(f))
                } catch (err) {
                  toast(errMsg(err))
                }
              }}
            />
            <button className="btn" onClick={() => fileRef.current?.click()}>
              {a.chooseImage}
            </button>
            {image && (
              <button className="btn" onClick={() => setImage('')}>
                {a.removeImage}
              </button>
            )}
          </div>
        </Row>
      </Section>
      <div className="btn-row settings-actions">
        <button
          className="btn primary"
          disabled={!dirty}
          onClick={() => {
            write(draft)
            toast(a.saved)
          }}
        >
          {a.save}
        </button>
        <button
          className="btn"
          onClick={() => {
            setInitials('')
            setColor('')
            setImage('')
            write({ initials: undefined, color: undefined, image: undefined })
          }}
        >
          {a.reset}
        </button>
      </div>

      <Section title={a.display} desc={a.displayDesc}>
        <Row title={a.theme} stacked>
          <div className="theme-cards four">
            <button className={`theme-card theme-${settings.theme} auto${!saved.theme ? ' on' : ''}`} onClick={() => setDisplay({ theme: undefined })}>
              <ThemePreview />
              <b>{a.appDefaultOf(t.settings.themes[settings.theme])}</b>
            </button>
            {(Object.keys(t.settings.themes) as Settings['theme'][]).map((k) => (
              <button key={k} className={`theme-card theme-${k}${saved.theme === k ? ' on' : ''}`} onClick={() => setDisplay({ theme: k })}>
                <ThemePreview />
                <b>{t.settings.themes[k]}</b>
              </button>
            ))}
          </div>
        </Row>
        <Row title={a.textSize} desc={a.textSizeDesc} stacked>
          <div className="segmented">
            {UI_SCALES.map((v) => (
              <button key={v} className={display.uiScale === v ? 'on' : ''} onClick={() => setDisplay({ uiScale: v === 1 ? undefined : v })}>
                <span style={{ fontSize: 12 * v }}>가</span>
                {a.scales[String(v)]} <span className="pct">{Math.round(v * 100)}%</span>
              </button>
            ))}
          </div>
        </Row>
        <Row title={a.fontSize} desc={a.fontSizeDesc} stacked>
          <div className="range-row">
            <input
              type="range"
              min={12}
              max={24}
              value={display.editorFontSize}
              onChange={(e) => setDisplay({ editorFontSize: Number(e.target.value) })}
            />
            <span>{display.editorFontSize}px</span>
          </div>
        </Row>
        <Row title={a.font} desc={a.fontDesc} stacked>
          <div className="segmented">
            {(Object.keys(EDITOR_FONTS) as (keyof typeof EDITOR_FONTS)[]).map((k) => (
              <button
                key={k}
                className={display.editorFont === k ? 'on' : ''}
                style={{ fontFamily: EDITOR_FONTS[k] }}
                onClick={() => setDisplay({ editorFont: k === 'system' ? undefined : k })}
              >
                {a.fonts[k]}
              </button>
            ))}
          </div>
        </Row>
        <div className="font-preview" style={{ fontFamily: EDITOR_FONTS[display.editorFont], fontSize: display.editorFontSize }}>
          {a.preview}
        </div>
        <div className="btn-row">
          <button
            className="btn"
            disabled={!saved.theme && !saved.uiScale && !saved.editorFontSize && !saved.editorFont}
            onClick={() => setDisplay({ theme: undefined, uiScale: undefined, editorFontSize: undefined, editorFont: undefined })}
          >
            {a.resetDisplay}
          </button>
        </div>
      </Section>
    </>
  )
}

function ThemePreview() {
  return (
    <span className="preview">
      <span className="p-rail" />
      <span className="p-body">
        <span className="p-line" />
        <span className="p-line short" />
        <span className="p-accent" />
      </span>
    </span>
  )
}

/* ---------------- 에이전트 권한 · AI 제공자 ---------------- */

function useProjectSave() {
  return async (patch: Parameters<typeof projectStore.update>[0]): Promise<void> => {
    try {
      await projectStore.update(patch)
    } catch (e) {
      toast(errMsg(e))
    }
  }
}

function PermissionsPage({ project, settings, onOpenFile }: { project: ProjectSettings; settings: Settings; onOpenFile: (p: string) => void }) {
  const save = useProjectSave()
  const ps = t.projectSettings
  const [instructions, setInstructions] = useState(project.agent.instructions)
  const [hasClaudeMd, setHasClaudeMd] = useState<boolean | null>(null)
  useEffect(() => {
    api.project.info().then((i: { hasClaudeMd: boolean }) => setHasClaudeMd(i.hasClaudeMd))
  }, [])
  return (
    <>
      <PageHeader title={P.pages.permissions} desc={P.permissions.desc} />
      <Section>
        <Row title={ps.permission} stacked>
          <div className="perm-cards">
            {(['', 'default', 'acceptEdits', 'plan', 'bypassPermissions'] as const).map((k) => (
              <button
                key={k || 'app'}
                className={`perm-option${project.agent.permissionMode === k ? ' on' : ''}`}
                onClick={() => save({ agent: { permissionMode: k } })}
              >
                <span className={`perm-dot static perm-${k || settings.permissionMode}`} />
                <span>
                  <b>{k ? t.agent.permissionModes[k] : ps.useApp(t.agent.permissionModes[settings.permissionMode])}</b>
                  {k && <span className="usage-sub">{t.permissionPopover.desc[k]}</span>}
                </span>
              </button>
            ))}
          </div>
        </Row>
      </Section>
      <Section>
        <Row title={ps.instructions} desc={ps.instructionsHint} stacked>
          <textarea rows={6} value={instructions} onChange={(e) => setInstructions(e.target.value)} style={{ width: '100%', resize: 'vertical', lineHeight: 1.6 }} />
        </Row>
        <div className="btn-row">
          <button className="btn primary" disabled={instructions === project.agent.instructions} onClick={() => save({ agent: { instructions } }).then(() => toast(ps.saved))}>
            {ps.save}
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                onOpenFile(await api.project.claudeMd())
              } catch (e) {
                toast(errMsg(e))
              }
            }}
          >
            <Icon name="file" size={14} /> {hasClaudeMd ? ps.claudeMd : ps.claudeMdCreate}
          </button>
          <span className="row-desc">{ps.claudeMdHint}</span>
        </div>
      </Section>
    </>
  )
}

function ProvidersPage({ project, settings }: { project: ProjectSettings; settings: Settings }) {
  const save = useProjectSave()
  const appModel = MODELS.find(([id]) => id === settings.model)?.[1] ?? (settings.model || '기본')
  return (
    <>
      <PageHeader title={P.pages.providers} desc={P.providers.desc} />
      <Section>
        <Row title={P.providers.agent}>
          <span className="status-pill ok">{P.providers.claudeOnly}</span>
        </Row>
        <Row title={P.providers.model}>
          <select value={project.agent.model} onChange={(e) => save({ agent: { model: e.target.value } })}>
            <option value="">{t.projectSettings.useApp(appModel)}</option>
            {MODELS.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Row>
      </Section>
    </>
  )
}

/* ---------------- 트래커 ---------------- */

function TrackersPage({ project }: { project: ProjectSettings }) {
  const save = useProjectSave()
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    api.tracker.list().then((l: unknown[]) => setCount(l.length))
  }, [])
  return (
    <>
      <PageHeader title={P.pages.trackers} desc={P.trackers.desc} />
      <Section>
        <Row title={P.trackers.folder} desc={P.trackers.folderDesc}>
          {count !== null && <span className="row-desc">{P.trackers.count(count)}</span>}
        </Row>
        <Row title={P.trackers.defaultType}>
          <select value={project.tracker.defaultType} onChange={(e) => save({ tracker: { defaultType: e.target.value as TrackerType } })}>
            {Object.entries(t.tracker.types).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Row>
        <Row title={P.trackers.showDone} desc={P.trackers.showDoneDesc}>
          <Toggle checked={project.tracker.showDone} onChange={(v) => save({ tracker: { showDone: v } })} />
        </Row>
        <Row title={t.projectSettings.wikiDir}>
          <WikiDirInput value={project.wiki.dir} onSave={(dir) => save({ wiki: { dir } })} />
        </Row>
      </Section>
    </>
  )
}

function WikiDirInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} style={{ width: 220 }} />
}

/* ---------------- MCP · GitHub ---------------- */

function McpPage({ onOpenFile }: { onOpenFile: (p: string) => void }) {
  return (
    <>
      <PageHeader title={P.pages.mcp} desc={P.mcp.desc} />
      <Section>
        <McpList filter={(scope) => scope !== '사용자'} />
        <button
          className="btn"
          onClick={async () => {
            try {
              onOpenFile(await api.project.mcpFile())
            } catch (e) {
              toast(errMsg(e))
            }
          }}
        >
          {P.mcp.openFile}
        </button>
      </Section>
    </>
  )
}

function GithubPage() {
  const g = P.github
  const [remote, setRemote] = useState<{ url: string | null; github: { owner: string; repo: string; web: string } | null } | null>(null)
  const [gh, setGh] = useState<{ installed: boolean; version: string | null } | null>(null)
  useEffect(() => {
    api.project.remote().then(setRemote).catch(() => setRemote({ url: null, github: null }))
    api.system.provider('gh').then(setGh)
  }, [])
  return (
    <>
      <PageHeader title={P.pages.github} desc={g.desc} />
      <Section>
        <Row title={g.remote} desc={remote ? <span className="mono">{remote.url ?? g.none}</span> : t.common.loading}>
          {remote?.url && !remote.github && <span className="status-pill off">{g.notGithub}</span>}
          {remote?.github && <span className="status-pill ok">{`${remote.github.owner}/${remote.github.repo}`}</span>}
        </Row>
        {remote?.github && (
          <div className="btn-row">
            <button className="btn primary" onClick={() => api.project.openGithub(remote.github!.web)}>
              <Icon name="github" size={14} /> {g.open}
            </button>
            <button className="btn" onClick={() => api.project.openGithub(remote.github!.web + '/issues')}>
              {g.issues}
            </button>
            <button className="btn" onClick={() => api.project.openGithub(remote.github!.web + '/pulls')}>
              {g.pulls}
            </button>
            <button className="btn" onClick={() => api.project.openGithub(remote.github!.web + '/actions')}>
              {g.actions}
            </button>
          </div>
        )}
        <Row title={g.cli} desc={gh?.version ?? undefined}>
          {gh && <span className={`status-pill ${gh.installed ? 'ok' : 'off'}`}>{gh.installed ? S_installed : S_notInstalled}</span>}
        </Row>
        <p className="row-desc">{g.prNote}</p>
      </Section>
    </>
  )
}
const S_installed = t.settingsView.provider.installed
const S_notInstalled = t.settingsView.provider.notInstalled

/* ---------------- 확장 (= 프로젝트에 기능 추가) ---------------- */

function ExtensionsPage({ project, onOpenFile }: { project: ProjectSettings; onOpenFile: (p: string) => void }) {
  const save = useProjectSave()
  const f = t.features
  const [info, setInfo] = useState<{ isRepo: boolean; hasClaudeMd: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const loadInfo = (): void => {
    api.project.info().then(setInfo)
  }
  useEffect(loadInfo, [])
  const icons: Record<string, string> = { git: 'gitTree', tracker: 'database', parallel: 'agent', wiki: 'globe', aiPanel: 'sparkle', terminal: 'terminal', mermaid: 'edit' }
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await fn()
      if (ok) toast(ok)
      else if (typeof r === 'boolean') toast(r ? f.ignoreLocal.ok : f.ignoreLocal.exists)
      loadInfo()
    } catch (e) {
      toast(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader title={P.pages.extensions} desc={f.hint} />
      <Section>
        {(['git', 'tracker', 'parallel', 'wiki', 'aiPanel', 'terminal', 'mermaid'] as (keyof ProjectFeatures)[]).map((k) => (
          <Row
            key={k}
            title={
              <span className="row-with-icon">
                <Icon name={icons[k]} size={15} /> {f.items[k].title}
              </span>
            }
            desc={f.items[k].desc + ((k === 'git' || k === 'parallel') && info && !info.isRepo ? ` · ${f.gitInit.title} 필요` : '')}
          >
            <Toggle checked={project.features[k]} onChange={(v) => save({ features: { [k]: v } })} />
          </Row>
        ))}
      </Section>
      <Section title={f.quick}>
        <Row title={f.gitInit.title} desc={f.gitInit.desc}>
          {info?.isRepo ? (
            <span className="status-pill ok">{f.gitInit.done}</span>
          ) : (
            <button className="btn small" disabled={busy} onClick={() => run(() => api.project.gitInit(), f.gitInit.ok)}>
              {f.run}
            </button>
          )}
        </Row>
        <Row title={f.claudeMd.title} desc={f.claudeMd.desc}>
          <button className="btn small" disabled={busy} onClick={() => run(async () => onOpenFile(await api.project.claudeMd()), info?.hasClaudeMd ? undefined : f.claudeMd.ok)}>
            {info?.hasClaudeMd ? f.claudeMd.done : f.run}
          </button>
        </Row>
        <Row title={f.ignoreLocal.title} desc={f.ignoreLocal.desc}>
          <button className="btn small" disabled={busy} onClick={() => run(() => api.project.ignoreLocal())}>
            {f.run}
          </button>
        </Row>
      </Section>
    </>
  )
}
