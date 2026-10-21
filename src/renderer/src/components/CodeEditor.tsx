import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

// CDN 대신 앱에 포함된 monaco 를 사용한다
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}
loader.config({ monaco })

const LANGS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  sh: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  xml: 'xml',
  md: 'markdown',
  toml: 'ini',
  ini: 'ini'
}

export function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGS[ext] ?? 'plaintext'
}

export function CodeEditor({
  path,
  value,
  onChange,
  theme,
  fontSize
}: {
  path: string
  value: string
  onChange: (v: string) => void
  theme: string
  fontSize: number
}) {
  return (
    <Editor
      path={path}
      value={value}
      language={languageFor(path)}
      theme={theme === 'light' ? 'vs' : 'vs-dark'}
      onChange={(v) => onChange(v ?? '')}
      loading="불러오는 중…"
      options={{
        fontSize: Math.max(11, fontSize - 3),
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        tabSize: 2,
        automaticLayout: true
      }}
    />
  )
}
