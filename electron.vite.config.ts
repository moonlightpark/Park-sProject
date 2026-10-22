import { resolve } from 'path'
import { cpSync, createReadStream, existsSync, statSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Excalidraw 글꼴을 CDN 대신 앱 안에서 제공한다.
 * 개발 서버에서는 /excalidraw/ 로 node_modules 를 그대로 보여 주고, 빌드할 때는 out/renderer/excalidraw 로 복사한다.
 */
function excalidrawAssets(): Plugin {
  const src = resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')
  return {
    name: 'excalidraw-assets',
    configureServer(server) {
      server.middlewares.use('/excalidraw/fonts', (req, res, next) => {
        const file = resolve(src, '.' + decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!file.startsWith(src) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', 'font/woff2')
        createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      if (options.dir) cpSync(src, resolve(options.dir, 'excalidraw/fonts'), { recursive: true })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') }
    },
    plugins: [react(), excalidrawAssets()]
  }
})
