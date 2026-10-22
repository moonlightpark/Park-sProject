// HWP 편집기(rhwp-studio)를 소스에서 빌드해 resources/rhwp-studio 에 넣는다.
// HOP(https://github.com/golbin/hop) 과 같은 방식: rhwp 엔진·웹 편집기를 그대로 쓰고 앱은 얇게 감싼다.
//
//   node scripts/build-rhwp-studio.mjs        (npm run build:hwp)
//
// - rhwp 저장소를 @rhwp/core 와 같은 버전 태그로 받아 rhwp-studio 만 빌드한다.
//   WASM 엔진은 직접 컴파일하지 않고 @rhwp/core 의 빌드 결과를 쓴다 (Rust 도구 불필요).
// - 외부 웹폰트(CDN)·서비스 워커·예제 파일은 빼서 오프라인으로 동작하게 한다.
// - 앱 쪽 연결 페이지(resources/rhwp-host)와 @rhwp/editor SDK 를 /__host/ 아래에 함께 넣는다.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'resources', 'rhwp-studio')
const core = join(root, 'node_modules', '@rhwp', 'core')
const editor = join(root, 'node_modules', '@rhwp', 'editor')
const version = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')).version
const work = join(tmpdir(), `bakpro-rhwp-${version}`)

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

console.log(`rhwp-studio v${version} 빌드 → ${out}`)
if (!existsSync(join(work, 'rhwp-studio'))) {
  rmSync(work, { recursive: true, force: true })
  run('git', ['clone', '--depth', '1', '--branch', `v${version}`, '--filter=blob:none', '--sparse', 'https://github.com/edwardkim/rhwp.git', work])
  run('git', ['sparse-checkout', 'set', 'rhwp-studio', 'npm', 'rhwp-shared', 'assets/fonts'], { cwd: work })
}

// studio 는 ../pkg 의 wasm-pack 결과를 가져다 쓴다 → 같은 버전의 @rhwp/core 로 채운다
mkdirSync(join(work, 'pkg'), { recursive: true })
for (const f of ['rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm', 'rhwp_bg.wasm.d.ts']) cpSync(join(core, f), join(work, 'pkg', f))

const studio = join(work, 'rhwp-studio')
// 설치 스크립트는 돌리지 않는다 (빌드에 필요 없음)
if (!existsSync(join(studio, 'node_modules'))) run(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: studio, shell: process.platform === 'win32' })
run(npx, ['vite', 'build'], {
  cwd: studio,
  shell: process.platform === 'win32',
  env: { ...process.env, RHWP_DISABLE_EXTERNAL_WEBFONTS: '1', RHWP_WITHOUT_HWPCTRL: '1' }
})

rmSync(out, { recursive: true, force: true })
cpSync(join(studio, 'dist'), out, { recursive: true })
// 오프라인 앱에 필요 없는 것: 예제 문서, PWA 서비스 워커
for (const f of ['samples', 'sw.js', 'registerSW.js', 'manifest.webmanifest']) rmSync(join(out, f), { recursive: true, force: true })
for (const name of readdirSync(out)) if (name.startsWith('workbox-')) rmSync(join(out, name), { force: true })
const index = join(out, 'index.html')
writeFileSync(
  index,
  readFileSync(index, 'utf8')
    .replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/, '')
    .replace(/<link rel="manifest"[^>]*>/, '')
)

// 앱 ↔ 편집기 연결 페이지
const host = join(out, '__host')
cpSync(join(root, 'resources', 'rhwp-host'), host, { recursive: true })
mkdirSync(join(host, 'editor'), { recursive: true })
for (const f of ['index.js', 'transport.js', 'document-agent-contract.js']) cpSync(join(editor, f), join(host, 'editor', f))
writeFileSync(join(out, 'VERSION'), `rhwp ${version}\n`)
console.log('완료')
