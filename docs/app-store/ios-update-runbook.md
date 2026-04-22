# iOS App Store Update Runbook

Last updated: April 22, 2026 (America/New_York)

This is the concrete release path for shipping an update of the existing App Store app.

## Current baseline

- Live App Store version confirmed on April 22, 2026 via Apple's public lookup API: `1.0`
- Repo marketing version is now staged at: `1.0.1`
- Apple app ID / App Store Connect app ID: `6760919064`
- Bundle ID: `com.timemaxx.app`

## Preferred path: EAS Build + EAS Submit

This repo does not keep a committed `ios/` project, so EAS is the cleanest repeatable update path.

## 1) Final local validation

```bash
npm install
npm run release:check
```

## 2) Build the store binary

```bash
npm run release:ios
```

What this now does:

- runs local release checks first
- creates an iOS store build with the `production` EAS profile
- auto-increments the iOS build number remotely so you do not reuse a prior App Store build number

## 3) Submit the processed build

After the EAS build finishes successfully:

```bash
npm run release:ios:submit
```

This submits the latest processed iOS build to the existing App Store Connect app `6760919064`.

## 4) Finish App Store Connect metadata

- Select or create version `1.0.1`
- Attach the new processed build
- Paste the latest review notes from [review-notes-template.md](./review-notes-template.md)
- Verify screenshots and listing copy still match the shipped UI
- Confirm the privacy policy URL matches exactly
- Submit for review

## Versioning rules for the next update

- Customer-facing version: update `app.json` and `package.json` together
- iOS build number: do not hand-edit it in this repo for the EAS production flow; `eas.json` now auto-increments it remotely

## Export compliance

`app.json` now sets `ITSAppUsesNonExemptEncryption` to `false`, which matches the current app scope and reduces export-compliance friction during submission.

## Apple tooling cutoff

As of April 22, 2026, Apple’s next submission tooling cutoff is still upcoming:

- If you upload before April 28, 2026, your current toolchain may still be accepted
- If you upload on or after April 28, 2026, build with Xcode 26+ and the iOS 26 SDK
