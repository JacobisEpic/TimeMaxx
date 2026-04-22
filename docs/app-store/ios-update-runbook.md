# iOS App Store Update Runbook

Last updated: April 22, 2026 (America/New_York)

This is the concrete release path for shipping an update of the existing App Store app.

## Current baseline

- Live App Store version confirmed on April 22, 2026 via Apple's public lookup API: `1.0`
- Repo marketing version is now staged at: `1.0.1`
- Local Xcode project marketing version is now staged at: `1.0.1`
- Local Xcode project build number is now staged at: `2`
- Apple app ID / App Store Connect app ID: `6760919064`
- Bundle ID: `com.timemaxx.app`

## Preferred path: local Xcode archive

This workspace already has a local `ios/` project, so use Xcode Organizer for the update instead of EAS.

## 1) Final local validation

```bash
npm install
npm run release:check
```

## 2) Open the workspace in Xcode

```bash
open ios/TimeMaxx.xcworkspace
```

In Xcode:

- select the `TimeMaxx` scheme
- choose `Any iOS Device (arm64)` as the run destination
- confirm Signing is using the correct Apple team
- confirm version is `1.0.1` and build is `2`

## 3) Archive and upload

In Xcode:

- `Product -> Archive`
- wait for Organizer to open
- validate the archive
- click `Distribute App`
- choose `App Store Connect`
- upload the build to the existing app

## 4) Finish App Store Connect metadata

- Select or create version `1.0.1`
- Attach the new processed build
- Paste the latest review notes from [review-notes-template.md](./review-notes-template.md)
- Verify screenshots and listing copy still match the shipped UI
- Confirm the privacy policy URL matches exactly
- Submit for review

## Versioning rules for the next update

- Customer-facing version: update `app.json`, `package.json`, and the local Xcode project marketing version together
- iOS build number: increment `CURRENT_PROJECT_VERSION` in the local Xcode project before each new upload

## Export compliance

`app.json` now sets `ITSAppUsesNonExemptEncryption` to `false`, which matches the current app scope and reduces export-compliance friction during submission.

## Apple tooling cutoff

As of April 22, 2026, Apple’s next submission tooling cutoff is still upcoming:

- If you upload before April 28, 2026, your current toolchain may still be accepted
- If you upload on or after April 28, 2026, build with Xcode 26+ and the iOS 26 SDK
