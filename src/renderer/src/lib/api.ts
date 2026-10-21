import type { Api } from '../../../preload'

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api

export const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p
export const dirname = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')
export const join = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')
export const relative = (root: string, p: string): string => (p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, '') : p)
export const isMarkdown = (p: string): boolean => /\.(md|markdown|mdx)$/i.test(p)
