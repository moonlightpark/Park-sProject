import { useState } from 'react'
import type { TreeNode } from '../lib/types'
import { api, dirname, join, basename } from '../lib/api'
import { t } from '../i18n/ko'
import { ContextMenu, Icon, InputDialog, MenuEntry, toast } from './ui'

type Dialog = { title: string; initial?: string; submit: (v: string) => void } | null

export function FileTree({
  root,
  nodes,
  activePath,
  onOpen,
  onRenamed,
  onDeleted
}: {
  root: string
  nodes: TreeNode[]
  activePath: string | null
  onOpen: (path: string) => void
  onRenamed: (from: string, to: string) => void
  onDeleted: (path: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }

  const newFile = (dir: string): void =>
    setDialog({
      title: t.files.newFilePrompt,
      initial: '새 문서.md',
      submit: (name) =>
        run(async () => {
          const p = join(dir, name)
          await api.fs.createFile(p, name.endsWith('.md') ? `# ${name.replace(/\.md$/, '')}\n\n` : '')
          setExpanded((e) => ({ ...e, [dir]: true }))
          onOpen(p)
        })
    })

  const newFolder = (dir: string): void =>
    setDialog({
      title: t.files.newFolderPrompt,
      initial: '새 폴더',
      submit: (name) => run(() => api.fs.createDir(join(dir, name)))
    })

  const renameNode = (node: TreeNode): void =>
    setDialog({
      title: t.files.renamePrompt,
      initial: node.name,
      submit: (name) =>
        run(async () => {
          const to = join(dirname(node.path), name)
          await api.fs.rename(node.path, to)
          onRenamed(node.path, to)
        })
    })

  const menuItems = (node: TreeNode | null): (MenuEntry | 'sep')[] => {
    const dir = node ? (node.type === 'dir' ? node.path : dirname(node.path)) : root
    const items: (MenuEntry | 'sep')[] = [
      { label: t.files.newFile, onClick: () => newFile(dir) },
      { label: t.files.newFolder, onClick: () => newFolder(dir) }
    ]
    if (node) {
      items.push(
        'sep',
        { label: t.files.rename, onClick: () => renameNode(node) },
        { label: t.files.reveal, onClick: () => api.fs.reveal(node.path) },
        'sep',
        {
          label: t.files.delete,
          danger: true,
          onClick: () =>
            run(async () => {
              if (await api.fs.delete(node.path)) onDeleted(node.path)
            })
        }
      )
    }
    return items
  }

  const render = (list: TreeNode[], depth: number) =>
    list.map((n) => (
      <div key={n.path}>
        <div
          className={`tree-row${activePath === n.path ? ' active' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (n.type === 'dir' ? setExpanded((e) => ({ ...e, [n.path]: !e[n.path] })) : onOpen(n.path))}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenu({ x: e.clientX, y: e.clientY, node: n })
          }}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/x-path', n.path)}
          onDragOver={(e) => n.type === 'dir' && e.preventDefault()}
          onDrop={(e) => {
            const from = e.dataTransfer.getData('text/x-path')
            if (!from || n.type !== 'dir' || from === n.path || n.path.startsWith(from + '/')) return
            const to = join(n.path, basename(from))
            run(async () => {
              await api.fs.rename(from, to)
              onRenamed(from, to)
            })
          }}
          title={n.path}
        >
          <span className="chev">{n.type === 'dir' ? (expanded[n.path] ? '▾' : '▸') : ''}</span>
          <Icon name={n.type === 'dir' ? 'folder' : /\.(md|markdown)$/i.test(n.name) ? 'md' : 'file'} size={14} />
          <span className="name">{n.name}</span>
        </div>
        {n.type === 'dir' && expanded[n.path] && n.children && render(n.children, depth + 1)}
      </div>
    ))

  return (
    <>
      <div className="sidebar-header">
        <span className="title">{t.files.explorer}</span>
        <button className="icon-btn" title={t.files.newFile} onClick={() => newFile(root)}>
          <Icon name="filePlus" size={15} />
        </button>
        <button className="icon-btn" title={t.files.newFolder} onClick={() => newFolder(root)}>
          <Icon name="folderPlus" size={15} />
        </button>
      </div>
      <div
        className="sidebar-body"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, node: null })
        }}
      >
        {render(nodes, 0)}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.node)} onClose={() => setMenu(null)} />}
      {dialog && <InputDialog title={dialog.title} initial={dialog.initial} onSubmit={dialog.submit} onClose={() => setDialog(null)} />}
    </>
  )
}

/** 메뉴의 "새 파일" 명령에서도 같은 대화상자를 쓰기 위해 내보낸다 */
export function NewFileDialog({ root, onCreated, onClose }: { root: string; onCreated: (p: string) => void; onClose: () => void }) {
  return (
    <InputDialog
      title={t.files.newFilePrompt}
      initial="새 문서.md"
      onClose={onClose}
      onSubmit={async (name) => {
        const p = join(root, name)
        try {
          await api.fs.createFile(p, name.endsWith('.md') ? `# ${name.replace(/\.md$/, '')}\n\n` : '')
          onCreated(p)
        } catch (e) {
          toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
        }
      }}
    />
  )
}
