import { ReactNode, useEffect, useMemo, useState } from 'react'
import { api, basename, relative } from '../../lib/api'
import { useAgentStore } from '../../lib/agentStore'
import { useProject } from '../../lib/project'
import { playSound } from '../../lib/sound'
import type { Settings } from '../../lib/types'
import { t, toolLabels } from '../../i18n/ko'
import { toast } from '../ui'
import { ComingSoon, NavGroup, PageHeader, Row, Section, SettingsShell, Toggle } from './Shell'

const S = t.settingsView
const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

const update = (patch: Partial<Settings>): void => {
  api.settings.update(patch)
}

const MODELS = [
  ['', '기본 모델'],
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-haiku-5-5', 'Haiku 5.5'],
  ['claude-fable-5-1', 'Fable 5.1']
]

const fmtBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export const APP_PAGES = [
  'notifications',
  'voice',
  'agentFeatures',
  'sandbox',
  'advanced',
  'database',
  'apiKeys',
  'claude',
  'codex',
  'opencode',
  'copilot',
  'grok',
  'cursor',
  'gemini',
  'marketplace',
  'installed',
  'privileged',
  'plugins',
  'mcp',
  'cost',
  'curator'
] as const
export type AppPage = (typeof APP_PAGES)[number]

const a = S.alpha
const GROUPS: NavGroup[] = [
  {
    title: S.groups.app,
    items: [
      { id: 'notifications', label: S.pages.notifications, icon: 'bell' },
      { id: 'voice', label: S.pages.voice, icon: 'mic', badge: a },
      { id: 'agentFeatures', label: S.pages.agentFeatures, icon: 'flask', badge: a },
      { id: 'sandbox', label: S.pages.sandbox, icon: 'cloud', badge: a },
      { id: 'advanced', label: S.pages.advanced, icon: 'settings' },
      { id: 'database', label: S.pages.database, icon: 'database', badge: a }
    ]
  },
  {
    title: S.groups.providers,
    hint: S.providersHint,
    items: [
      { id: 'apiKeys', label: S.pages.apiKeys, icon: 'key' },
      { id: 'claude', label: S.pages.claude, icon: 'sparkle' },
      { id: 'codex', label: S.pages.codex, icon: 'hexagon' },
      { id: 'opencode', label: S.pages.opencode, icon: 'square', badge: a },
      { id: 'copilot', label: S.pages.copilot, icon: 'terminal', badge: a },
      { id: 'grok', label: S.pages.grok, icon: 'slash', badge: a },
      { id: 'cursor', label: S.pages.cursor, icon: 'hexagon', badge: a },
      { id: 'gemini', label: S.pages.gemini, icon: 'agent', badge: a }
    ]
  },
  {
    title: S.groups.extensions,
    items: [
      { id: 'marketplace', label: S.pages.marketplace, icon: 'store' },
      { id: 'installed', label: S.pages.installed, icon: 'puzzle' },
      { id: 'privileged', label: S.pages.privileged, icon: 'shield' },
      { id: 'plugins', label: S.pages.plugins, icon: 'grid' },
      { id: 'mcp', label: S.pages.mcp, icon: 'server' },
      { id: 'cost', label: S.pages.cost, icon: 'coin' },
      { id: 'curator', label: S.pages.curator, icon: 'nodes' }
    ]
  }
]

/** 사용자 메뉴 → 애플리케이션 설정 */
export function AppSettingsView({
  settings,
  initialPage = 'notifications',
  hasWorkspace,
  onClose,
  onOpenFeatures,
  onOpenWiki
}: {
  settings: Settings
  initialPage?: AppPage
  hasWorkspace: boolean
  onClose: () => void
  onOpenFeatures: () => void
  onOpenWiki: () => void
}) {
  const [page, setPage] = useState<AppPage>(initialPage)
  let body: ReactNode
  switch (page) {
    case 'notifications':
      body = <NotificationsPage s={settings} />
      break
    case 'agentFeatures':
      body = <AgentFeaturesPage s={settings} />
      break
    case 'advanced':
      body = <AdvancedPage s={settings} />
      break
    case 'database':
      body = <DatabasePage />
      break
    case 'apiKeys':
      body = <ApiKeysPage s={settings} />
      break
    case 'claude':
      body = <ClaudePage s={settings} />
      break
    case 'codex':
    case 'opencode':
    case 'copilot':
    case 'grok':
    case 'cursor':
    case 'gemini':
      body = <ProviderPage id={page} />
      break
    case 'marketplace':
    case 'installed':
      body = <FeaturesPage kind={page} hasWorkspace={hasWorkspace} onOpenFeatures={onOpenFeatures} />
      break
    case 'privileged':
      body = (
        <>
          <PageHeader title={S.pages.privileged} desc={S.extensions.privilegedDesc} />
          <Section>
            {S.extensions.privileged.map(([title, desc]) => (
              <Row key={title} title={title} desc={desc} />
            ))}
          </Section>
        </>
      )
      break
    case 'plugins':
      body = <PluginsPage />
      break
    case 'mcp':
      body = <McpPage />
      break
    case 'cost':
      body = <CostPage hasWorkspace={hasWorkspace} />
      break
    case 'curator':
      body = (
        <>
          <PageHeader title={S.pages.curator} desc={S.extensions.curatorDesc} />
          {hasWorkspace && (
            <button className="btn" onClick={onOpenWiki}>
              {S.extensions.openWiki}
            </button>
          )}
        </>
      )
      break
    default:
      body = <ComingSoon name={S.pages[page]} />
  }
  return (
    <SettingsShell groups={GROUPS} active={page} onSelect={(id) => setPage(id as AppPage)} onClose={onClose}>
      {body}
    </SettingsShell>
  )
}

/* ---------------- 애플리케이션 ---------------- */

function NotificationsPage({ s }: { s: Settings }) {
  const n = S.notifications
  return (
    <>
      <PageHeader title={S.pages.notifications} desc={n.desc} />
      <Section title={n.soundTitle} desc={n.soundDesc}>
        <Row title={n.soundEnable} desc={n.soundEnableDesc}>
          <Toggle checked={s.soundEnabled} onChange={(v) => update({ soundEnabled: v })} />
        </Row>
        <Row title={n.soundType} desc={n.soundTypeDesc} stacked>
          <div className="radio-list">
            {(['chime', 'bell', 'pop', 'custom'] as const).map((k) => (
              <label key={k} className="radio">
                <input
                  type="radio"
                  name="sound"
                  disabled={!s.soundEnabled}
                  checked={s.soundType === k}
                  onChange={async () => {
                    if (k === 'custom' && !s.customSoundPath) {
                      await api.notify.pickSound()
                      return
                    }
                    update({ soundType: k })
                    playSound(k, s.soundVolume)
                  }}
                />
                {n.sounds[k]}
                {k === 'custom' && (
                  <>
                    {s.customSoundPath && <span className="row-desc mono">{basename(s.customSoundPath)}</span>}
                    <button className="btn small" disabled={!s.soundEnabled} onClick={(e) => (e.preventDefault(), api.notify.pickSound())}>
                      {n.pickFile}
                    </button>
                  </>
                )}
              </label>
            ))}
          </div>
        </Row>
        <Row title={n.volume} desc={n.volumeDesc} stacked>
          <div className="range-row">
            <input
              type="range"
              min={0}
              max={100}
              value={s.soundVolume}
              disabled={!s.soundEnabled}
              onChange={(e) => update({ soundVolume: Number(e.target.value) })}
            />
            <span>{s.soundVolume}%</span>
          </div>
        </Row>
        <button className="btn" disabled={!s.soundEnabled} onClick={() => playSound(s.soundType, s.soundVolume)}>
          {n.test}
        </button>
      </Section>
      <Section title={n.osTitle} desc={n.osDesc}>
        <Row title={n.osEnable} desc={n.osEnableDesc}>
          <Toggle checked={s.osNotify} onChange={(v) => update({ osNotify: v })} />
        </Row>
        <Row title={n.osFocused} desc={n.osFocusedDesc}>
          <Toggle checked={s.osNotifyWhenFocused} disabled={!s.osNotify} onChange={(v) => update({ osNotifyWhenFocused: v })} />
        </Row>
        <p className="row-desc">{n.osNote}</p>
        <div className="btn-row">
          <button className="btn" onClick={() => api.notify.test()}>
            {n.sendTest}
          </button>
          <button className="btn" onClick={() => api.notify.openSystemSettings()}>
            {n.openSystem}
          </button>
        </div>
      </Section>
      <Section title={n.blockedTitle} desc={n.blockedDesc}>
        <Row title={n.blockedEnable} desc={n.blockedEnableDesc}>
          <Toggle checked={s.notifyBlocked} onChange={(v) => update({ notifyBlocked: v })} />
        </Row>
      </Section>
    </>
  )
}

function AgentFeaturesPage({ s }: { s: Settings }) {
  const f = S.agentFeatures
  return (
    <>
      <PageHeader title={S.pages.agentFeatures} desc={f.desc} />
      <Section>
        <Row title={f.thinking} desc={f.thinkingDesc}>
          <Toggle checked={s.showThinking} onChange={(v) => update({ showThinking: v })} />
        </Row>
      </Section>
      <Section title={f.parallel}>
        <Row title={f.maxParallel} desc={f.maxParallelDesc}>
          <input
            type="number"
            min={1}
            max={8}
            value={s.maxParallel}
            onChange={(e) => update({ maxParallel: Math.min(8, Math.max(1, Number(e.target.value) || 3)) })}
            style={{ width: 80 }}
          />
        </Row>
        <Row title={f.parallelPermission} desc={f.parallelPermissionDesc}>
          <select value={s.parallelPermissionMode} onChange={(e) => update({ parallelPermissionMode: e.target.value as Settings['permissionMode'] })}>
            {Object.entries(t.agent.permissionModes).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Row>
      </Section>
    </>
  )
}

function AdvancedPage({ s }: { s: Settings }) {
  const ad = S.advanced
  return (
    <>
      <PageHeader title={S.pages.advanced} desc={ad.desc} />
      <Section>
        <Row title={ad.autosave} desc={ad.autosaveDesc}>
          <Toggle checked={s.autosave} onChange={(v) => update({ autosave: v })} />
        </Row>
        <Row title={ad.historyInterval} desc={ad.historyIntervalDesc}>
          <input
            type="number"
            min={10}
            value={s.historyIntervalSec}
            onChange={(e) => update({ historyIntervalSec: Math.max(10, Number(e.target.value) || 60) })}
            style={{ width: 90 }}
          />
        </Row>
        <Row title={ad.dataFolder} desc={ad.dataFolderDesc}>
          <button className="btn small" onClick={() => api.system.openDataFolder()}>
            {ad.open}
          </button>
        </Row>
      </Section>
      <Section>
        <Row title={ad.reset} desc={ad.resetDesc}>
          <button
            className="btn small danger"
            onClick={async () => {
              if (await api.system.resetSettings()) toast('설정을 초기화했습니다.')
            }}
          >
            {ad.resetBtn}
          </button>
        </Row>
      </Section>
    </>
  )
}

function DatabasePage() {
  const [info, setInfo] = useState<{ root: string; items: { key: string; path: string; bytes: number }[] } | null>(null)
  const load = (): void => {
    api.system.storage().then(setInfo)
  }
  useEffect(load, [])
  return (
    <>
      <PageHeader title={S.pages.database} desc={S.database.desc} />
      <Section>
        {info && <code className="path-box">{info.root}</code>}
        {info?.items.map((it) => (
          <Row key={it.key} title={S.database.items[it.key] ?? it.key} desc={<span className="mono">{relative(info.root, it.path)}</span>}>
            <span className="row-desc">{fmtBytes(it.bytes)}</span>
          </Row>
        ))}
        <div className="btn-row">
          <button className="btn" onClick={() => api.system.openDataFolder()}>
            {S.advanced.open}
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              if (await api.system.clearHistory()) {
                toast(S.database.cleared)
                load()
              }
            }}
          >
            {S.database.clearHistory}
          </button>
        </div>
      </Section>
    </>
  )
}

/* ---------------- 에이전트 제공자 ---------------- */

function ApiKeysPage({ s }: { s: Settings }) {
  const k = S.apiKeys
  const [status, setStatus] = useState<Record<string, { set: boolean; preview: string }>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const load = (): void => {
    api.system.keyStatus().then(setStatus)
  }
  useEffect(load, [])

  const keyRow = (name: 'anthropic' | 'openai' | 'gemini', title: string, desc: string) => (
    <Row title={title} desc={<>{desc}<br />{status[name]?.set ? `${k.saved}: ${status[name].preview}` : k.notSet}</>} stacked>
      <div className="btn-row">
        <input
          type="password"
          placeholder={k.placeholder}
          value={drafts[name] ?? ''}
          onChange={(e) => setDrafts({ ...drafts, [name]: e.target.value })}
          style={{ flex: 1, minWidth: 260 }}
          autoComplete="off"
        />
        <button
          className="btn primary"
          disabled={!drafts[name]?.trim()}
          onClick={async () => {
            try {
              await api.system.setKey(name, drafts[name])
              setDrafts({ ...drafts, [name]: '' })
              load()
            } catch (e) {
              toast(errMsg(e))
            }
          }}
        >
          {k.save}
        </button>
        {status[name]?.set && (
          <button className="btn danger" onClick={() => api.system.deleteKey(name).then(load)}>
            {k.remove}
          </button>
        )}
      </div>
    </Row>
  )

  return (
    <>
      <PageHeader title={S.pages.apiKeys} desc={k.desc} />
      <Section>
        {keyRow('anthropic', k.anthropic, k.anthropicDesc)}
        <Row title={k.useKey} desc={k.useKeyDesc}>
          <Toggle checked={s.useApiKey} disabled={!status.anthropic?.set} onChange={(v) => update({ useApiKey: v })} />
        </Row>
      </Section>
      <Section>
        {keyRow('openai', k.openai, k.notUsedYet)}
        {keyRow('gemini', k.gemini, k.notUsedYet)}
      </Section>
    </>
  )
}

interface ProviderStatus {
  installed: boolean
  path: string | null
  version: string | null
}

function useProvider(id: string): [ProviderStatus | null, () => void] {
  const [st, setSt] = useState<ProviderStatus | null>(null)
  const load = (): void => {
    setSt(null)
    api.system.provider(id).then(setSt)
  }
  useEffect(load, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  return [st, load]
}

function ProviderStatusRows({ st, reload }: { st: ProviderStatus | null; reload: () => void }) {
  const p = S.provider
  if (!st) return <p className="row-desc">{p.checking}</p>
  return (
    <>
      <Row title={p.status}>
        <span className={`status-pill ${st.installed ? 'ok' : 'off'}`}>{st.installed ? p.installed : p.notInstalled}</span>
      </Row>
      {st.path && <Row title={p.path} desc={<span className="mono">{st.path}</span>} />}
      {st.version && <Row title={p.version} desc={<span className="mono">{st.version}</span>} />}
      <button className="btn small" onClick={reload}>
        {p.recheck}
      </button>
    </>
  )
}

function ClaudePage({ s }: { s: Settings }) {
  const p = S.provider
  const [st, reload] = useProvider('claude')
  const [account, setAccount] = useState<{ email?: string; subscriptionType?: string } | null>(null)
  useEffect(() => {
    api.usage.get().then((u: { account: typeof account }) => setAccount(u.account))
  }, [])
  return (
    <>
      <PageHeader title={S.pages.claude} desc={p.connected} />
      <Section>
        <ProviderStatusRows st={st} reload={reload} />
        {account?.email && <Row title={p.account} desc={`${account.email}${account.subscriptionType ? ` · ${account.subscriptionType}` : ''}`} />}
      </Section>
      <Section>
        <Row title={p.claudePath} desc={p.claudePathDesc} stacked>
          <input
            value={s.claudePath}
            placeholder="/Users/나/.local/bin/claude"
            onChange={(e) => update({ claudePath: e.target.value })}
            onBlur={reload}
            style={{ width: '100%' }}
          />
        </Row>
        <Row title={p.model}>
          <select value={s.model} onChange={(e) => update({ model: e.target.value })}>
            {MODELS.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Row>
        <Row title={p.permission}>
          <select value={s.permissionMode} onChange={(e) => update({ permissionMode: e.target.value as Settings['permissionMode'] })}>
            {Object.entries(t.agent.permissionModes).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Row>
      </Section>
    </>
  )
}

function ProviderPage({ id }: { id: string }) {
  const [st, reload] = useProvider(id)
  return (
    <>
      <PageHeader title={S.pages[id]} desc={S.provider.notConnected} />
      <Section>
        <ProviderStatusRows st={st} reload={reload} />
      </Section>
    </>
  )
}

/* ---------------- 확장 ---------------- */

function FeaturesPage({ kind, hasWorkspace, onOpenFeatures }: { kind: 'marketplace' | 'installed'; hasWorkspace: boolean; onOpenFeatures: () => void }) {
  const project = useProject()
  const e = S.extensions
  return (
    <>
      <PageHeader title={S.pages[kind]} desc={kind === 'marketplace' ? e.marketplaceDesc : e.installedDesc} />
      <Section>
        {Object.entries(t.features.items).map(([k, v]) => {
          const on = project?.features[k as keyof typeof project.features]
          return (
            <Row key={k} title={v.title} desc={v.desc}>
              <span className={`status-pill ${kind === 'installed' && hasWorkspace ? (on ? 'ok' : 'off') : 'ok'}`}>
                {kind === 'installed' && hasWorkspace ? (on ? e.onInProject : e.offInProject) : e.builtIn}
              </span>
            </Row>
          )
        })}
        {hasWorkspace && (
          <button className="btn" onClick={onOpenFeatures}>
            {e.openFeatures}
          </button>
        )}
      </Section>
    </>
  )
}

function PluginsPage() {
  const [list, setList] = useState<{ id: string; scope: string; version: string; installedAt: string }[] | null>(null)
  useEffect(() => {
    api.system.plugins().then(setList)
  }, [])
  return (
    <>
      <PageHeader title={S.pages.plugins} desc={S.extensions.pluginsDesc} />
      <Section>
        {list?.length === 0 && <p className="row-desc">{S.extensions.noPlugins}</p>}
        {list?.map((p) => {
          const [name, market] = p.id.split('@')
          return (
            <Row
              key={p.id + p.scope}
              title={name}
              desc={
                <>
                  {market && <span className="mono">@{market}</span>} {p.version && `· v${p.version}`}
                </>
              }
            >
              <span className="status-pill ok">{S.scopes[p.scope] ?? p.scope}</span>
            </Row>
          )
        })}
      </Section>
    </>
  )
}

export function McpList({ filter }: { filter?: (scope: string) => boolean }) {
  const [list, setList] = useState<{ name: string; scope: string; kind: string; target: string }[] | null>(null)
  useEffect(() => {
    api.system.mcp().then(setList)
  }, [])
  const shown = (list ?? []).filter((m) => !filter || filter(m.scope))
  if (list && shown.length === 0) return <p className="row-desc">{S.extensions.noMcp}</p>
  return (
    <>
      {shown.map((m) => (
        <Row key={m.scope + m.name} title={m.name} desc={<span className="mono">{m.target}</span>}>
          <span className="status-pill ok">
            {m.scope} · {m.kind}
          </span>
        </Row>
      ))}
    </>
  )
}

function McpPage() {
  return (
    <>
      <PageHeader title={S.pages.mcp} desc={S.extensions.mcpDesc} />
      <Section>
        <McpList />
      </Section>
    </>
  )
}

function CostPage({ hasWorkspace }: { hasWorkspace: boolean }) {
  const sessions = useAgentStore((s) => s.sessions)
  const e = S.extensions
  const stats = useMemo(() => {
    let total = 0
    let turns = 0
    const tools: Record<string, number> = {}
    const per = sessions
      .map((s) => {
        let cost = 0
        for (const it of s.items) {
          if (it.kind === 'result') {
            cost += it.costUsd
            turns++
          } else if (it.kind === 'tool_use') tools[it.name] = (tools[it.name] ?? 0) + 1
        }
        total += cost
        return { id: s.id, title: s.title, cost }
      })
      .filter((x) => x.cost > 0)
      .sort((x, y) => y.cost - x.cost)
    return { total, turns, per, tools: Object.entries(tools).sort((x, y) => y[1] - x[1]) }
  }, [sessions])

  return (
    <>
      <PageHeader title={S.pages.cost} desc={e.costDesc} />
      {!hasWorkspace || stats.turns === 0 ? (
        <p className="row-desc">{e.noCost}</p>
      ) : (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span>{e.total}</span>
              <b>${stats.total.toFixed(4)}</b>
            </div>
            <div className="stat-tile">
              <span>{e.turns}</span>
              <b>{stats.turns}</b>
            </div>
          </div>
          <Section title={e.sessions}>
            {stats.per.map((p) => (
              <Row key={p.id} title={p.title}>
                <span className="mono">${p.cost.toFixed(4)}</span>
              </Row>
            ))}
          </Section>
          <Section title={e.tools}>
            {stats.tools.map(([name, n]) => (
              <Row key={name} title={toolLabels[name] ?? name} desc={<span className="mono">{name}</span>}>
                <span className="mono">{n}회</span>
              </Row>
            ))}
          </Section>
        </>
      )}
    </>
  )
}
