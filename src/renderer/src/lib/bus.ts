/** 메뉴·단축키 명령을 현재 모드 화면에 전달하는 간단한 이벤트 버스 */
type Handler = (command: string, arg?: unknown) => void

const handlers = new Set<Handler>()

export const bus = {
  emit(command: string, arg?: unknown): void {
    handlers.forEach((h) => h(command, arg))
  },
  on(h: Handler): () => void {
    handlers.add(h)
    return () => handlers.delete(h)
  }
}
