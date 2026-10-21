import { useCallback, useEffect, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ClickableLinkPlugin } from '@lexical/react/LexicalClickableLinkPlugin'
import { HorizontalRuleNode, INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode, $isHeadingNode, HeadingTagType } from '@lexical/rich-text'
import {
  ListItemNode,
  ListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  $isListNode
} from '@lexical/list'
import { LinkNode, AutoLinkNode, TOGGLE_LINK_COMMAND, $isLinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode, $createCodeNode, $isCodeNode } from '@lexical/code'
import { registerCodeHighlighting } from '@lexical/code-prism'
import { TableNode, TableCellNode, TableRowNode, INSERT_TABLE_COMMAND } from '@lexical/table'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { $setBlocksType } from '@lexical/selection'
import { $getNearestNodeOfType, mergeRegister } from '@lexical/utils'
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  TextFormatType
} from 'lexical'
import { ALL_TRANSFORMERS, isEmptyRoot } from './transformers'
import { Icon, InputDialog } from '../ui'
import { t } from '../../i18n/ko'
import { MermaidPlugin } from './MermaidPlugin'
import { FindBar } from './FindBar'
import { DocPathContext, ImageNode } from './ImageNode'

const theme = {
  paragraph: 'md-p',
  quote: 'md-quote',
  heading: { h1: 'md-h1', h2: 'md-h2', h3: 'md-h3', h4: 'md-h4', h5: 'md-h5', h6: 'md-h6' },
  list: {
    ul: 'md-ul',
    ol: 'md-ol',
    listitem: 'md-li',
    listitemChecked: 'li-check li-checked',
    listitemUnchecked: 'li-check',
    nested: { listitem: 'nested' }
  },
  link: 'md-link',
  text: {
    bold: 'text-bold',
    italic: 'text-italic',
    strikethrough: 'text-strike',
    underline: 'text-underline',
    code: 'text-code'
  },
  code: 'code-block',
  codeHighlight: {
    comment: 'tok-comment',
    prolog: 'tok-comment',
    doctype: 'tok-comment',
    cdata: 'tok-comment',
    punctuation: 'tok-punctuation',
    property: 'tok-number',
    tag: 'tok-keyword',
    boolean: 'tok-boolean',
    number: 'tok-number',
    constant: 'tok-number',
    symbol: 'tok-number',
    selector: 'tok-string',
    'attr-name': 'tok-function',
    string: 'tok-string',
    char: 'tok-string',
    builtin: 'tok-function',
    inserted: 'tok-string',
    operator: 'tok-operator',
    entity: 'tok-operator',
    url: 'tok-string',
    atrule: 'tok-keyword',
    'attr-value': 'tok-string',
    keyword: 'tok-keyword',
    function: 'tok-function',
    'class-name': 'tok-function',
    regex: 'tok-string',
    important: 'tok-keyword',
    variable: 'tok-function'
  },
  table: 'md-table',
  tableCell: 'md-td',
  tableCellHeader: 'md-th',
  hr: 'md-hr'
}

export interface MarkdownEditorProps {
  /** 문서를 다시 불러와야 할 때 바뀌는 키 (파일 경로 + 외부 변경 횟수) */
  docKey: string
  /** 상대 경로 이미지를 찾을 기준이 되는 문서 경로 */
  docPath: string
  initialMarkdown: string
  onChange: (markdown: string) => void
  findOpen: boolean
  onCloseFind: () => void
}

export function MarkdownEditor({ docKey, docPath, initialMarkdown, onChange, findOpen, onCloseFind }: MarkdownEditorProps) {
  const initialConfig = {
    namespace: 'bakpro',
    theme,
    onError: (e: Error) => console.error(e),
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
      AutoLinkNode,
      TableNode,
      TableRowNode,
      TableCellNode,
      HorizontalRuleNode,
      ImageNode
    ],
    editorState: () => $convertFromMarkdownString(initialMarkdown, ALL_TRANSFORMERS)
  }
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <DocPathContext.Provider value={docPath}>
      <LexicalComposer key={docKey} initialConfig={initialConfig}>
        <Toolbar />
        <div className="editor-scroll">
          {findOpen && <FindBar rootSelector=".md-content" onClose={onCloseFind} />}
          <div className="md-editor" ref={containerRef}>
            <RichTextPlugin
              contentEditable={<ContentEditable className="md-content" spellCheck={false} />}
              placeholder={<div className="md-placeholder">{t.editor.placeholder}</div>}
              ErrorBoundary={LexicalErrorBoundary}
            />
            <MermaidPlugin containerRef={containerRef} />
          </div>
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <ClickableLinkPlugin newTab />
        <TablePlugin hasCellMerge={false} />
        <TabIndentationPlugin />
        <HorizontalRulePlugin />
        <MarkdownShortcutPlugin transformers={ALL_TRANSFORMERS} />
        <CodeHighlightPlugin />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(state) =>
            state.read(() => {
              const root = $getRoot()
              onChange(isEmptyRoot(root.getChildren()) ? '' : $convertToMarkdownString(ALL_TRANSFORMERS))
            })
          }
        />
      </LexicalComposer>
    </DocPathContext.Provider>
  )
}

function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => registerCodeHighlighting(editor), [editor])
  return null
}

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'code' | 'bullet' | 'number' | 'check'

function Toolbar() {
  const [editor] = useLexicalComposerContext()
  const [block, setBlock] = useState<BlockType>('paragraph')
  const [formats, setFormats] = useState<Record<string, boolean>>({})
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [linkDialog, setLinkDialog] = useState(false)

  const refresh = useCallback(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel)) return
    setFormats({
      bold: sel.hasFormat('bold'),
      italic: sel.hasFormat('italic'),
      strikethrough: sel.hasFormat('strikethrough'),
      code: sel.hasFormat('code'),
      link: $isLinkNode(sel.anchor.getNode().getParent()) || $isLinkNode(sel.anchor.getNode())
    })
    const anchor = sel.anchor.getNode()
    const top = anchor.getKey() === 'root' ? anchor : anchor.getTopLevelElementOrThrow()
    if ($isListNode(top)) {
      const list = $getNearestNodeOfType(anchor, ListNode)
      setBlock((list ?? top).getListType() as BlockType)
    } else if ($isHeadingNode(top)) setBlock(top.getTag() as BlockType)
    else if ($isCodeNode(top)) setBlock('code')
    else setBlock((top.getType() === 'quote' ? 'quote' : 'paragraph') as BlockType)
  }, [])

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => editorState.read(refresh)),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            refresh()
            return false
          },
          COMMAND_PRIORITY_LOW
        ),
        editor.registerCommand(CAN_UNDO_COMMAND, (v) => (setCanUndo(v), false), COMMAND_PRIORITY_LOW),
        editor.registerCommand(CAN_REDO_COMMAND, (v) => (setCanRedo(v), false), COMMAND_PRIORITY_LOW)
      ),
    [editor, refresh]
  )

  const setBlockType = (type: BlockType): void => {
    if (type === 'bullet') return void editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
    if (type === 'number') return void editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
    if (type === 'check') return void editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
    editor.update(() => {
      const sel = $getSelection()
      if (!$isRangeSelection(sel)) return
      if (type === 'paragraph') $setBlocksType(sel, () => $createParagraphNode())
      else if (type === 'quote') $setBlocksType(sel, () => $createQuoteNode())
      else if (type === 'code') $setBlocksType(sel, () => $createCodeNode())
      else $setBlocksType(sel, () => $createHeadingNode(type as HeadingTagType))
    })
  }

  const fmt = (f: TextFormatType) => () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, f)
  const btn = (icon: string, title: string, onClick: () => void, active = false, disabled = false) => (
    <button className={`icon-btn${active ? ' active' : ''}`} title={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  )

  return (
    <div className="doc-toolbar">
      {btn('undo', t.editor.undo, () => editor.dispatchCommand(UNDO_COMMAND, undefined), false, !canUndo)}
      {btn('redo', t.editor.redo, () => editor.dispatchCommand(REDO_COMMAND, undefined), false, !canRedo)}
      <span className="sep" />
      <select
        value={['bullet', 'number', 'check'].includes(block) ? 'paragraph' : block}
        onChange={(e) => setBlockType(e.target.value as BlockType)}
      >
        <option value="paragraph">{t.editor.paragraph}</option>
        <option value="h1">{t.editor.h1}</option>
        <option value="h2">{t.editor.h2}</option>
        <option value="h3">{t.editor.h3}</option>
        <option value="quote">{t.editor.quote}</option>
        <option value="code">{t.editor.codeBlock}</option>
      </select>
      <span className="sep" />
      {btn('bold', t.editor.bold, fmt('bold'), formats.bold)}
      {btn('italic', t.editor.italic, fmt('italic'), formats.italic)}
      {btn('strike', t.editor.strike, fmt('strikethrough'), formats.strikethrough)}
      {btn('code', t.editor.code, fmt('code'), formats.code)}
      {btn('link', t.editor.link, () => (formats.link ? editor.dispatchCommand(TOGGLE_LINK_COMMAND, null) : setLinkDialog(true)), formats.link)}
      <span className="sep" />
      {btn('ul', t.editor.bullet, () => setBlockType('bullet'), block === 'bullet')}
      {btn('ol', t.editor.numbered, () => setBlockType('number'), block === 'number')}
      {btn('check', t.editor.check, () => setBlockType('check'), block === 'check')}
      {btn('quote', t.editor.quote, () => setBlockType('quote'), block === 'quote')}
      {btn('table', t.editor.table, () => editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '3', columns: '3', includeHeaders: { rows: true, columns: false } }))}
      {btn('hr', t.editor.hr, () => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined))}
      <LinkShortcut onOpen={() => setLinkDialog(true)} />
      {linkDialog && (
        <InputDialog
          title={t.editor.linkPrompt}
          initial="https://"
          onClose={() => setLinkDialog(false)}
          onSubmit={(url) => editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)}
        />
      )}
    </div>
  )
}

/** ⌘K 로 링크 삽입 */
function LinkShortcut({ onOpen }: { onOpen: () => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpen()
      }
    }
    return editor.registerRootListener((root, prev) => {
      prev?.removeEventListener('keydown', onKey)
      root?.addEventListener('keydown', onKey)
    })
  }, [editor, onOpen])
  return null
}
