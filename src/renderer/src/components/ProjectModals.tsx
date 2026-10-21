import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { t } from '../i18n/ko'
import { Modal, toast } from './ui'
import { UsageBar, UsageState } from './Rail'

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

/** 사용자 정보: Claude Code 로그인 계정과 사용률 */
export function UserInfoModal({ onClose }: { onClose: () => void }) {
  const [usage, setUsage] = useState<UsageState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    api.usage.get().then(setUsage)
    return api.usage.onUpdated(setUsage)
  }, [])
  const a = usage?.account

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      setUsage(await api.usage.refresh())
    } catch (e) {
      toast(errMsg(e))
    } finally {
      setRefreshing(false)
    }
  }

  const row = (label: string, value?: string) =>
    value ? (
      <div className="info-row">
        <span>{label}</span>
        <b>{value}</b>
      </div>
    ) : null

  return (
    <Modal
      title={t.userInfo.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={refreshing} onClick={refresh}>
            {refreshing ? t.usage.refreshing : t.userInfo.refresh}
          </button>
          <button className="btn primary" onClick={onClose}>
            {t.common.close}
          </button>
        </>
      }
    >
      <div className="modal-body">
        {a ? (
          <div className="account big">
            <div className="avatar">{(a.email ?? '?').slice(0, 1).toUpperCase()}</div>
            <div>
              <b>{a.email ?? '—'}</b>
              {a.subscriptionType && <div className="usage-sub">{a.subscriptionType}</div>}
            </div>
          </div>
        ) : (
          <div className="usage-sub">{t.account.unknown}</div>
        )}
        {a && (
          <div className="info-table">
            {row(t.userInfo.email, a.email)}
            {row(t.userInfo.organization, a.organization)}
            {row(t.userInfo.plan, a.subscriptionType)}
            {row(t.userInfo.provider, a.apiProvider ? (t.account.providers[a.apiProvider] ?? a.apiProvider) : undefined)}
          </div>
        )}
        <div className="section-title">{t.userInfo.usage}</div>
        {usage?.claude ? (
          <>
            <UsageBar title={t.usage.fiveHour} w={usage.claude.fiveHour} />
            <UsageBar title={t.usage.sevenDay} w={usage.claude.sevenDay} />
          </>
        ) : (
          <div className="usage-sub">{t.usage.none}</div>
        )}
        <span className="usage-sub">{t.userInfo.note}</span>
      </div>
    </Modal>
  )
}

