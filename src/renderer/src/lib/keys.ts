/** Windows 에서는 macOS 단축키 기호(⌘⌥⇧⌃)를 Ctrl/Alt/Shift 로 바꿔 보여 준다 */
export const isWindowsUi = /Windows/i.test(navigator.userAgent)

const ORDER: [string, string][] = [
  ['Ctrl', '⌘⌃'],
  ['Alt', '⌥'],
  ['Shift', '⇧']
]

export function keys(s: string): string {
  if (!isWindowsUi) return s
  return s
    .replace(/[⌃⌥⇧⌘]+/g, (m) => ORDER.filter(([, syms]) => [...m].some((c) => syms.includes(c))).map(([name]) => name + '+').join(''))
    .replace(/↵/g, 'Enter')
}

/**
 * 문구 묶음 전체(중첩 객체·배열·문구를 돌려주는 함수 포함)를 Windows 에 맞게 고친다.
 * 단축키 기호는 keys 로 바꾸고, macOS 의 Finder 는 파일 탐색기로 부른다.
 */
export function localizePlatform<T>(value: T): T {
  if (!isWindowsUi) return value
  if (typeof value === 'string') return keys(value).replace(/Finder ?/g, '파일 탐색기') as T
  if (typeof value === 'function') return ((...args: unknown[]) => localizePlatform((value as (...a: unknown[]) => unknown)(...args))) as T
  if (Array.isArray(value)) return value.map(localizePlatform) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localizePlatform(v)])) as T
  return value
}
