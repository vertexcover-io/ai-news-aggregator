# AgentLoop Dispatch (mobile)

A small Expo / React Native app for Android & iOS. Log in once, then **share any link**
from any app (browser, Twitter/X, Reddit, mail…) straight into tomorrow's newsletter — or
paste a URL by hand. Three screens: **Login → Add URL → Confirmation**.

It reuses the exact same backend the Chrome extension uses: the `ext|`-namespaced bearer-token
path `POST /api/extension/login` + `POST /api/extension/submissions`. Submissions land in
`raw_items` as `sourceType: "manual"`, tenant-scoped from the token, and compete in the next run.

> **No backend change required.** Native iOS/Android `fetch` is not subject to CORS, so the
> API's `chrome-extension://`-scoped CORS gate doesn't block these requests.

## Prerequisites

- Node + pnpm (workspace install: run `pnpm install` at the repo root)
- An [Expo](https://expo.dev) account + `eas-cli` (`npm i -g eas-cli`) for cloud builds, **or**
  Xcode (iOS) / Android Studio (Android) for local `expo run:*` builds.
- Share-to-app and secure token storage require a **development build** — they do **not** work in
  Expo Go.

## Configure the API origin

The API base is read from `EXPO_PUBLIC_API_BASE` at build time (default:
`https://agentloop.vertexcover.io`). Per-profile values live in `eas.json`. For local dev against
a machine running the API, point it at your LAN IP (not `localhost` — that's the phone):

```bash
EXPO_PUBLIC_API_BASE=http://192.168.1.50:3000 pnpm --filter @newsletter/mobile start
```

## Run it locally (dev build)

```bash
# from repo root
pnpm install

# generate native projects + build/run on a connected device or simulator
pnpm --filter @newsletter/mobile ios       # or: android
```

`expo run:ios` / `run:android` runs `expo prebuild` (creating the gitignored `ios/` + `android/`
folders) and builds a dev client that includes the share extension and secure store.

## Build for distribution (EAS)

```bash
cd packages/mobile
eas login
eas build:configure
eas build --profile preview --platform android   # internal APK
eas build --profile preview --platform ios        # internal / TestFlight
# stores:
eas build --profile production --platform all
eas submit --profile production --platform ios     # / android
```

## How "share a link" works

- **Android** — an intent filter (`text/*`) registers the app in the system share sheet. Tap
  Share in any app → **AgentLoop Dispatch** → the URL is pre-filled → confirm.
- **iOS** — a Share Extension (configured by the `expo-share-intent` plugin) does the same from
  the iOS share sheet.

`src/App.tsx` reads the shared payload via `useShareIntentContext()`, extracts the URL
(`shareIntent.webUrl`, falling back to the first URL in `shareIntent.text`), and pre-fills the
add form. After a successful submit the share intent is reset.

## Branding

`assets/icon.png`, `adaptive-icon.png`, and `splash.png` are solid-slate placeholders — swap in
real artwork before shipping to the stores.
