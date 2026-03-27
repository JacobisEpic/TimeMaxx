<p align="center">
  <img src="./TimeMaxx-icon.png" alt="TimeMaxx icon" width="160" />
</p>

<h1 align="center">TimeMaxx</h1>

<p align="center">
  A local-first time-tracking app for planning your day, logging what actually happened, and reviewing execution over time.
</p>

<p align="center">
  <a href="https://apps.apple.com/us/app/timemaxx/id6760919064">Download on the App Store</a>
  ·
  <a href="https://jacobchin.org/timemaxx/">Website</a>
  ·
  <a href="./legal/privacy-policy.md">Privacy Policy</a>
  ·
  <a href="./legal/support.md">Support</a>
</p>

## Overview
TimeMaxx is built around a simple workflow:

1. Plan your day on a visual timeline.
2. Record what you actually did.
3. Compare intention against execution.

The app is intentionally local-first. Core data stays on-device in SQLite, with no account system or backend required for timeline data.

## Features
- Visual planned and done timelines for the same day
- Recurring blocks with configurable repeat rules
- Category colors, labels, and visibility controls
- Inline completion flow that links finished work back to the original plan
- Day-level and full-data export/import flows for backup and device transfer
- Month view with execution score tracking
- On-device persistence with Expo SQLite

## Tech Stack
- Expo
- React Native
- TypeScript
- Expo Router
- Expo SQLite
- Node's built-in test runner for focused logic tests

## Project Structure
- `app/` route entry points and navigation
- `src/screens/` screen-level UI
- `src/components/` reusable timeline and editor components
- `src/storage/` SQLite persistence and first-launch seed data
- `src/utils/` recurrence, time, date, and scoring logic
- `test/` unit tests for core logic
- `docs/` development notes and App Store submission docs
- `legal/` privacy policy, terms, and support content

## Running Locally
```bash
npm install
npx expo start
```

For an iPhone simulator build:

```bash
npm run ios
```

## Quality Checks
```bash
npm run release:check
```

## Docs
- [App Store submission checklist](./docs/app-store/submission-checklist.md)
- [App Store review notes template](./docs/app-store/review-notes-template.md)
- [Exhaustive pre-submit checklist](./docs/app-store/exhaustive-pre-submit-checklist.md)
- [iPhone dev install guide](./docs/development/iphone-dev-install.md)
- [Privacy policy](./legal/privacy-policy.md)
- [Terms of service](./legal/terms-of-service.md)
- [Support](./legal/support.md)
