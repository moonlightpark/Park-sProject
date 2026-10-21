import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  ElementTransformer,
  TRANSFORMERS,
  Transformer
} from '@lexical/markdown'
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode
} from '@lexical/table'
import { HorizontalRuleNode, $isHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { $applyNodeReplacement, $isParagraphNode, $isTextNode, LexicalNode } from 'lexical'
import { IMAGE, HTML_IMAGE } from './ImageNode'

export const HR: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const line = $applyNodeReplacement(new HorizontalRuleNode())
    if (isImport || parentNode.getNextSibling() != null) parentNode.replace(line)
    else parentNode.insertBefore(line)
    line.selectNext()
  },
  type: 'element'
}

const TABLE_ROW = /^(?:\|)(.+)(?:\|)\s?$/
const TABLE_DIVIDER = /^(\| ?:?-*:? ?)+\|\s?$/

const splitCells = (line: string): string[] =>
  line
    .replace(/^\||\|\s?$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim())

/** GitHub 스타일 표. Lexical 플레이그라운드의 방식처럼 줄 단위로 읽어 직전 표에 행을 덧붙인다. */
export const TABLE: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node) => {
    if (!$isTableNode(node)) return null
    const lines: string[] = []
    node.getChildren().forEach((row, i) => {
      if (!$isTableRowNode(row)) return
      const cells = row
        .getChildren()
        .filter($isTableCellNode)
        .map((cell) => $convertToMarkdownString(ALL_TRANSFORMERS, cell).replace(/\n/g, ' ').replace(/\|/g, '\\|'))
      lines.push(`| ${cells.join(' | ')} |`)
      if (i === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
    })
    return lines.join('\n')
  },
  regExp: TABLE_ROW,
  replace: (parentNode, _children, match) => {
    if (TABLE_DIVIDER.test(match[0])) {
      // 구분선은 바로 위 행을 머리글로 표시하고 사라진다
      const table = parentNode.getPreviousSibling()
      if ($isTableNode(table)) {
        const first = table.getFirstChild()
        if ($isTableRowNode(first)) {
          first.getChildren().forEach((c) => $isTableCellNode(c) && c.setHeaderStyles(TableCellHeaderStates.ROW))
        }
      }
      parentNode.remove()
      return
    }
    const texts = splitCells(match[0])
    const row = $createTableRowNode()
    for (const text of texts) {
      const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
      $convertFromMarkdownString(text, ALL_TRANSFORMERS, cell)
      row.append(cell)
    }
    const prev = parentNode.getPreviousSibling()
    if ($isTableNode(prev)) {
      const width = (prev.getFirstChild() as TableRowNode | null)?.getChildrenSize() ?? texts.length
      while (row.getChildrenSize() < width) row.append($createTableCellNode(TableCellHeaderStates.NO_STATUS))
      prev.append(row)
      parentNode.remove()
      return
    }
    const table = $createTableNode()
    table.append(row)
    parentNode.replace(table)
  },
  type: 'element'
}

// 이미지는 링크보다 먼저 와야 '![..](..)' 의 '[..](..)' 부분이 링크로 잡히지 않는다
export const ALL_TRANSFORMERS: Transformer[] = [TABLE, HR, CHECK_LIST, IMAGE, HTML_IMAGE, ...TRANSFORMERS]

/** 빈 단락만 있는 문서는 빈 문자열로 저장한다 */
export function isEmptyRoot(children: LexicalNode[]): boolean {
  return (
    children.length === 0 ||
    (children.length === 1 &&
      $isParagraphNode(children[0]) &&
      children[0].getChildren().every((c) => $isTextNode(c) && c.getTextContent().trim() === ''))
  )
}
