import { ReactNode, useEffect } from 'react'
import { t } from '../../i18n/ko'
import { Icon } from '../ui'

export interface NavItem {
  id: string
  label: string
  icon: string
  badge?: string
}

export interface NavGroup {
  title: string
  hint?: string
  items: NavItem[]
}

/** 애플리케이션 설정과 프로젝트 설정이 함께 쓰는 전체 화면 틀: 왼쪽 분류 메뉴 + 오른쪽 내용 */
export function SettingsShell({
  groups,
  active,
  onSelect,
  onClose,
  children
}: {
  groups: NavGroup[]
  active: string
  onSelect: (id: string) => void
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('.overlay')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-shell">
      <nav className="settings-nav">
        <button className="settings-back" onClick={onClose}>
          ← {t.settingsView.back} <span className="kbd">Esc</span>
        </button>
        {groups.map((g) => (
          <div key={g.title} className="settings-group">
            <div className="settings-group-title" title={g.hint}>
              {g.title}
              {g.hint && <span className="info-dot">ⓘ</span>}
            </div>
            {g.items.map((it) => (
              <button key={it.id} className={`settings-nav-item${active === it.id ? ' active' : ''}`} onClick={() => onSelect(it.id)}>
                <Icon name={it.icon} size={15} />
                <span className="label">{it.label}</span>
                {it.badge && <span className="nav-badge">{it.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main className="settings-content">
        <div className="settings-inner">{children}</div>
      </main>
    </div>
  )
}

export function PageHeader({ title, desc }: { title: string; desc?: ReactNode }) {
  return (
    <header className="settings-page-head">
      <h1>{title}</h1>
      {desc && <p>{desc}</p>}
    </header>
  )
}

export function Section({ title, desc, children }: { title?: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      {title && <h2>{title}</h2>}
      {desc && <p className="section-desc">{desc}</p>}
      {children}
    </section>
  )
}

/** 제목·설명 왼쪽, 조작 오른쪽 한 줄 */
export function Row({ title, desc, children, stacked }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; stacked?: boolean }) {
  return (
    <div className={`settings-row${stacked ? ' stacked' : ''}`}>
      <div className="row-text">
        <div className="row-title">{title}</div>
        {desc && <div className="row-desc">{desc}</div>}
      </div>
      {children && <div className="row-control">{children}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <span className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="knob" />
    </span>
  )
}

export function ComingSoon({ name }: { name: string }) {
  return (
    <>
      <PageHeader title={name} />
      <div className="coming-soon">
        <span className="nav-badge">{t.settingsView.comingSoon}</span>
        <p>{t.settingsView.comingSoonDesc(name)}</p>
      </div>
    </>
  )
}
