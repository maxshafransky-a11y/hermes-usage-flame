// Мини-мок @hermes/plugin-sdk для оффлайн-стенда Usage Flame v2.
// React берётся из import-map (esm.sh), этот модуль добавляет SDK-поверхность.
import { cloneElement, createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { jsx } from 'react/jsx-runtime'

export const PALETTE_AREA = 'palette'
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' }
export const TITLEBAR_AREAS = { center: 'titleBar.center', left: 'titleBar.left', right: 'titleBar.right' }

// ── атомы (nanostores-подобные) ──────────────────────────────────────────────
export function atom(init) {
  const subs = new Set()
  let v = init
  return {
    get: () => v,
    set: (n) => {
      v = typeof n === 'function' ? n(v) : n
      subs.forEach((f) => f(v))
    },
    subscribe: (f) => {
      subs.add(f)
      return () => subs.delete(f)
    }
  }
}

export function useValue(a) {
  return useSyncExternalStore(
    (cb) => a.subscribe(cb),
    () => a.get(),
    () => a.get()
  )
}

// ── хост ─────────────────────────────────────────────────────────────────────
const calls = []
export const host = {
  __calls: calls,
  state: {
    model: atom('deepseek-v4.1-flash'),
    profile: atom('default'),
    gateway: atom('open'),
    focusedSessionProfile: atom('default')
  },
  request: async (method, params) => {
    calls.push({ method, params })
    if (method === 'model.options') {
      return {
        providers: [
          { slug: 'opencode-go', name: 'OpenCode Go' },
          { slug: 'openai-codex', name: 'OpenAI Codex' },
          { slug: 'anthropic', name: 'Anthropic' },
          { slug: 'openrouter', name: 'OpenRouter' }
        ]
      }
    }
    if (method === 'cli.exec') {
      const argv = (params && params.argv) || []
      const provider = argv[argv.indexOf('--provider') + 1] || ''
      if (window.__MOCK_CLI_FAIL) {
        return {
          blocked: false,
          code: 1,
          output: `No account usage available for provider '${provider || 'opencode-go'}': fetch failed (mock)`
        }
      }
      if (!provider || provider === 'opencode-go') {
        const file = window.__MOCK_LOW ? './doc-low.json' : './doc.json'
        return { blocked: false, code: 0, output: await (await fetch(file)).text() }
      }
      return {
        blocked: false,
        code: 1,
        output: `No account usage available for provider '${provider}': no credential is configured for it, the provider has no usage endpoint, or the fetch failed.`
      }
    }
    throw new Error('unexpected method ' + method)
  },
  notify: (n) => {
    window.__TOASTS = window.__TOASTS || []
    window.__TOASTS.push(String((n && n.message) || ''))
  },
  navigate: () => {},
  logs: () => {}
}

// ── react-query-подобное (оповещает ВСЕХ наблюдателей ключа) ─────────────────
const registry = new Map() // key -> { subs:Set<fn>, fetching:bool, fn:()=>any }
const qstate = new Map() // key -> { data, dataUpdatedAt }

function runQuery(key, fn) {
  let e = registry.get(key)
  if (!e) {
    e = { subs: new Set(), fetching: false, fn }
    registry.set(key, e)
  }
  e.fetching = true
  e.subs.forEach((f) => f())
  return Promise.resolve()
    .then(() => fn())
    .then((next) => {
      qstate.set(key, { data: next, dataUpdatedAt: Date.now() })
    })
    .catch((err) => {
      qstate.set(key, { data: undefined, dataUpdatedAt: Date.now(), error: String(err) })
    })
    .then(() => {
      e.fetching = false
      e.subs.forEach((f) => f())
    })
}

export function useQuery(options) {
  const { queryKey, queryFn, enabled = true, refetchInterval, staleTime = 0, initialData, initialDataUpdatedAt } = options
  void staleTime
  const key = JSON.stringify(queryKey || [])
  const [, force] = useState(0)
  const fnRef = useRef(queryFn)
  fnRef.current = queryFn

  let e = registry.get(key)
  if (!e) {
    e = { subs: new Set(), fetching: false, fn: () => fnRef.current() }
    registry.set(key, e)
  }
  e.fn = () => fnRef.current()

  useEffect(() => {
    const sub = () => force((x) => x + 1)
    e.subs.add(sub)
    if (enabled && !qstate.has(key) && initialData === undefined) {
      void runQuery(key, () => fnRef.current())
    }
    return () => {
      e.subs.delete(sub)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  useEffect(() => {
    if (!enabled || !refetchInterval) return undefined
    const id = setInterval(() => {
      void runQuery(key, () => fnRef.current())
    }, refetchInterval)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, refetchInterval])

  const cur = qstate.get(key)
  const data = cur ? cur.data : initialData
  const dataUpdatedAt = cur ? cur.dataUpdatedAt : initialDataUpdatedAt || 0
  const isLoading = data === undefined
  const isFetching = !!e.fetching

  return { data, dataUpdatedAt, isLoading, isFetching, refetch: () => runQuery(key, () => fnRef.current()), queryKey }
}

export function useQueryClient() {
  return {
    getQueryState: (queryKey) => {
      const key = JSON.stringify(queryKey || [])
      if (!registry.has(key)) return undefined
      const s = qstate.get(key)
      return { dataUpdatedAt: s ? s.dataUpdatedAt : 0 }
    },
    invalidateQueries: ({ queryKey } = {}) => {
      const key = JSON.stringify(queryKey || [])
      const e = registry.get(key)
      if (e && e.fn) void runQuery(key, e.fn)
    }
  }
}

// ── i18n ─────────────────────────────────────────────────────────────────────
const bundles = new Map()

export function __registerMockBundles(id, b) {
  bundles.set(id, b)
}

function resolvePath(obj, path) {
  return String(path)
    .split('.')
    .reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export function __translateMock(id, locale, key, args) {
  const b = (bundles.get(id) || {})
  let val = resolvePath(b[locale], key)
  if (val === undefined) val = resolvePath(b.en, key)
  if (val === undefined) return key
  return typeof val === 'function' ? val.apply(null, args || []) : String(val)
}

export function usePluginI18n(id) {
  const locale = window.__LOCALE || 'ru'
  return useCallback((key, ...args) => __translateMock(id, locale, key, args), [id, locale])
}

export function useI18n() {
  return { locale: window.__LOCALE || 'ru', t: (k) => k, setLocale: async () => {} }
}

export function useTheme() {
  const mode = window.__MOCK_MODE === 'light' ? 'light' : 'dark'
  const dark = mode === 'dark'
  return {
    theme: {
      name: 'mock',
      label: 'Mock',
      description: '',
      colors: dark
        ? {
            background: '#101014',
            foreground: '#e8e8ea',
            card: '#15151a',
            cardForeground: '#e8e8ea',
            muted: '#1c1c22',
            mutedForeground: '#9a9aa2',
            popover: '#15151a',
            popoverForeground: '#e8e8ea',
            primary: '#7c6cff',
            primaryForeground: '#ffffff',
            secondary: '#202028',
            secondaryForeground: '#d0d0d6',
            accent: '#26262e',
            accentForeground: '#e8e8ea',
            border: '#2a2a32',
            input: '#2a2a32',
            ring: '#7c6cff',
            midground: '#7c6cff',
            destructive: '#d05050',
            destructiveForeground: '#ffffff'
          }
        : {
            background: '#ffffff',
            foreground: '#161616',
            card: '#ffffff',
            cardForeground: '#161616',
            muted: '#f4f4f6',
            mutedForeground: '#6b6b70',
            popover: '#ffffff',
            popoverForeground: '#161616',
            primary: '#4f5bd5',
            primaryForeground: '#ffffff',
            secondary: '#ececf2',
            secondaryForeground: '#2a2a2a',
            accent: '#ececf2',
            accentForeground: '#2a2a2a',
            border: '#e3e3e8',
            input: '#e2e2e6',
            ring: '#4f5bd5',
            midground: '#4f5bd5',
            destructive: '#b94a3a',
            destructiveForeground: '#ffffff'
          }
    },
    themeName: 'mock',
    mode: mode,
    resolvedMode: mode,
    renderedMode: mode,
    availableThemes: [],
    setTheme: () => {},
    setMode: () => {},
    previewTheme: () => {},
    clearThemePreview: () => {}
  }
}

// ── UI-кит (упрощённые заглушки) ─────────────────────────────────────────────
export const cn = (...a) =>
  a
    .flat()
    .filter((x) => typeof x === 'string' && x)
    .join(' ')

export const haptic = () => {}

export const icons = new Proxy(
  {},
  {
    get: (_t, name) => {
      if (name === 'then' || typeof name === 'symbol') return undefined
      return (props) => jsx('span', { className: (props && props.className) || '', 'data-icon': String(name), children: '⟳' })
    }
  }
)

export function Button({ variant, className, children, ...rest }) {
  void variant
  return jsx('button', { ...rest, className: cn('mock-btn', className), children })
}

export function Tip({ label, children }) {
  return jsx('span', { title: label, children })
}

const PopoverCtx = createContext({ open: false, setOpen: () => {} })

export function Popover({ open, onOpenChange, children }) {
  return jsx(PopoverCtx.Provider, {
    value: { open: !!open, setOpen: (n) => onOpenChange && onOpenChange(n) },
    children: jsx('span', { style: { position: 'relative', display: 'inline-flex' }, children })
  })
}

export function PopoverTrigger({ children, asChild }) {
  const { open, setOpen } = useContext(PopoverCtx)
  if (!children) return null
  const child = asChild ? children : jsx('button', { type: 'button', children })
  const prev = child.props && child.props.onClick
  return cloneElement(child, {
    onClick: (e) => {
      if (prev) prev(e)
      setOpen(!open)
    }
  })
}

export function PopoverContent({ children, className }) {
  const { open } = useContext(PopoverCtx)
  if (!open) return null
  return jsx('div', {
    className: cn('mock-popover', className),
    'data-testid': 'popover',
    style: {
      position: 'absolute',
      top: 'calc(100% + 6px)',
      left: 0,
      zIndex: 60,
      minWidth: 200,
      background: '#171a20',
      border: '1px solid rgba(255,255,255,.14)',
      borderRadius: 12,
      boxShadow: '0 14px 30px rgba(0,0,0,.55)',
      padding: 6
    },
    children
  })
}
