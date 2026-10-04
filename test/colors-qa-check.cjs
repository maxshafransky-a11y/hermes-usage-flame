// QA: контраст цветов чисел (остатки 87/54/13/9%) по всем темам.
// Берёт реальные функции прямо из plugin.js — никакого дублирования.
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'plugin.js'), 'utf8')
const start = src.indexOf('// ─── цвет и темы')
const end = src.indexOf('function flameSvg')
if (start < 0 || end < 0) {
  console.log('MARKERS NOT FOUND')
  process.exit(1)
}
const code = 'const LOW_REMAINING = 10;' + src.slice(start, end) + '; return { toneFor, resolvePalette, HUE_HEXES }'
let mod
try {
  mod = new Function(code)()
} catch (e) {
  console.log('EVAL FAIL:', e.message)
  process.exit(1)
}

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(((n >> 16) % 256) / 255) + 0.7152 * f(((n >> 8) % 256) / 255) + 0.0722 * f((n % 256) / 255)
}
const cr = (a, b) => {
  const l1 = lum(a)
  const l2 = lum(b)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return ((hi + 0.05) / (lo + 0.05)).toFixed(1)
}

const keys = ['auto', 'fire', 'neon', 'aurora', 'gold', 'sakura'].concat(mod.HUE_HEXES.map((_, i) => 'hue' + i))
const REQUIRED = ['text', 'label', 'caption', 'section', 'cardBg', 'sep', 'sos', 'sosBg', 'accent', 'accentSoft', 'glowA', 'glowB']
const NUMS = [93, 66, 61, 54, 26, 25, 13, 11, 10, 9, 5]
const hex6 = (s) => (typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s) ? s : null)
// Фактический фон карточки: для светлых тем — белый (градиент от #ffffff);
// для тёмных — последний rgba-слой линейного градиента, смешанный с фоном страницы.
const bgFor = (pal, mode) => {
  if (mode === 'light') return '#ffffff'
  const all = String(pal.cardBg).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/g) || []
  const last = all[all.length - 1]
  if (!last) return null
  const nums = last.match(/[\d.]+/g).map(Number)
  const [r, g, b, a = 1] = nums
  const pg = [15, 15, 18]
  const mixc = (c, p) => Math.round(a * c + (1 - a) * p)
  const to2 = (x) => x.toString(16).padStart(2, '0')
  return '#' + to2(mixc(r, pg[0])) + to2(mixc(g, pg[1])) + to2(mixc(b, pg[2]))
}

let fails = []
console.log('=== Аудит тем usage-flame ===\n')
// Все цветные темы (кур/оттенки) — тёмные по дизайну; «Авто» живёт в обоих режимах.
const runs = []
for (const key of keys) {
  runs.push([key, 'dark'])
  if (key === 'auto') runs.push([key, 'light'])
}
for (const [key, mode] of runs) {
  let pal
  try {
    pal = mod.resolvePalette(key, null, mode)
  } catch (e) {
    fails.push(key + '/' + mode + ': resolvePalette throw ' + e.message)
    continue
  }
  if (key !== 'auto' && !pal.isDark) fails.push(key + '/' + mode + ': цветная тема внезапно не тёмная')
  for (const f of REQUIRED) {
    if (typeof pal[f] !== 'string' || !pal[f]) fails.push(key + '/' + mode + ': пустое поле ' + f)
  }
  const bg = bgFor(pal, mode)
  if (!bg) {
    fails.push(key + '/' + mode + ': не удалось вычислить фон карточки')
    continue
  }
  // Смешивает hex/rgba-цвет с фоном карточки (для rgba-слоёв).
  const blend = (col) => {
    const h = hex6(col)
    if (h) return h
    const m = String(col).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (!m) return null
    const [r, g, b, a = 1] = m.slice(1).map(Number)
    const [br, bgc, bb] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16))
    const mixc = (x, y) => Math.round(a * x + (1 - a) * y)
    const to2 = (x) => x.toString(16).padStart(2, '0')
    return '#' + to2(mixc(r, br)) + to2(mixc(g, bgc)) + to2(mixc(b, bb))
  }
  const check = (name, color, min) => {
    const c = blend(color)
    if (!c) {
      fails.push(key + '/' + mode + ': ' + name + ' неверный цвет (' + color + ')')
      return
    }
    const r = cr(c, bg)
    if (r < min) fails.push(key + '/' + mode + ': ' + name + ' ' + color + ' ~ ' + c + ' контраст ' + r + ' < ' + min)
  }
  check('text', pal.text, 4.5)
  check('label', pal.label, 4.5)
  check('caption', pal.caption, 3.5)
  check('section', pal.section, 3.5)
  check('sos', pal.sos, 2.5)
  const isLight = mode === 'light'
  for (const v of NUMS) {
    const c = blend(mod.toneFor(v, isLight, pal))
    if (!c) {
      fails.push(key + '/' + mode + ': toneFor(' + v + ') неверный цвет')
      continue
    }
    const r = cr(c, bg)
    if (r < 3.0) fails.push(key + '/' + mode + ': число ' + v + '% цвет ' + c + ' контраст ' + r + ' < 3.0')
  }
  // Семья оттенка: все тона чисел — в том же тоне, что акцент (Δhue ≤ 32°).
  const hueOf = (hx) => {
    const [rh, gh, bh] = [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16) / 255)
    const mx = Math.max(rh, gh, bh)
    const mn = Math.min(rh, gh, bh)
    if (mx === mn) return 0
    const d = mx - mn
    let h
    if (mx === rh) h = ((gh - bh) / d + 6) % 6
    else if (mx === gh) h = (bh - rh) / d + 2
    else h = (rh - gh) / d + 4
    h = Math.round(h * 60)
    return h < 0 ? h + 360 : h
  }
  const hueDist = (a, b) => {
    const d = Math.abs(a - b) % 360
    return d > 180 ? 360 - d : d
  }
  {
    const accHex = hex6(pal.accent) || '#ff9d2e'
    const accHue = hueOf(accHex)
    for (const v of [90, 40, 15, 5]) {
      const tc = hex6(mod.toneFor(v, isLight, pal))
      if (!tc) continue
      const dh = hueDist(hueOf(tc), accHue)
      if (dh > 32) fails.push(key + '/' + mode + ': тон ' + v + '% (' + tc + ') вне семьи акцента ' + pal.accent + ' (Δ' + dh + '°)')
    }
    if (mode === 'dark') {
      const l3 = lum(hex6(mod.toneFor(15, isLight, pal)) || accHex)
      const l4 = lum(hex6(mod.toneFor(5, isLight, pal)) || accHex)
      if (l4 + 0.02 < l3) fails.push(key + '/' + mode + ': низкий тон тусклее базового')
    }
  }
}

console.log('Тема/режим  | ', NUMS.map((v) => String(v).padStart(5)).join(' | '))
for (const mode of ['dark', 'light']) {
  for (const key of ['fire', 'neon', 'aurora', 'gold', 'sakura', 'hue0', 'hue4', 'hue9']) {
    const pal = mod.resolvePalette(key, null, mode)
    const bg = bgFor(pal, mode) || '#1a1512'
    const row = NUMS.map((v) => String(cr(mod.toneFor(v, mode === 'light', pal), bg)).padStart(5))
    console.log((key + '/' + mode).padEnd(11) + ' | ' + row.join(' | '))
  }
}

console.log('\nПровалов: ' + fails.length)
for (const f of fails) console.log('  ✗ ' + f)
if (!fails.length) console.log('  ✓ все темы/режимы/категории в норме')
