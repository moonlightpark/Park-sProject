import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../lib/api'
import { t } from '../i18n/ko'
import { Icon } from './ui'

interface TermTab {
  id: string
  title: string
}

let seq = 0

const themes: Record<string, Record<string, string>> = {
  light: { background: '#ffffff', foreground: '#1d1f24', cursor: '#5b5bd6', selectionBackground: '#d8d8f6' },
  dark: { background: '#1d1c1a', foreground: '#ecebe8', cursor: '#d98e5a', selectionBackground: '#4a3a2e' },
  crystal: { background: '#0f1218', foreground: '#e6ecf5', cursor: '#6ea8fe', selectionBackground: '#24365a' }
}

export function TerminalPanel({ theme, onClose }: { theme: string; onClose: () => void }) {
  const [tabs, setTabs] = useState<TermTab[]>(() => [{ id: `t${++seq}`, title: `${t.terminal.title} 1` }])
  const [active, setActive] = useState(tabs[0].id)

  const addTab = (): void => {
    const id = `t${++seq}`
    setTabs((ts) => [...ts, { id, title: `${t.terminal.title} ${ts.length + 1}` }])
    setActive(id)
  }
  const closeTab = (id: string): void => {
    api.terminal.kill(id)
    setTabs((ts) => {
      const next = ts.filter((x) => x.id !== id)
      if (!next.length) onClose()
      else if (active === id) setActive(next[next.length - 1].id)
      return next
    })
  }

  return (
    <div className="terminal-panel">
      <div className="panel-head">
        <Icon name="terminal" size={14} />
        {tabs.map((tab) => (
          <span key={tab.id} className={`term-tab${tab.id === active ? ' active' : ''}`} onClick={() => setActive(tab.id)}>
            {tab.title}
            <button className="icon-btn" style={{ width: 16, height: 16, marginLeft: 4 }} onClick={(e) => (e.stopPropagation(), closeTab(tab.id))}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        <button className="icon-btn" title={t.terminal.new} onClick={addTab}>
          <Icon name="plus" size={14} />
        </button>
        <span className="grow" />
        <button className="icon-btn" title={t.terminal.close} onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {tabs.map((tab) => (
        <TermView key={tab.id} id={tab.id} visible={tab.id === active} theme={theme} />
      ))}
    </div>
  )
}

function TermView({ id, visible, theme }: { id: string; visible: boolean; theme: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'SF Mono', Menlo, 'D2Coding', monospace",
      fontSize: 12.5,
      cursorBlink: true,
      theme: themes[theme] ?? themes.light,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    termRef.current = term
    fitRef.current = fit
    const offData = api.terminal.onData((tid, data) => tid === id && term.write(data))
    const offExit = api.terminal.onExit((tid) => tid === id && term.write(`\r\n${t.terminal.exited}\r\n`))
    term.onData((d) => api.terminal.write(id, d))
    term.onResize(({ cols, rows }) => api.terminal.resize(id, cols, rows))
    api.terminal.create(id).then(() => {
      fit.fit()
      api.terminal.resize(id, term.cols, term.rows)
    })
    const ro = new ResizeObserver(() => {
      if (hostRef.current?.offsetParent) fit.fit()
    })
    ro.observe(hostRef.current!)
    return () => {
      ro.disconnect()
      offData()
      offExit()
      term.dispose()
    }
  }, [id])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = themes[theme] ?? themes.light
  }, [theme])

  useEffect(() => {
    if (visible) {
      fitRef.current?.fit()
      termRef.current?.focus()
    }
  }, [visible])

  return <div ref={hostRef} className="terminal-host" style={{ display: visible ? 'block' : 'none' }} />
}
