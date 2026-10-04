# Catalog submission — `plugin-catalog/usage-flame.yaml`

Adds one entry to the Hermes plugin catalog.

```yaml
name: usage-flame
repo: https://github.com/maxshafransky-a11y/hermes-usage-flame
sha: "<release SHA>"   # v1.0.0
tier: community
```

## What the plugin does

A pinned, glowing **limits chip** (status bar and/or title bar) plus a fire-themed **panel** showing live subscription-quota windows for every provider Hermes reports usage for (`hermes usage --json` — the same source as `/usage`; provider list from `model.options`).

- **Windows as-is.** No assumptions about 5h/week/month: whatever window set a provider reports is rendered as-is; missing data is labelled, never faked.
- **Pace & forecast.** Burn rate (%/h) from local history: «до сброса хватит», «исчерпание ~HH:MM», idle «без изменений» + sparkline. History lives in plugin storage — no network.
- **Theming.** Inherits the Hermes theme or 12 built-in color themes; font family/size pickers; every color theme-aware; ≤10% turns fiery (animated glow) + threshold notifications.
- **Read-only and local.** No credentials read or stored; nothing leaves the machine. Zero dependencies — one ESM file, no build step.
- **Verified on Windows 10** (macOS/Linux expected to work). Ships with its full QA stand (`test/`) — scripted end-to-end pass across all themes/states (85/85 checks) plus a theme-contrast audit.

## Submission checklist

- [x] Owner-submitted (`maxshafransky-a11y` owns the repo)
- [x] Public repository, MIT license
- [x] `hermes plugins validate` passes on the pinned commit
- [x] Windows-compatible (no platform-specific code paths)
