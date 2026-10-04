/**
 * Usage Flame — закреплённый чип лимитов подписок для Hermes Desktop.
 *
 * Чип: маленький светящийся элемент в строке статуса (низ) и/или в
 * заголовке (верх) — переключатели в панели. Показывает остаток по окнам
 * лимитов провайдера, выбранного в композере (модель-пикер), либо
 * закреплённого вручную. Клик — огненная панель: подробности по окнам и
 * числа по всем провайдерам, у которых есть данные.
 *
 * Данные: gateway RPC `cli.exec` → `hermes usage --json [--provider X]`
 * (тот же источник, что у `/usage`); список авторизованных провайдеров —
 * `model.options`. Набор окон рендерится КАК ЕСТЬ (никаких допущений про
 * 5ч/нед/мес: у разных планов набор разный).
 *
 * Диск-плагин: импортируемы только @hermes/plugin-sdk, react и
 * react/jsx-runtime; JSX не компилируется — UI собирается jsx()-вызовами.
 */

import {
  Button,
  cn,
  haptic,
  host,
  icons,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tip,
  PALETTE_AREA,
  STATUSBAR_AREAS,
  TITLEBAR_AREAS,
  atom,
  useI18n,
  usePluginI18n,
  useQuery,
  useQueryClient,
  useTheme,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'usage-flame'
const STYLE_ID = 'usage-flame-style'
const PROVIDER_KEY = 'hermes.desktop.composer.provider'
const MODEL_KEY = 'hermes.desktop.composer.model'

const LOW_REMAINING = 10
const CURRENT_REFETCH_MS = 60_000
const SWEEP_REFETCH_MS = 15 * 60_000
const SWEEP_STALE_MS = 5 * 60_000
const CACHE_TTL_MS = 10 * 60_000
// Опрос «всех провайдеров» переиспользует результат этой свежести (CLI не спавнится зря).
const SWEEP_TTL_MS = 10 * 60_000
// История замеров и прогноз расхода.
const HIST_MAX = 200
const HIST_MAX_AGE_MS = 48 * 3600e3
const HIST_MIN_STEP_MS = 4 * 60_000
const FORECAST_MIN_SPAN_H = 0.33
const HIST_MAX_STEP_MS = 15 * 60_000
const SWEEP_DELAY_MS = 6_000
const KNOWN_USAGE_PROVIDERS = ['openai-codex', 'anthropic', 'openrouter', 'opencode-go']

const FLAME_PATH =
  'M12 2s.7 2.9-1.5 5.3C8.3 9.6 6.4 11.4 6.4 14a5.6 5.6 0 0 0 11.2 0c0-1.9-.8-3.6-2-5-.4 1-1.2 1.8-2.4 2.2C13.9 8.1 12 5.2 12 2z'

const STYLE_CSS = `
@keyframes uf-flick { 0%, 100% { transform: scaleY(1) rotate(-1deg); } 50% { transform: scaleY(1.1) rotate(1.8deg); } }
@keyframes uf-sos {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 90, 20, 0); background-color: rgba(255, 90, 20, 0); }
  50% { box-shadow: 0 0 12px 2px var(--uf-sos, rgba(255, 90, 20, .6)); background-color: var(--uf-sos-bg, rgba(255, 90, 20, .14)); }
}
@keyframes uf-burn {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 90, 20, 0); }
  50% { box-shadow: 0 0 12px 2px var(--uf-sos, rgba(255, 90, 20, .6)); }
}
@keyframes uf-bright {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.5) saturate(1.35); }
}
@keyframes uf-shine { from { background-position: 130% 0; } to { background-position: -130% 0; } }
@keyframes uf-spin { to { transform: rotate(360deg); } }
@keyframes uf-panel-glow {
  0%, 100% { box-shadow: 0 12px 32px rgba(0,0,0,.5), 0 0 24px var(--uf-glow-a, rgba(255,116,24,.30)); }
  50% { box-shadow: 0 12px 32px rgba(0,0,0,.5), 0 0 34px var(--uf-glow-b, rgba(255,116,24,.45)); }
}
@keyframes uf-throb {
  0%, 100% { text-shadow: 0 0 9px var(--uf-sos, rgba(255, 90, 20, .6)); }
  50% { text-shadow: 0 0 16px var(--uf-sos, rgba(255, 90, 20, .6)), 0 0 30px var(--uf-sos, rgba(255, 90, 20, .6)); }
}
.uf-throb { animation: uf-throb 1.7s ease-in-out infinite; }
.uf-flame { animation: uf-flick 1.9s ease-in-out infinite; transform-origin: 50% 90%; }
.uf-sos { animation: uf-sos 1.7s ease-in-out infinite; border-radius: 7px; }
.uf-burn { border-radius: 999px; animation: uf-burn 1.7s ease-in-out infinite; }
.uf-burn > i { animation: uf-bright 1.7s ease-in-out infinite; }
.uf-spin { animation: uf-spin 1s linear infinite; }
.uf-card { animation: uf-panel-glow 4.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .uf-card, .uf-flame, .uf-sos, .uf-burn, .uf-burn > i, .uf-throb { animation: none; }
}
.uf-bar-fill { position: relative; overflow: hidden; }
.uf-bar-fill::after {
  content: ""; position: absolute; inset: 0; border-radius: 999px;
  background: linear-gradient(110deg, transparent 25%, rgba(255,255,255,.4) 50%, transparent 75%);
  background-size: 220% 100%; animation: uf-shine 2.6s linear infinite;
}
`

// ─── i18n ────────────────────────────────────────────────────────────────────

const MESSAGES = {
  en: {
    title: 'LIMITS',
    allProviders: 'ALL PROVIDERS',
    noData: 'no data',
    expand: 'expand',
    errTitle: 'Could not fetch data',
    errHint: 'Check your network or VPN, then press “Refresh now”.',
    collapse: 'collapse',
    followSelected: 'Follow the selected provider',
    pinned: 'pinned',
    settingsTitle: 'SHOW IN',
    slotBottom: 'status bar',
    slotTop: 'title bar',
    notifications: 'alerts',
    refresh: 'Refresh now',
    updated: (at) => `updated ${at}`,
    autoNote: (m) => `auto ${m}m`,
    loading: 'loading…',
    leftSuffix: '% left',
    usedLine: (n) => `${n}% used`,
    resetLine: (abs, rel) => `resets ${abs} · in ${rel}`,
    resetLineNow: (abs) => `resets ${abs} · right now`,
    burnSafe: (b) => `pace ${b}%/h · enough until reset`,
    burnRisk: (b, tm) => `pace ${b}%/h · runs out ~${tm}`,
    burnIdle: 'pace ~0%/h · no change yet',
    tomorrow: 'tomorrow',
    now: 'now',
    lessMin: '<1m',
    noProvider: 'no provider selected',
    notify: { title: 'Usage Flame', body: (p, w, n) => `${p} — ${w}: ${n}% left` },
    keepOne: 'At least one chip stays visible',
    palette: { refresh: 'Usage Flame: refresh limits now', show: 'Usage Flame: show the limits chip' },
    theme: {
      title: 'THEME', auto: 'Follow Hermes', fire: 'Fire', neon: 'Neon', aurora: 'Aurora',
      gold: 'Gold', sakura: 'Sakura', hue: 'Color', next: 'Usage Flame: next theme'
    },
    hueNames: ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'magenta', 'pink'],
    refreshRow: { title: 'REFRESH', min: (m) => `${m} min` },
    fontRow: { title: 'FONT', sys: 'System', book: 'Book', tech: 'Tech', wide: 'Wide' },
    sizeRow: { title: 'SIZE', m: 'Normal', l: 'Large', xl: 'X-Large' },
    win: {
      rolling: '5h', session: '5h', weekly: 'wk', monthly: 'mo',
      opusWeek: 'wk·Opus', sonnetWeek: 'wk·Sonnet'
    },
    winFull: {
      rolling: '5-hour window', session: 'Session', weekly: 'Weekly', monthly: 'Monthly',
      opusWeek: 'Weekly — Opus', sonnetWeek: 'Weekly — Sonnet'
    }
  },
  ru: {
    title: 'ЛИМИТЫ',
    allProviders: 'ВСЕ ПРОВАЙДЕРЫ',
    noData: 'нет данных',
    expand: 'развернуть',
    collapse: 'свернуть',
    followSelected: 'Следовать за выбранным',
    pinned: 'закреплён',
    settingsTitle: 'ПОКАЗЫВАТЬ В',
    slotBottom: 'строка статуса',
    slotTop: 'заголовок',
    notifications: 'уведомления',
    refresh: 'Обновить сейчас',
    updated: (at) => `обновлено ${at}`,
    autoNote: (m) => `авто ${m} мин`,
    loading: 'загрузка…',
    leftSuffix: '% осталось',
    usedLine: (n) => `израсходовано ${n}%`,
    resetLine: (abs, rel) => `сброс ${abs} · через ${rel}`,
    resetLineNow: (abs) => `сброс ${abs} · сейчас`,
    burnSafe: (b) => `темп ${b}%/ч · до сброса хватит`,
    burnRisk: (b, tm) => `темп ${b}%/ч · исчерпание ~${tm}`,
    burnIdle: 'темп ~0%/ч · без изменений',
    errTitle: 'Не удалось получить данные',
    errHint: 'Проверьте сеть или VPN и нажмите «Обновить сейчас».',
    tomorrow: 'завтра',
    now: 'сейчас',
    lessMin: '<1м',
    noProvider: 'провайдер не выбран',
    notify: { title: 'Usage Flame', body: (p, w, n) => `${p} — ${w}: осталось ${n}%` },
    keepOne: 'Хотя бы один чип остаётся видимым',
    palette: { refresh: 'Usage Flame: обновить лимиты сейчас', show: 'Usage Flame: показать чип лимитов' },
    theme: {
      title: 'ТЕМА', auto: 'Как в Hermes', fire: 'Огонь', neon: 'Неон', aurora: 'Аврора',
      gold: 'Золото', sakura: 'Сакура', hue: 'Цвет', next: 'Usage Flame: следующая тема'
    },
    hueNames: ['красный', 'оранжевый', 'жёлтый', 'лайм', 'зелёный', 'бирюза', 'циан', 'голубой', 'синий', 'фиолетовый', 'маджента', 'розовый'],
    refreshRow: { title: 'ОБНОВЛЯТЬ', min: (m) => `${m} мин` },
    fontRow: { title: 'ШРИФТ', sys: 'Системный', book: 'Книжный', tech: 'Техно', wide: 'Широкий' },
    sizeRow: { title: 'РАЗМЕР', m: 'Обычный', l: 'Крупный', xl: 'Очень крупный' },
    win: {
      rolling: '5ч', session: '5ч', weekly: 'нед', monthly: 'мес',
      opusWeek: 'нед·Opus', sonnetWeek: 'нед·Sonnet'
    },
    winFull: {
      rolling: '5 часов', session: 'Сессия', weekly: 'Неделя', monthly: 'Месяц',
      opusWeek: 'Неделя · Opus', sonnetWeek: 'Неделя · Sonnet'
    }
  }
}

const KNOWN_LABEL_KEYS = {
  'Rolling window': 'rolling',
  Session: 'session',
  'Current session': 'session',
  Weekly: 'weekly',
  'Current week': 'weekly',
  Monthly: 'monthly',
  'Opus week': 'opusWeek',
  'Sonnet week': 'sonnetWeek'
}

const KNOWN_PROVIDER_NAMES = {
  'opencode-go': 'OpenCode Go',
  'opencode-zen': 'OpenCode Zen',
  opencode: 'OpenCode',
  openrouter: 'OpenRouter',
  'openai-codex': 'OpenAI Codex',
  anthropic: 'Anthropic',
  nous: 'Nous'
}

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const RU_DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── helpers ─────────────────────────────────────────────────────────────────

// Runtime-объект создаётся в register(); компоненты читают его отсюда.
let RT = null

const clampPct = (v) => Math.max(0, Math.min(100, Number(v) || 0))
const roundPct = (v) => (v >= 99.5 ? 100 : Math.max(0, Math.round(v)))
const pad2 = (n) => String(n).padStart(2, '0')

function isRu() {
  return String((RT && RT.locale) || '').toLowerCase().startsWith('ru')
}

function fmtRel(ms) {
  const t = RT.i18n.t
  if (!isFinite(ms)) return ''
  if (ms <= 0) return t('now')
  const s = Math.floor(ms / 1000)
  if (s < 60) return t('lessMin')
  const m = Math.floor(s / 60)
  if (m < 60) return m + (isRu() ? 'м' : 'm')
  const h = Math.floor(m / 60)
  if (h < 24) return h + (isRu() ? 'ч ' : 'h ') + (m % 60) + (isRu() ? 'м' : 'm')
  const d = Math.floor(h / 24)
  return d + (isRu() ? 'д ' : 'd ') + (h % 24) + (isRu() ? 'ч' : 'h')
}

function fmtAbs(date) {
  const t = RT.i18n.t
  const now = new Date()
  const hhmm = pad2(date.getHours()) + ':' + pad2(date.getMinutes())
  const dayNum = (d) => d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()
  const dd = dayNum(date) - dayNum(now)
  if (dd === 0) return hhmm
  if (dd === 1) return t('tomorrow') + ' ' + hhmm
  const diffDays = Math.floor((date.getTime() - now.getTime()) / 86400e3)
  const days = isRu() ? RU_DAYS : EN_DAYS
  const months = isRu() ? RU_MONTHS : EN_MONTHS
  if (diffDays >= 0 && diffDays < 6) return days[date.getDay()] + ' ' + hhmm
  return date.getDate() + ' ' + months[date.getMonth()] + ' ' + hhmm
}

function resetLine(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const ms = d.getTime() - Date.now()
  // «через сейчас» — неграмотно: близкий сброс показываем отдельной строкой.
  if (ms <= 90_000) return RT.i18n.t('resetLineNow', fmtAbs(d))
  return RT.i18n.t('resetLine', fmtAbs(d), fmtRel(ms))
}

// ─── цвет и темы ─────────────────────────────────────────────────────────────

const safeHex = (v, fb) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '')) ? String(v) : fb)
const hexToRgb = (hex) => {
  const h = safeHex(hex, '#808080').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const mixHex = (a, b, t) => {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t))
}
const inkOn = (hex) => {
  const [r, g, b] = hexToRgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62 ? '#161616' : '#ffffff'
}
const alpha = (hex, a) => 'rgba(' + hexToRgb(hex).join(',') + ',' + a + ')'

// Контраст (WCAG) — для адаптивной коррекции тонов чисел.
const relLum = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const f = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrastRatio = (a, b) => {
  const l1 = relLum(a)
  const l2 = relLum(b)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}
const lift = (color, bg, min) => {
  let c = color
  for (let i = 0; i < 14 && contrastRatio(c, bg) < min; i++) c = mixHex(c, '#ffffff', 0.09)
  return c
}
const sink = (color, bg, min) => {
  let c = color
  for (let i = 0; i < 14 && contrastRatio(c, bg) < min; i++) c = mixHex(c, '#000000', 0.09)
  return c
}
const TONE_BG_DARK = '#1a1512'
const TONE_BG_LIGHT = '#ffffff'

// 12 равномерных оттенков (те же 68%/58%, что у свотчей приложения).
const HUE_HEXES = ['#dd4b4b', '#dd944b', '#dddd4b', '#94dd4b', '#4bdd4b', '#4bdd94', '#4bdddd', '#4b94dd', '#4b4bdd', '#944bdd', '#dd4bdd', '#dd4b94']
const THEME_CYCLE = ['auto', 'fire', 'neon', 'aurora', 'gold', 'sakura']

// Курированные «вау»-темы: тёмная карточка + характерные акценты.
const CURATED_THEMES = {
  neon: { a1: '#37f0ff', a2: '#ff3ce0', from: '#0b0714', to: '#140a20' },
  aurora: { a1: '#57e6c0', a2: '#8a7bff', from: '#060f16', to: '#0b1620' },
  gold: { a1: '#ffb347', a2: '#ffd166', from: '#14100a', to: '#0f0b07' },
  sakura: { a1: '#ff9ecb', a2: '#ffd7e8', from: '#170d13', to: '#120a0f' }
}

// Шрифты карточки (локальные стеки — без веб-загрузок) и масштаб размера.
const FONTS = {
  sys: '',
  book: 'Cambria, Constantia, "Palatino Linotype", "Book Antiqua", Georgia, serif',
  tech: '"Cascadia Mono", Consolas, "Courier New", monospace',
  wide: 'Verdana, Tahoma, sans-serif'
}
const FS_ZOOM = { m: 1, l: 1.1, xl: 1.22 }

function darkPalette(accent, accent2, from, to) {
  const acc = accent
  const strong2 = accent2 || mixHex(accent, '#ffffff', 0.35)
  const sosC = mixHex(acc, '#ff2020', relLum(acc) < 0.15 ? 0.65 : 0.32)
  return {
    isDark: true,
    cardBg:
      'radial-gradient(130% 90% at 88% -12%, ' + alpha(acc, 0.16) + ', transparent 55%), linear-gradient(165deg, ' + from + ', ' + to + ')',
    cardBorder: alpha(acc, 0.42),
    glowA: alpha(acc, 0.3),
    glowB: alpha(acc, 0.45),
    text: '#f6efe9',
    label: '#ffffff',
    caption: 'rgba(255,255,255,.92)',
    muted: alpha('#f6efe9', 0.62),
    subtle: alpha('#f6efe9', 0.5),
    section: mixHex(acc, '#ffffff', 0.55),
    sep: alpha(acc, 0.18),
    accent: acc,
    accent2: strong2,
    accentSoft: alpha(acc, 0.13),
    barGrad: 'linear-gradient(90deg, ' + mixHex(acc, '#000000', 0.25) + ', ' + acc + ' 55%, ' + strong2 + ')',
    barTrack: 'rgba(255,255,255,.10)',
    flame: [mixHex(acc, '#000000', 0.1), acc, strong2],
    sos: alpha(sosC, 0.85),
    sosBg: alpha(sosC, 0.16),
    picker: acc,
    pillText: inkOn(acc)
  }
}

function firePalette() {
  return {
    isDark: true,
    cardBg:
      'radial-gradient(130% 90% at 88% -12%, rgba(255,140,40,.18), transparent 55%), linear-gradient(165deg, rgba(30,14,6,.97), rgba(17,10,9,.95))',
    cardBorder: 'rgba(255,146,64,.42)',
    glowA: 'rgba(255,116,24,.30)',
    glowB: 'rgba(255,116,24,.45)',
    text: '#ffe7d2',
    label: '#fff6ec',
    caption: 'rgba(255,246,236,.92)',
    muted: 'rgba(255,214,170,.62)',
    subtle: 'rgba(255,214,170,.5)',
    section: 'rgba(255,207,154,.85)',
    sep: 'rgba(255,146,64,.16)',
    accent: '#ff9d2e',
    accent2: '#ffd75e',
    accentSoft: 'rgba(255,120,30,.14)',
    barGrad: 'linear-gradient(90deg, #ff5200, #ff9d2e 55%, #ffd75e)',
    barTrack: 'rgba(255,255,255,.09)',
    flame: ['#ff4d00', '#ff9d2e', '#ffd75e'],
    sos: 'rgba(255,90,20,.85)',
    sosBg: 'rgba(255,90,20,.15)',
    picker: '#ff8c28',
    pillText: '#2a1206'
  }
}

function autoPalette(theme, mode) {
  const c = (theme && theme.colors) || {}
  const dark = mode === 'dark'
  const accent = safeHex(c.midground || c.ring || c.primary, '#7c6cff')
  const card = safeHex(c.card, dark ? '#15151a' : '#ffffff')
  const bg = safeHex(c.background, dark ? '#101014' : '#fafafa')
  const text = safeHex(c.cardForeground || c.foreground, dark ? '#e8e8ea' : '#161616')
  const mutedFg = safeHex(c.mutedForeground, dark ? '#9a9aa2' : '#6b6b70')
  return {
    isDark: dark,
    cardBg:
      'radial-gradient(130% 90% at 88% -12%, ' +
      alpha(accent, dark ? 0.14 : 0.1) +
      ', transparent 55%), linear-gradient(165deg, ' +
      card +
      ', ' +
      bg +
      ')',
    cardBorder: safeHex(c.border, dark ? '#2a2a32' : '#e3e3e8'),
    glowA: alpha(accent, 0.18),
    glowB: alpha(accent, 0.26),
    text,
    label: text,
    caption: mutedFg,
    muted: mutedFg,
    subtle: mutedFg,
    section: mutedFg,
    sep: safeHex(c.border, dark ? '#2a2a32' : '#e3e3e8'),
    accent,
    accent2: mixHex(accent, '#ffffff', 0.35),
    accentSoft: alpha(accent, 0.12),
    barGrad:
      'linear-gradient(90deg, ' + mixHex(accent, '#000000', 0.2) + ', ' + accent + ' 55%, ' + mixHex(accent, '#ffffff', 0.35) + ')',
    barTrack: dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.08)',
    flame: [mixHex(accent, '#000000', 0.15), accent, mixHex(accent, '#ffffff', 0.4)],
    sos: mixHex(accent, '#ff2020', 0.25),
    sosBg: alpha(mixHex(accent, '#ff2020', 0.25), 0.16),
    picker: accent,
    pillText: inkOn(accent)
  }
}

function resolvePalette(themeKey, hermesTheme, mode) {
  const key = String(themeKey || 'fire')
  if (key === 'auto') return autoPalette(hermesTheme, mode)
  if (key.indexOf('hue') === 0) {
    const i = Math.max(0, Math.min(11, parseInt(key.slice(3), 10) || 0))
    const a = HUE_HEXES[i]
    return darkPalette(a, undefined, mixHex('#17131a', a, 0.1), mixHex('#100c12', a, 0.05))
  }
  const cur = CURATED_THEMES[key]
  if (cur) return darkPalette(cur.a1, cur.a2, cur.from, cur.to)
  return firePalette()
}

function themeLabel(key, t) {
  const k = String(key || 'fire')
  if (k === 'auto') return t('theme.auto')
  if (k === 'fire') return t('theme.fire')
  const cur = CURATED_THEMES[k]
  if (cur) return t('theme.' + k)
  if (k.indexOf('hue') === 0) {
    const i = Math.max(0, Math.min(11, parseInt(k.slice(3), 10) || 0))
    const names = t('hueNames')
    // t() может вернуть и массив, и строку через запятую — поддерживаем оба вида.
    const nm = Array.isArray(names) ? names : String(names || '').split(',')
    return t('theme.hue') + (nm[i] ? ' · ' + nm[i] : '')
  }
  return t('theme.fire')
}

function toneFor(remaining, isLight, pal) {
  const acc = (pal && pal.accent) || '#ff9d2e'
  // Все тона — строго одна семья акцента (различие только по светлоте): цифры в любой
  // теме одного цвета; у самого низкого остатка — тот же яркий тон + пульс («горит»).
  let t1 = mixHex(acc, '#ffffff', 0.42)
  let t2 = mixHex(acc, '#ffffff', 0.18)
  let t3 = acc
  let t4 = acc
  if (isLight) {
    t1 = sink(t1, TONE_BG_LIGHT, 4.5)
    t2 = sink(t2, TONE_BG_LIGHT, 4.5)
    t3 = sink(t3, TONE_BG_LIGHT, 4.5)
    t4 = sink(t4, TONE_BG_LIGHT, 5.8)
  } else {
    t1 = lift(t1, TONE_BG_DARK, 4.5)
    t2 = lift(t2, TONE_BG_DARK, 4.5)
    t3 = lift(t3, TONE_BG_DARK, 4.5)
    t4 = lift(t4, TONE_BG_DARK, 4.5)
  }
  if (remaining <= LOW_REMAINING) return t4
  if (remaining <= 25) return t3
  if (remaining <= 60) return t2
  return t1
}

function flameSvg(size, className, colors) {
  const stops = colors && colors.length === 3 ? colors : ['#ff4d00', '#ff9d2e', '#ffd75e']
  return jsxs('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    className,
    style: { filter: 'drop-shadow(0 0 4px ' + alpha(stops[1], 0.6) + ')' },
    children: [
      jsx('defs', {
        children: jsx('linearGradient', {
          id: 'uf-grad',
          x1: '0',
          y1: '1',
          x2: '0',
          y2: '0',
          children: [
            jsx('stop', { offset: '0', stopColor: stops[0] }),
            jsx('stop', { offset: '.55', stopColor: stops[1] }),
            jsx('stop', { offset: '1', stopColor: stops[2] })
          ]
        })
      }),
      jsx('path', { fill: 'url(#uf-grad)', d: FLAME_PATH })
    ]
  })
}

function prettyProvider(slug, name) {
  if (name) return name
  if (!slug) return ''
  const known = KNOWN_PROVIDER_NAMES[slug]
  if (known) return known
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function shortLabel(label, t) {
  const key = KNOWN_LABEL_KEYS[label]
  return key ? t('win.' + key) : String(label || '')
}

function fullLabel(label, t) {
  const key = KNOWN_LABEL_KEYS[label]
  return key ? t('winFull.' + key) : String(label || '')
}

function readRaw(key) {
  try {
    return String(localStorage.getItem(key) || '').trim()
  } catch {
    return ''
  }
}

function readSelection() {
  let provider = readRaw(PROVIDER_KEY)
  let model = readRaw(MODEL_KEY)
  if (!provider || !model) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || ''
        if (!provider && k !== PROVIDER_KEY && k.startsWith(PROVIDER_KEY + '.')) {
          const v = readRaw(k)
          if (v) provider = v
        }
        if (!model && k !== MODEL_KEY && k.startsWith(MODEL_KEY + '.')) {
          const v = readRaw(k)
          if (v) model = v
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { provider, model }
}

function findJson(text) {
  if (!text) return null
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    return JSON.parse(text.slice(a, b + 1))
  } catch {
    return null
  }
}

function firstLine(text) {
  const line = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || ''
  return line.length > 200 ? line.slice(0, 197) + '…' : line
}

const WIN_ORDER = { rolling: 0, session: 0, weekly: 1, opusWeek: 2, sonnetWeek: 3, monthly: 4 }

function winRank(label) {
  const key = KNOWN_LABEL_KEYS[label]
  return key && WIN_ORDER[key] !== undefined ? WIN_ORDER[key] : 5
}

function windowsFrom(snapshot) {
  const list = snapshot && Array.isArray(snapshot.windows) ? snapshot.windows : []
  return list
    .map((w) => {
      const used = clampPct(w.used_percent)
      return {
        label: String((w && w.label) || ''),
        used,
        remaining: 100 - used,
        reset: (w && w.resets_at) || '',
        detail: (w && w.detail) || ''
      }
    })
    .filter((w) => w.label || w.used)
    .sort((a, b) => winRank(a.label) - winRank(b.label))
}

// ─── данные ──────────────────────────────────────────────────────────────────

async function usageFor(provider) {
  const at = Date.now()
  const argv = ['usage', '--json']
  if (provider) argv.push('--provider', provider)
  let res
  try {
    res = await host.request('cli.exec', { argv, timeout: 25 }, 45_000)
  } catch (e) {
    return { at, provider, ok: false, err: firstLine(e && e.message ? e.message : String(e)) }
  }
  if (res && res.blocked) {
    return { at, provider, ok: false, err: firstLine(res.hint) || 'blocked' }
  }
  if (!res || res.code !== 0) {
    return { at, provider, ok: false, err: firstLine(res && res.output) || 'no data' }
  }
  const doc = findJson(res.output)
  if (!doc || !Array.isArray(doc.windows)) {
    return { at, provider, ok: false, err: 'unparsable response' }
  }
  return { at, provider: doc.provider || provider, ok: true, snapshot: doc }
}

async function sweepAll() {
  const sel = readSelection()
  let options = []
  try {
    const res = await host.request('model.options', {})
    options = (res && Array.isArray(res.providers) ? res.providers : []).filter(Boolean)
  } catch {
    options = []
  }
  const nameBySlug = new Map()
  for (const row of options) {
    const slug = String((row && row.slug) || '')
    if (slug) nameBySlug.set(slug, String((row && row.name) || ''))
  }
  const slugs = []
  const add = (s) => {
    const slug = String(s || '')
    if (slug && !slug.startsWith('custom') && slug !== 'moa' && !slugs.includes(slug)) slugs.push(slug)
  }
  add(sel.provider)
  for (const s of KNOWN_USAGE_PROVIDERS) {
    if (nameBySlug.size === 0 || nameBySlug.has(s)) add(s)
  }
  const force = !!RT.forceSweep
  RT.forceSweep = false
  const rows = []
  await Promise.all(
    slugs.slice(0, 8).map(async (slug) => {
      // Свежий результат (< 10 мин) переиспользуем — иначе каждый тик спавнит CLI по всем провайдерам.
      if (!force) {
        let cached = null
        try {
          cached = RT.ctx.storage.get('sweep.' + slug, null)
        } catch {
          cached = null
        }
        if (cached && cached.snapshot && Date.now() - cached.at < SWEEP_TTL_MS) {
          rows.push({ slug, name: nameBySlug.get(slug) || '', at: cached.at, provider: cached.provider || slug, ok: true, snapshot: cached.snapshot })
          return
        }
      }
      let r = { ...(await usageFor(slug)) }
      if (r.ok && r.snapshot) {
        try {
          RT.ctx.storage.set('last.' + r.provider, { at: r.at, provider: r.provider, snapshot: r.snapshot })
          RT.ctx.storage.set('sweep.' + slug, { at: r.at, provider: r.provider, snapshot: r.snapshot })
        } catch {
          /* ignore */
        }
      } else {
        // Сбой сети: подставляем последние успешные данные (< 24 ч), чтобы список не «серел».
        let last = null
        try {
          last = RT.ctx.storage.get('last.' + slug, null)
        } catch {
          last = null
        }
        if (last && last.snapshot && Date.now() - last.at < 24 * 3600e3) {
          r = { at: r.at, provider: last.provider || slug, ok: true, stale: true, staleAt: last.at, snapshot: last.snapshot, err: r.err }
        }
      }
      rows.push({ slug, name: nameBySlug.get(slug) || '', ...r })
    })
  )
  // Провайдеры с данными — выше пустых.
  rows.sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0))
  const payload = { rows, at: Date.now() }
  try {
    RT.ctx.storage.set('cache.all', payload)
  } catch {
    /* ignore */
  }
  return payload
}

function checkNotify(rows) {
  if (!RT.settings.get().notify) return
  if (!rows || !rows.length) return
  const t = RT.i18n.t
  let notified = []
  try {
    notified = RT.ctx.storage.get('notified', []) || []
  } catch {
    notified = []
  }
  const now = Date.now()
  const alive = notified.filter((n) => n && typeof n.until === 'number' && n.until > now)
  let changed = alive.length !== notified.length
  for (const row of rows) {
    const wins = row.ok ? windowsFrom(row.snapshot) : []
    for (const w of wins) {
      if (w.remaining > LOW_REMAINING) continue
      const until = w.reset ? new Date(w.reset).getTime() || now + 6 * 3600e3 : now + 6 * 3600e3
      const key = `${row.slug}:${w.label}:${w.reset || 'x'}`
      if (alive.some((n) => n.k === key)) continue
      alive.push({ k: key, until })
      changed = true
      try {
        RT.ctx.os.notify({
          title: t('notify.title'),
          body: t('notify.body', prettyProvider(row.slug, row.name) || row.slug, fullLabel(w.label, t), roundPct(w.remaining))
        })
      } catch {
        /* notifications are best-effort */
      }
    }
  }
  if (changed) {
    try {
      RT.ctx.storage.set('notified', alive.slice(-60))
    } catch {
      /* ignore */
    }
  }
}

// ─── история и прогноз расхода ───────────────────────────────────────────────

function pushHistory(slug, snapshot) {
  if (!slug || !snapshot || !snapshot.windows) return
  try {
    const h = RT.ctx.storage.get('hist.' + slug, {}) || {}
    const now = Date.now()
    for (const w of snapshot.windows) {
      const key = String(w.label || '')
      const used = Number(w.used_percent)
      if (!key || !isFinite(used)) continue
      const reset = String(w.resets_at || '')
      let arr = Array.isArray(h[key]) ? h[key].slice() : []
      // Новый период сброса — история начинается заново.
      if (arr.length && String(arr[arr.length - 1][2] || '') !== reset) arr = []
      const last = arr[arr.length - 1]
      if (!last || now - last[0] >= HIST_MIN_STEP_MS || now - last[0] >= HIST_MAX_STEP_MS || Math.abs(used - last[1]) >= 1) {
        arr.push([now, used, reset])
      } else {
        arr[arr.length - 1] = [now, used, reset]
      }
      while (arr.length && now - arr[0][0] > HIST_MAX_AGE_MS) arr.shift()
      while (arr.length > HIST_MAX) arr.shift()
      h[key] = arr
    }
    RT.ctx.storage.set('hist.' + slug, h)
  } catch {
    /* история — best-effort */
  }
}

function forecastFor(slug, label, usedNow, resetIso) {
  try {
    if (!slug || !label) return null
    const h = RT.ctx.storage.get('hist.' + slug, null)
    const arr = h && Array.isArray(h[label]) ? h[label] : []
    if (arr.length < 2) return null
    const reset = String(resetIso || '')
    const used = Number(usedNow)
    if (!isFinite(used)) return null
    const pts = arr.filter((p) => Array.isArray(p) && p.length >= 2 && isFinite(p[1]) && String(p[2] || '') === reset)
    if (pts.length < 2) return null
    const t0 = pts[0][0]
    const tN = pts[pts.length - 1][0]
    const spanH = (tN - t0) / 3600e3
    if (spanH < FORECAST_MIN_SPAN_H) return null
    const dUsed = pts[pts.length - 1][1] - pts[0][1]
    if (dUsed <= 0.1) {
      // Расхода нет — прогноз не прячем, показываем честный «ноль».
      return { idle: true, burn: 0, mayRunOut: false, points: pts.slice(-24).map((p) => p[1]) }
    }
    const burn = dUsed / spanH
    const remaining = Math.max(0, 100 - used)
    const hoursLeft = remaining / burn
    const resetMs = reset ? new Date(reset).getTime() : 0
    const hoursToReset = resetMs && isFinite(resetMs) ? (resetMs - Date.now()) / 3600e3 : Infinity
    const mayRunOut = isFinite(hoursToReset) && hoursLeft < hoursToReset - 0.25
    return {
      burn: burn,
      hoursLeft: hoursLeft,
      exhaustAt: Date.now() + hoursLeft * 3600e3,
      mayRunOut: mayRunOut,
      points: pts.slice(-24).map((p) => p[1])
    }
  } catch {
    return null
  }
}

function burnLabel(f, t) {
  if (f.idle) return t('burnIdle')
  const burn = (Math.round(f.burn * 10) / 10).toFixed(1)
  if (!f.mayRunOut) return t('burnSafe', burn)
  const ex = new Date(f.exhaustAt)
  const soon = ex.getTime() - Date.now() < 24 * 3600e3
  const hhmm = (ex.getHours() < 10 ? '0' : '') + ex.getHours() + ':' + (ex.getMinutes() < 10 ? '0' : '') + ex.getMinutes()
  return t('burnRisk', burn, soon ? hhmm : fmtAbs(ex))
}

function Sparkline({ values, color, width, height }) {
  const vals = (values || []).filter((v) => isFinite(v))
  if (vals.length < 2) return null
  const w = width || 64
  const h = height || 14
  const min = Math.min.apply(null, vals)
  const max = Math.max.apply(null, vals)
  const range = Math.max(1, max - min)
  const step = w / (vals.length - 1)
  const pts = vals.map((v, i) => (i * step).toFixed(1) + ',' + (h - 2 - ((v - min) / range) * (h - 4)).toFixed(1)).join(' ')
  return jsx('svg', {
    className: 'uf-spark',
    width: w,
    height: h,
    viewBox: '0 0 ' + w + ' ' + h,
    style: { flexShrink: 0, opacity: 0.9 },
    children: jsx('polyline', {
      points: pts,
      fill: 'none',
      stroke: color,
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    })
  })
}

// ─── UI ──────────────────────────────────────────────────────────────────────

const POPOVER_CONTENT_CLASS = 'w-[352px] border-0 bg-transparent p-0 shadow-none'
const SECTION_LABEL = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.12em',
  color: 'rgba(255,207,154,.85)',
  margin: '2px 0 6px'
}

function Flame({ size, className }) {
  return flameSvg(size || 12, className, RT && RT.palette ? RT.palette.flame : null)
}

function WindowRow({ w, t, slug }) {
  const pal = (RT && RT.palette) || firePalette()
  const remain = clampPct(w.remaining)
  const remaining = roundPct(w.remaining)
  const tone = toneFor(w.remaining, !pal.isDark, pal)
  const fcast = forecastFor(slug, String(w.label || ''), w.used, String(w.reset || ''))
  return jsxs('div', {
    style: { marginBottom: 9 },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
        children: [
          jsx('span', { style: { fontSize: 12.5, fontWeight: 700, color: pal.label }, children: fullLabel(w.label, t) }),
          jsxs('span', {
            className: w.remaining <= LOW_REMAINING ? 'uf-throb' : undefined,
            style: {
              fontSize: 16,
              fontWeight: 700,
              color: tone,
              fontVariantNumeric: 'tabular-nums lining-nums',
              textShadow: w.remaining <= LOW_REMAINING ? '0 0 12px ' + pal.sos : '0 0 9px ' + alpha(tone, 0.55)
            },
            children: [String(remaining), jsx('small', { style: { fontSize: 10, fontWeight: 600, opacity: 0.75, marginLeft: 2 }, children: t('leftSuffix') })]
          })
        ]
      }),
      jsx('div', {
        className: remain <= 20 ? 'uf-burn' : undefined,
        style: {
          position: 'relative',
          height: 7,
          margin: '5px 0 4px',
          borderRadius: 999,
          background: pal.barTrack,
          overflow: 'hidden'
        },
        children: jsx('i', {
          className: remain >= 60 ? 'uf-bar-fill' : undefined,
          style: {
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            display: 'block',
            borderRadius: 999,
            width: remain + '%',
            background: pal.barGrad,
            boxShadow: remain <= 20 ? '0 0 12px ' + pal.sos : '0 0 9px ' + alpha(pal.accent, 0.5),
            transition: 'width .6s cubic-bezier(.22,.8,.3,1)'
          }
        })
      }),
      jsx('div', {
        style: { fontSize: 11, fontWeight: 700, color: pal.caption },
        children: [t('usedLine', roundPct(w.used)), resetLine(w.reset), w.detail].filter(Boolean).join(' · ')
      }),
      fcast
        ? jsxs('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 3 },
            children: [
              jsx('span', { style: { fontSize: 10.5, fontWeight: 700, color: fcast.mayRunOut ? pal.sos : pal.caption }, children: burnLabel(fcast, t) }),
              jsx(Sparkline, { values: fcast.points, color: tone, width: 64, height: 14 })
            ]
          })
        : null
    ]
  })
}

function ProviderRow({ row, t }) {
  const pal = (RT && RT.palette) || firePalette()
  const wins = row.ok ? windowsFrom(row.snapshot) : []
  const name = prettyProvider(row.slug, row.name)
  return jsxs('div', {
    className: 'uf-prov',
    title: row.ok ? (winTitle(wins, t) || '') : row.err || '',
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      width: '100%',
      textAlign: 'left',
      background: 'transparent',
      border: '1px solid transparent',
      borderRadius: 9,
      padding: '5px 8px',
      margin: '1px 0',
      color: 'inherit',
      font: 'inherit'
    },
    children: [
      jsx('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 },
        children: jsx('span', {
          style: {
            fontSize: 12.5,
            fontWeight: 700,
            color: pal.caption,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          },
          children: name || row.slug
        })
      }),
      row.ok && wins.length
        ? jsx('span', {
            title: row.stale ? (isRu() ? 'Нет свежих данных — показаны последние из кэша' : 'No fresh data — showing cached') : undefined,
            style: { display: 'inline-flex', gap: 7, fontVariantNumeric: 'tabular-nums lining-nums', flexShrink: 0, alignItems: 'center' },
            children: (row.stale
              ? [jsx('span', { style: { fontSize: 11, fontWeight: 700, color: pal.caption }, children: '≈' }, 'st')]
              : []
            ).concat(
              wins.slice(0, 3).map((w, i) => {
                const tn = toneFor(w.remaining, !pal.isDark, pal)
                return jsxs(
                  'span',
                  {
                    style: { display: 'inline-flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 4, minWidth: 64 },
                    children: [
                      jsx('span', { style: { fontSize: 11.5, fontWeight: 700, color: pal.label }, children: shortLabel(w.label, t) }),
                      jsx('span', {
                        className: w.remaining <= LOW_REMAINING ? 'uf-throb' : undefined,
                        style: { fontSize: 13.5, fontWeight: 700, color: tn, textShadow: '0 0 8px ' + alpha(tn, 0.5) },
                        children: roundPct(w.remaining) + '%'
                      })
                    ]
                  },
                  row.slug + ':' + i
                )
              })
            )
          })
        : jsx('span', { style: { color: pal.caption, fontSize: 11, fontWeight: 700, flexShrink: 0 }, children: t('noData') })
    ]
  })
}

function winTitle(wins, t) {
  return wins.map((w) => `${fullLabel(w.label, t)} ${roundPct(w.remaining)}%`).join(' · ')
}

function PillToggle({ active, label, onClick }) {
  const pal = (RT && RT.palette) || firePalette()
  return jsx('button', {
    type: 'button',
    onClick: onClick,
    style: {
      fontSize: 11,
      fontWeight: 600,
      padding: '4px 10px',
      borderRadius: 999,
      cursor: 'pointer',
      color: active ? pal.pillText : pal.muted,
      background: active ? 'linear-gradient(90deg, ' + pal.accent + ', ' + mixHex(pal.accent, '#ffffff', 0.35) + ')' : pal.accentSoft,
      border: active ? '1px solid ' + alpha(pal.accent, 0.85) : '1px dashed ' + alpha(pal.accent, 0.3),
      boxShadow: active ? '0 0 10px ' + alpha(pal.accent, 0.45) : 'none',
      font: 'inherit'
    },
    children: active ? ['✓ ', label] : label
  })
}

function swatchBg(key) {
  const k = String(key || 'fire')
  if (k === 'auto') return 'linear-gradient(135deg, #f2f2f4 50%, #26262c 50%)'
  if (k === 'fire') return 'radial-gradient(circle at 35% 30%, #ffd75e, #ff5200 72%)'
  const cur = CURATED_THEMES[k]
  if (cur) return 'radial-gradient(circle at 35% 30%, ' + mixHex(cur.a1, '#ffffff', 0.35) + ', ' + cur.a1 + ' 55%, ' + cur.a2 + ')'
  if (k.indexOf('hue') === 0) {
    const i = Math.max(0, Math.min(11, parseInt(k.slice(3), 10) || 0))
    return HUE_HEXES[i]
  }
  return '#ff8c28'
}

function ThemePicker({ t, pal, theme, min, onTheme, onMin, font, size, onFont, onSize }) {
  const dot = (key) => {
    const title = themeLabel(key, t)
    return jsx(
      'button',
      {
        type: 'button',
        title: title,
        'aria-label': title,
        onClick: () => onTheme(key),
        style: {
          width: 24,
          height: 24,
          borderRadius: 999,
          padding: 0,
          cursor: 'pointer',
          flexShrink: 0,
          background: swatchBg(key),
          border: theme === key ? '2px solid ' + pal.label : '1px solid ' + alpha('#888888', 0.45),
          boxShadow: theme === key ? '0 0 8px ' + alpha(pal.accent, 0.55) : 'none'
        }
      },
      key
    )
  }
  return jsxs('div', {
    style: { width: '100%' },
    children: [
      jsx('div', { style: { ...SECTION_LABEL, color: pal.section }, children: t('theme.title') }),
      jsx('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(6, 26px)', gap: 8, marginBottom: 10, justifyContent: 'space-between' },
        children: ['auto', 'fire', 'neon', 'aurora', 'gold', 'sakura'].concat(HUE_HEXES.map((_, i) => 'hue' + i)).map(dot)
      }),
      jsx('div', { style: { ...SECTION_LABEL, color: pal.section }, children: t('fontRow.title') }),
      jsx('div', {
        style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 9 },
        children: ['sys', 'book', 'tech', 'wide'].map((f) =>
          jsx(PillToggle, { active: (font || 'sys') === f, label: t('fontRow.' + f), onClick: () => onFont(f) }, 'f' + f)
        )
      }),
      jsx('div', { style: { ...SECTION_LABEL, color: pal.section }, children: t('sizeRow.title') }),
      jsx('div', {
        style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 9 },
        children: ['m', 'l', 'xl'].map((s) =>
          jsx(PillToggle, { active: (size || 'm') === s, label: t('sizeRow.' + s), onClick: () => onSize(s) }, 's' + s)
        )
      }),
      jsx('div', { style: { borderTop: '1px solid ' + pal.sep, margin: '2px 0 7px' } }),
      jsx('div', { style: { ...SECTION_LABEL, color: pal.section }, children: t('refreshRow.title') }),
      jsx('div', {
        style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
        children: [1, 2, 5, 15].map((m) =>
          jsx(PillToggle, { active: (Number(min) || 1) === m, label: t('refreshRow.min', m), onClick: () => onMin(m) }, 'r' + m)
        )
      })
    ]
  })
}

function UsagePanel({ close, current, all }) {
  const t = usePluginI18n(ID)
  const { locale } = useI18n()
  RT.locale = locale || ''
  const queryClient = useQueryClient()
  const settings = useValue(RT.settings)
  const hermes = useTheme()
  const pal = resolvePalette(settings.theme, hermes.theme, hermes.renderedMode)
  RT.palette = pal
  const [themeOpen, setThemeOpen] = useState(false)
  const [provOpen, setProvOpen] = useState(false)
  const cdata = current.data
  const allData = all.data
  const busy = current.isFetching || all.isFetching

  const wins = cdata && cdata.ok ? windowsFrom(cdata.snapshot) : []
  const providerSlug = (cdata && cdata.provider) || ''
  const providerName = prettyProvider(providerSlug)

  const setSetting = (patch) => {
    haptic('tap')
    const cur = RT.settings.get()
    const next = { ...cur, ...patch }
    // Инвариант: хотя бы один чип остаётся видимым — полностью исчезнуть нельзя.
    if (patch.bottom === false && !next.top) {
      next.bottom = true
      host.notify({ kind: 'info', message: t('keepOne') })
    }
    if (patch.top === false && !next.bottom) {
      next.top = true
      host.notify({ kind: 'info', message: t('keepOne') })
    }
    RT.settings.set(next)
    try {
      RT.ctx.storage.set('settings', next)
    } catch {
      /* ignore */
    }
  }

  const refreshAll = () => {
    haptic('tap')
    RT.forceSweep = true
    void current.refetch()
    void all.refetch()
  }

  const updatedAt = cdata && (cdata.staleAt || cdata.at) ? new Date(cdata.staleAt || cdata.at) : null
  const updatedLabel = updatedAt ? t('updated', pad2(updatedAt.getHours()) + ':' + pad2(updatedAt.getMinutes())) : t('loading')

  return jsxs('div', {
    className: 'uf-card',
    style: {
      background: pal.cardBg,
      border: '1px solid ' + pal.cardBorder,
      borderRadius: 14,
      boxShadow: '0 12px 32px rgba(0,0,0,.5), 0 0 24px ' + pal.glowA,
      color: pal.text,
      overflow: 'hidden auto',
      maxHeight: 'min(78vh, 720px)',
      width: 352,
      fontFamily: FONTS[settings.font] || undefined,
      // Все цифры — одного роста и одной ширины (никаких «свисающих» старых цифр).
      fontVariantNumeric: 'lining-nums tabular-nums',
      fontFeatureSettings: '"lnum" 1, "tnum" 1',
      zoom: FS_ZOOM[settings.fontScale] || 1,
      '--uf-glow-a': pal.glowA,
      '--uf-glow-b': pal.glowB,
      '--uf-sos': pal.sos,
      '--uf-sos-bg': pal.sosBg
    },
    children: [
      jsxs('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 10px 8px 12px',
          background: 'linear-gradient(180deg, ' + pal.accentSoft + ', transparent)',
          borderBottom: '1px solid ' + pal.sep
        },
        children: [
          jsx(Flame, { size: 15, className: 'uf-flame' }),
          jsxs('div', {
            style: { minWidth: 0, flex: 1 },
            children: [
              jsx('div', { style: { fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', color: pal.section }, children: t('title') }),
              jsx('div', {
                style: { fontSize: 11.5, fontWeight: 700, color: pal.caption, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                children: providerName || t('noProvider')
              })
            ]
          }),
          jsx('button', {
            type: 'button',
            title: t('theme.title') + ': ' + themeLabel(settings.theme, t),
            'aria-label': t('theme.title'),
            'aria-expanded': themeOpen ? 'true' : 'false',
            onClick: () => setThemeOpen((v) => !v),
            style: {
              width: 20,
              height: 20,
              borderRadius: 999,
              padding: 0,
              cursor: 'pointer',
              flexShrink: 0,
              background: swatchBg(settings.theme),
              border: '1px solid ' + pal.cardBorder,
              boxShadow: '0 0 8px ' + alpha(pal.accent, 0.35)
            }
          }),
          jsxs(Button, {
            className: 'h-6 gap-1 px-2 text-xs font-normal',
            disabled: busy,
            onClick: refreshAll,
            title: t('refresh'),
            type: 'button',
            variant: 'ghost',
            children: [jsx(icons.RefreshCw, { className: cn('size-3', busy && 'uf-spin') }), t('refresh')]
          })
        ]
      }),
      themeOpen
        ? jsx('div', {
            className: 'uf-picker',
            style: {
              padding: '9px 12px 5px',
              background: alpha(pal.accent, pal.isDark ? 0.08 : 0.05),
              borderBottom: '1px solid ' + pal.sep
            },
            children: jsx(ThemePicker, {
              t: t,
              pal: pal,
              theme: settings.theme,
              min: settings.refreshMin,
              font: settings.font,
              size: settings.fontScale,
              onTheme: (k) => setSetting({ theme: k }),
              onMin: (m) => setSetting({ refreshMin: m }),
              onFont: (f) => setSetting({ font: f }),
              onSize: (s) => setSetting({ fontScale: s })
            })
          })
        : null,
      jsxs('div', {
        style: { padding: '10px 12px 8px' },
        children: [
          cdata && !cdata.ok
            ? jsx('div', {
                style: {
                  margin: '2px 0 8px',
                  padding: '7px 9px',
                  borderRadius: 9,
                  fontSize: 11,
                  color: '#ffc3ad',
                  background: 'rgba(140,30,10,.28)',
                  border: '1px solid rgba(255,96,54,.35)',
                  wordBreak: 'break-word'
                },
                children: [
                  jsx('div', { style: { fontWeight: 700, marginBottom: 2 }, children: t('errTitle') }),
                  jsx('div', { style: { opacity: 0.9 }, children: t('errHint') }),
                  cdata.err
                    ? jsx('div', { style: { marginTop: 4, fontSize: 10, opacity: 0.65, wordBreak: 'break-word' }, children: cdata.err })
                    : null
                ]
              })
            : null,
            cdata && cdata.ok && cdata.stale
              ? jsx('div', {
                  style: {
                    margin: '2px 0 8px',
                    padding: '6px 9px',
                    borderRadius: 9,
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: pal.caption,
                    background: alpha(pal.accent, 0.08),
                    border: '1px solid ' + pal.sep,
                    wordBreak: 'break-word'
                  },
                  children:
                    (isRu() ? 'Нет свежих данных — показано обновление в ' : 'No fresh data — showing update from ') +
                    new Date(cdata.staleAt || cdata.at).toLocaleTimeString(RT.locale || undefined, { hour: '2-digit', minute: '2-digit' })
                })
              : null,
            wins.length
            ? wins.map((w, i) => jsx(WindowRow, { w: w, t: t, slug: cdata.provider }, 'w' + i))
            : cdata
              ? cdata.ok
                ? jsx('div', { style: { fontSize: 12, fontWeight: 700, color: pal.caption, marginBottom: 6 }, children: t('noData') })
                : null
              : jsx('div', { style: { fontSize: 12, fontWeight: 700, color: pal.caption, marginBottom: 6 }, children: t('loading') }),
          jsx('div', { style: { borderTop: '1px solid ' + pal.sep, margin: '6px 0 8px' } }),
          jsxs('button', {
            type: 'button',
            onClick: () => {
              haptic('tap')
              setProvOpen((v) => !v)
            },
            title: provOpen ? t('collapse') : t('expand'),
            'aria-expanded': provOpen ? 'true' : 'false',
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              width: '100%',
              background: 'transparent',
              border: 0,
              padding: '2px 0',
              cursor: 'pointer',
              font: 'inherit'
            },
            children: [
              jsx('span', { style: { ...SECTION_LABEL, color: pal.section }, children: t('allProviders') }),
              jsx('span', {
                style: {
                  display: 'inline-block',
                  fontSize: 13,
                  fontWeight: 700,
                  color: pal.section,
                  transform: provOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform .15s ease'
                },
                children: '▾'
              })
            ]
          }),
          provOpen
            ? jsxs('div', {
                style: { marginTop: 2 },
                children: [
                  (allData && allData.rows ? allData.rows : []).map((row) =>
                    jsx(ProviderRow, { row: row, t: t }, row.slug)
                  ),
                  !allData ? jsx('div', { style: { fontSize: 11.5, fontWeight: 700, color: pal.caption, padding: '2px 0' }, children: t('loading') }) : null
                ]
              })
            : null,
          jsx('div', { style: { borderTop: '1px solid ' + pal.sep, margin: '8px 0 7px' } }),
          jsx('div', { style: { ...SECTION_LABEL, color: pal.section }, children: t('settingsTitle') }),
          jsxs('div', {
            style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
            children: [
              jsx(PillToggle, {
                active: settings.bottom,
                label: t('slotBottom'),
                onClick: () => setSetting({ bottom: !settings.bottom })
              }),
              jsx(PillToggle, {
                active: settings.top,
                label: t('slotTop'),
                onClick: () => setSetting({ top: !settings.top })
              }),
              jsx(PillToggle, {
                active: settings.notify,
                label: t('notifications'),
                onClick: () => setSetting({ notify: !settings.notify })
              })
            ]
          }),
          jsxs('div', {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              marginTop: 8,
              paddingTop: 6,
              borderTop: '1px solid ' + pal.sep,
              fontSize: 10.5,
              fontWeight: 700,
              color: pal.caption
            },
            children: [
              jsx('span', { children: updatedLabel }),
              jsx('span', { children: t('autoNote', Number(settings.refreshMin) || 1) })
            ]
          })
        ]
      })
    ]
  })
}

function resolveChip(current, all, settings) {
  const cdata = current.data
  if (cdata && cdata.ok) return cdata
  const wanted = (cdata && cdata.provider) || readSelection().provider || ''
  const rows = (all.data && all.data.rows) || []
  const fromAll = rows.find((r) => r.slug === wanted && r.ok)
  if (fromAll) return { provider: fromAll.slug, ok: true, snapshot: fromAll.snapshot, err: null, at: fromAll.at }
  return cdata || { provider: wanted, ok: false, err: '', at: 0 }
}

function UsageChip({ placement }) {
  const t = usePluginI18n(ID)
  const { locale } = useI18n()
  RT.locale = locale || ''
  const model = useValue(host.state.model)
  const settings = useValue(RT.settings)
  const hermes = useTheme()
  const pal = resolvePalette(settings.theme, hermes.theme, hermes.renderedMode)
  RT.palette = pal
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const cachedCurrent = usedCached('cache.current')
  const current = useQuery({
    queryKey: ['usage-flame', 'current', model],
    queryFn: async () => {
      const sel = readSelection()
      const provider = sel.provider
      const result = { ...(await usageFor(provider)) }
      if (result.ok && result.snapshot) {
        try {
          RT.ctx.storage.set('last.' + result.provider, { at: result.at, provider: result.provider, snapshot: result.snapshot })
          RT.ctx.storage.set('cache.current', result)
        } catch {
          /* ignore */
        }
        pushHistory(result.provider || provider, result.snapshot)
        return result
      }
      // Фетч не удался (сеть/эндпоинт). Если есть последние успешные данные (< 24 ч),
      // показываем их с пометкой «нет свежих данных», а не пустоту.
      let last = null
      try {
        last = RT.ctx.storage.get('last.' + provider, null)
        if ((!last || !last.snapshot) && cachedCurrent && cachedCurrent.provider) {
          last = RT.ctx.storage.get('last.' + cachedCurrent.provider, null)
        }
      } catch {
        last = null
      }
      if (last && last.snapshot && Date.now() - last.at < 24 * 3600e3) {
        const merged = {
          at: result.at,
          provider: last.provider || provider,
          ok: true,
          stale: true,
          staleAt: last.at,
          snapshot: last.snapshot,
          err: result.err
        }
        try {
          RT.ctx.storage.set('cache.current', merged)
        } catch {
          /* ignore */
        }
        return merged
      }
      try {
        RT.ctx.storage.set('cache.current', result)
      } catch {
        /* ignore */
      }
      return result
    },
    refetchInterval: Math.max(1, Number(settings.refreshMin) || 1) * CURRENT_REFETCH_MS,
    staleTime: 30_000,
    initialData: cachedCurrent || undefined,
    initialDataUpdatedAt: cachedCurrent ? cachedCurrent.at : undefined
  })

  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setReady(true), SWEEP_DELAY_MS)
    return () => clearTimeout(id)
  }, [])
  const cachedAll = usedCached('cache.all')
  const all = useQuery({
    queryKey: ['usage-flame', 'all'],
    queryFn: sweepAll,
    enabled: ready,
    refetchInterval: SWEEP_REFETCH_MS,
    staleTime: SWEEP_STALE_MS,
    initialData: cachedAll || undefined,
    initialDataUpdatedAt: cachedAll ? cachedAll.at : undefined
  })

  useEffect(() => {
    RT.refreshNow = () => {
      RT.forceSweep = true
      void current.refetch()
      void all.refetch()
    }
    return () => {
      RT.refreshNow = null
    }
  }, [current, all])

  // Смена провайдера в пикере не всегда меняет модель — следим за ней отдельно.
  const lastProvider = useRef(readSelection().provider)
  useEffect(() => {
    const id = setInterval(() => {
      const p = readSelection().provider
      if (p !== lastProvider.current) {
        lastProvider.current = p
        void queryClient.invalidateQueries({ queryKey: ['usage-flame', 'current'] })
      }
    }, 5_000)
    return () => clearInterval(id)
  }, [queryClient])

  useEffect(() => {
    const rows = []
    if (current.data && current.data.ok) {
      rows.push({ slug: current.data.provider, name: '', ok: true, snapshot: current.data.snapshot })
    }
    const rows2 = (all.data && all.data.rows) || []
    for (const r of rows2) if (r.ok && !rows.some((x) => x.slug === r.slug)) rows.push({ slug: r.slug, name: r.name, ok: true, snapshot: r.snapshot })
    checkNotify(rows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.dataUpdatedAt, all.dataUpdatedAt])

  if (placement === 'top' && !settings.top) return null
  if (placement === 'bottom' && !settings.bottom) return null

  const view = resolveChip(current, all, settings)
  const wins = view && view.ok ? windowsFrom(view.snapshot) : []
  const providerName = prettyProvider(view && view.provider, '')
  const minRemaining = wins.length ? Math.min.apply(null, wins.map((w) => w.remaining)) : 101
  const sos = wins.length > 0 && minRemaining <= LOW_REMAINING
  const loading = current.isLoading && !view.ok

  const tip = wins.length
    ? `${providerName} — ${winTitle(wins, t)}${view.at ? ' · ' + t('updated', new Date(view.at).toTimeString().slice(0, 5)) : ''}${view.stale ? (isRu() ? ' · нет свежих данных' : ' · no fresh data') : ''}`
    : providerName ? `${providerName} — ${t('noData')}` : t('noProvider')

  const chipChildren = wins.length
    ? wins.slice(0, 3).flatMap((w, i) => {
        const parts = []
        if (i > 0) parts.push(jsx('span', { style: { opacity: 0.5, margin: '0 3px' }, children: '·' }, 'sep' + i))
        parts.push(
          jsxs('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 3 }, children: [
            jsx('span', { style: { fontSize: 11, fontWeight: 700, opacity: 0.85 }, children: shortLabel(w.label, t) }),
            jsx('span', {
              style: (() => {
                const tn = toneFor(w.remaining, hermes.renderedMode === 'light', pal)
                return { fontSize: 13, fontWeight: 700, color: tn, textShadow: '0 0 8px ' + alpha(tn, 0.45), fontVariantNumeric: 'tabular-nums lining-nums' }
              })(),
              children: roundPct(w.remaining) + '%'
            })
          ] }, 'w' + i)
        )
        return parts
      })
    : [jsx('span', { style: { opacity: 0.6 }, children: loading ? '…' : t('noData') }, 'empty')]

  const onOpenChange = (next) => {
    setOpen(next)
    if (!next) return
    const stale = (q) => {
      const qs = queryClient.getQueryState(q.queryKey)
      return !qs || Date.now() - (qs.dataUpdatedAt || 0) > (q === current ? Math.max(1, Number(RT.settings.get().refreshMin) || 1) * CURRENT_REFETCH_MS : SWEEP_STALE_MS)
    }
    if (stale(current)) void current.refetch()
    if (stale(all)) void all.refetch()
  }

  return jsxs(Popover, {
    open: open,
    onOpenChange: onOpenChange,
    children: [
      jsx(Tip, {
        label: tip,
        children: jsx(PopoverTrigger, {
          asChild: true,
          children: jsxs('button', {
            type: 'button',
            'aria-label': tip,
            className: cn(
              'inline-flex h-full items-center gap-1 px-1.5 text-xs transition-colors',
              'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground',
              sos && 'uf-sos'
            ),
            style: { '--uf-sos': pal.sos, '--uf-sos-bg': pal.sosBg },
            children: [jsx(Flame, { key: 'flame', size: 12, className: 'uf-flame' })].concat(chipChildren)
          })
        })
      }),
      jsx(PopoverContent, {
        align: 'end',
        side: placement === 'top' ? 'bottom' : 'top',
        sideOffset: 6,
        className: POPOVER_CONTENT_CLASS,
        children: jsx(UsagePanel, { close: () => setOpen(false), current: current, all: all })
      })
    ]
  })
}

function usedCached(key) {
  try {
    const c = RT.ctx.storage.get(key, null)
    if (c && typeof c === 'object' && typeof c.at === 'number' && Date.now() - c.at < CACHE_TTL_MS) return c
  } catch {
    /* ignore */
  }
  return null
}

// ─── plugin ──────────────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Usage Flame',
  register(ctx) {
    const oldStyle = document.getElementById(STYLE_ID)
    if (oldStyle) oldStyle.remove()
    const styleEl = document.createElement('style')
    styleEl.id = STYLE_ID
    styleEl.textContent = STYLE_CSS
    document.head.appendChild(styleEl)

    let stored = null
    try {
      stored = ctx.storage.get('settings', null)
    } catch {
      stored = null
    }
    const settings = atom({
      bottom: true,
      top: false,
      notify: true,
      pinned: '',
      theme: 'fire',
      refreshMin: 1,
      font: 'sys',
      fontScale: 'l',
      ...(stored && typeof stored === 'object' ? stored : {})
    })
    // Одноразовая миграция к инварианту: гарантируем, что хотя бы один чип
    // виден (возвращаем нижний тем, кто выключил его до появления инварианта).
    try {
      if (!ctx.storage.get('flame-visible-v1', false)) {
        const s0 = settings.get()
        if (!s0.bottom) {
          const migrated = { ...s0, bottom: true }
          settings.set(migrated)
          ctx.storage.set('settings', migrated)
        }
        ctx.storage.set('flame-visible-v1', true)
      }
    } catch {
      /* ignore */
    }
    // Автолечение: оба чипа выключенными быть не могут.
    {
      const s0 = settings.get()
      if (!s0.bottom && !s0.top) {
        const healed = { ...s0, bottom: true }
        settings.set(healed)
        try {
          ctx.storage.set('settings', healed)
        } catch {
          /* ignore */
        }
      }
    }
    // «Пин провайдера» больше не нужен (все провайдеры видны в списке) — чистим.
    try {
      const s1 = settings.get()
      if (s1.pinned) {
        const cleared = { ...s1, pinned: '' }
        settings.set(cleared)
        ctx.storage.set('settings', cleared)
      }
    } catch {
      /* ignore */
    }

    RT = {
      ctx,
      settings,
      i18n: ctx.i18n,
      locale: '',
      refreshNow: null
    }

    ctx.i18n.register(MESSAGES)

    ctx.register({
      id: 'chip-bottom',
      area: STATUSBAR_AREAS.right,
      order: 120,
      render: () => jsx(UsageChip, { placement: 'bottom' })
    })

    ctx.register({
      id: 'chip-top',
      area: TITLEBAR_AREAS.right,
      order: 40,
      render: () => jsx(UsageChip, { placement: 'top' })
    })

    ctx.register({
      id: 'palette-refresh',
      area: PALETTE_AREA,
      data: {
        id: 'usage-flame.refresh',
        label: ctx.i18n.t('palette.refresh'),
        keywords: ['usage', 'limits', 'flame', 'quota', 'лимиты'],
        run: () => {
          haptic('tap')
          if (RT.refreshNow) RT.refreshNow()
        }
      }
    })

    ctx.register({
      id: 'palette-show',
      area: PALETTE_AREA,
      data: {
        id: 'usage-flame.show',
        label: ctx.i18n.t('palette.show'),
        keywords: ['usage', 'limits', 'flame', 'показать', 'чип', 'show'],
        run: () => {
          haptic('tap')
          const next = { ...RT.settings.get(), bottom: true }
          RT.settings.set(next)
          try {
            RT.ctx.storage.set('settings', next)
          } catch {
            /* ignore */
          }
          if (RT.refreshNow) RT.refreshNow()
        }
      }
    })

    ctx.register({
      id: 'palette-theme',
      area: PALETTE_AREA,
      data: {
        id: 'usage-flame.theme',
        label: ctx.i18n.t('theme.next'),
        keywords: ['usage', 'theme', 'flame', 'тема', 'цвет', 'огонь'],
        run: () => {
          haptic('tap')
          const cur = RT.settings.get()
          const i = THEME_CYCLE.indexOf(String(cur.theme || 'fire'))
          const next = THEME_CYCLE[(i + 1) % THEME_CYCLE.length]
          const s = { ...cur, theme: next }
          RT.settings.set(s)
          try {
            RT.ctx.storage.set('settings', s)
          } catch {
            /* ignore */
          }
        }
      }
    })

    ctx.onDispose(() => {
      const s = document.getElementById(STYLE_ID)
      if (s) s.remove()
    })
  }
}
