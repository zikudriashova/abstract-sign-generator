// Вшивает JS и CSS из dist-single в один html, который открывается двойным кликом (file://).
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'dist-single'
let html = readFileSync(join(dir, 'index.html'), 'utf8')
const read = (src) => readFileSync(join(dir, src.replace(/^\.?\//, '')), 'utf8')

// CSS
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => `<style>${read(href)}</style>`)
// JS: один модульный скрипт; "</script" внутри кода экранируем
const scripts = []
html = html.replace(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
  scripts.push(read(src).replace(/<\/script/gi, '<\\/script'))
  return ''
})
if (scripts.length !== 1) throw new Error(`ожидался один модульный скрипт, найдено ${scripts.length}`)
// скрипт кладём в конец body: DOM к тому моменту уже готов
html = html.replace('</body>', () => `<script type="module">${scripts[0]}</script></body>`)
if (/(src|href)="\.?\/?assets\//.test(html)) throw new Error('в html остались внешние ресурсы')
mkdirSync('release', { recursive: true })
writeFileSync('release/abstract-sign-generator-v2.html', html)
console.log('release/abstract-sign-generator-v2.html', (html.length / 1048576).toFixed(2), 'MB; assets in dist-single:', readdirSync(join(dir, 'assets')).join(', '))
