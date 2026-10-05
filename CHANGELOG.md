# Changelog

## 1.0.1 — 2026-10-05

- Catalog review fix: raise `requires_hermes` to `>=0.21.4` — the plugin depends on `hermes usage --json`, which shipped in 0.21.4. README and catalog entry synced.

## 1.0.0 — 2026-10-04

First public release.

- **Chip**: pinned glowing limits chip in the status bar and/or title bar (both toggleable; at least one always stays). Collapses into one text line; turns "fiery" (animated glow) when any window drops to ≤10%; countdown and refresh state included.
- **Panel**: windows rendered exactly as the provider reports them (no assumptions about 5h/week/month), remaining %, used, reset in relative time, "Обновить сейчас" + "обновлено HH:MM" + auto-refresh indicator.
- **Pace & forecast**: burn rate (%/h) from local usage history, run-out projection ("исчерпание ~HH:MM" / "до сброса хватит"), idle mode ("без изменений"), sparkline of the window's history.
- **All providers**: expandable list with per-provider remaining numbers; providers without data are shown explicitly ("нет данных").
- **Themes**: inherits the Hermes theme or 12 custom color themes; separate font selector (family + size). All colors theme-aware; accent glow everywhere.
- **Notifications**: threshold alerts (≤10% remaining, once per window period).
- **i18n**: RU/EN follows the app locale.
- **Robustness**: stale-data marker ("≈") with "Нет свежих данных", friendly error/empty states, dedup + retry, 10-minute caching to keep CLI spawns cheap.
- Developed and fully tested on Windows 10; macOS/Linux expected to work — reports welcome.
