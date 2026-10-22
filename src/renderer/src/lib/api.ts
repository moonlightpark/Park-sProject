import type { Api } from '../../../preload'

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api

export const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p
export const dirname = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')
export const isWindows = window.api.platform === 'win32'
/** 메인 프로세스가 돌려주는 경로와 같은 구분자(Windows 는 \\)로 이어 붙인다 */
export const sep = isWindows ? '\\' : '/'
export const join = (...parts: string[]): string => parts.join(sep).replace(/[\\/]+/g, sep)
/** p 가 dir 폴더 안에 있는지 (구분자 종류와 상관없이) */
export const isInside = (p: string, dir: string): boolean => p.length > dir.length && p.startsWith(dir) && /[\\/]/.test(p[dir.length])
export const relative = (root: string, p: string): string => (p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, '') : p)
export const isMarkdown = (p: string): boolean => /\.(md|markdown|mdx)$/i.test(p)
