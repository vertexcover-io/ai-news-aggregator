# Mobile Dispatch App (`@newsletter/mobile`)

**Date:** 2026-06-22
**Status:** Initial scaffold

## Goal

A React Native (Expo) app for Android & iOS — "AgentLoop Dispatch" — that lets an operator
**share any link** (via the OS share sheet) or paste a URL so it becomes a candidate in the next
newsletter run. The mobile counterpart to the Chrome extension (`@newsletter/extension`). Three
screens: **Login → Add URL → Confirmation**.

## Key decision: reuse the extension API, no backend change

The app talks to the SAME isolated bearer-token path the extension uses:

- `POST /api/extension/login` → `{ token, expiresAt, user }` (or 401 / 403 `select_tenant`)
- `POST /api/extension/submissions` (Bearer) → `{ id, url, title, sourceType, alreadyExisted }`

The token is the `ext|`-namespaced HMAC (embeds `{ userId, tenantId, role }`), so submissions are
tenant-scoped and land in `raw_items` as `sourceType: "manual"` — identical to the extension.

**CORS is a non-issue.** The API's CORS gate is scoped to `chrome-extension://` origins, but CORS
is a browser security mechanism. Native iOS/Android `fetch` sends no `Origin` and doesn't enforce
`Access-Control-Allow-Origin`, so the request succeeds unchanged. No API edit was needed.

## Stack

- **Expo (managed)** + EAS — fastest path; first-class share-intent, secure store, builds.
- `expo-share-intent` — Android intent filter (`text/*`) + iOS Share Extension via config plugin.
- `expo-secure-store` — bearer token in Keychain / Keystore (the `chrome.storage.local` analogue;
  never plaintext AsyncStorage).
- Plain state-machine navigation in `App.tsx` (no router needed for 3 screens).
- `EXPO_PUBLIC_API_BASE` selects the API origin per EAS profile (default = production).

## Monorepo integration

- Lives at `packages/mobile` as `@newsletter/mobile`, mirroring `packages/extension`.
- **Own toolchain.** Excluded from the repo-root ESLint flat config (which is
  `strictTypeChecked` + Node-oriented and can't type-check RN/JSX). Uses `eslint-config-expo` +
  `expo/tsconfig.base`. `turbo lint` / `turbo typecheck` still pick up its package scripts.
- `metro.config.js` tuned for pnpm (watch repo root, dual `nodeModulesPaths`,
  `disableHierarchicalLookup`). `ios/` + `android/` are prebuild-generated and gitignored.

## Constraints / follow-ups

- Share intent + secure store require a **dev build** (not Expo Go).
- Placeholder app icons/splash (solid slate) — swap real branding before store submission.
- Native binaries can't be produced in the headless CI container; build/run locally via EAS or
  `expo run:*`.
- Possible follow-ups: token-expiry handling UX, share-multiple-URLs, biometric unlock,
  remembered email.
