# Exhaustive App Store Pre-Submit Checklist (iOS)

Last updated: March 18, 2026 (America/New_York)

Use this list right before shipping `TimeMaxx` to the App Store.

## 0) Release freeze and branch hygiene

- [ ] Freeze feature scope for this release (bug fixes only).
- [ ] Ensure working tree is clean or intentionally scoped for release.
- [ ] Confirm release owner and reviewer.
- [ ] Confirm target release date/time and fallback date.

## 1) Apple account and business readiness

- [ ] Apple Developer Program membership is active.
- [ ] Account Holder has accepted the latest agreements in App Store Connect.
- [ ] Paid Apps Agreement is active (if monetization now or planned soon).
- [ ] Tax forms are completed in App Store Connect.
- [ ] Banking details are completed in App Store Connect.
- [ ] EU DSA trader status is declared (required even if not distributing in EU).
- [ ] If trader in EU, trader contact info is verified and published correctly.

## 2) Build toolchain requirements (date-sensitive)

- [ ] Submission timing confirmed against Apple upcoming requirements.
- [ ] If uploading on or after April 28, 2026, build with Xcode 26+ and iOS 26+ SDK.
- [ ] Xcode install is up to date enough for current App Store Connect upload rules.

## 3) App identity, versioning, signing

- [ ] Bundle ID is correct: `com.timemaxx.app`.
- [ ] Display name is correct: `TimeMaxx`.
- [ ] Marketing version (`CFBundleShortVersionString`) is set for this release.
- [ ] Build number (`CFBundleVersion`) incremented from prior upload.
- [ ] Automatic signing works with the correct Apple team.
- [ ] Archive builds without signing/provisioning errors.

## 4) Local technical quality gates (repo-specific)

- [ ] Install deps: `npm install`.
- [ ] Run lint/type/prebuild checks: `npm run release:check`.
- [ ] Run tests: `npm test`.
- [ ] Smoke run on physical iPhone in Release configuration.
- [ ] Smoke run on iPad (app supports tablet).
- [ ] Validate cold start, background/foreground, and app relaunch behavior.
- [ ] Validate no crash in first-launch path.

## 5) Functional QA pass (user-visible behavior)

- [ ] Create/edit/delete plan and done blocks.
- [ ] Confirm compare/plan/done views work.
- [ ] Confirm plan checkbox creates and links done block correctly.
- [ ] Confirm overlap validation/error handling works.
- [ ] Confirm insights totals and category breakdowns look correct.
- [ ] Confirm month view and day navigation work.
- [ ] Confirm share summary and import summary flows work.
- [ ] Confirm category create/edit/hide/delete flows work.
- [ ] Confirm reset-all-data works and app remains usable.
- [ ] Run fresh install test.
- [ ] Run upgrade test from previous build.
- [ ] Run offline/poor-network behavior check (even local-first app).

## 6) Privacy, legal, and policy compliance

- [ ] Privacy policy URL is live and public.
- [ ] Terms URL is live and public.
- [ ] Support URL is live and public.
- [ ] URLs match app and App Store Connect values exactly.
- [ ] Support inbox is monitored: `jacobchin.builds@gmail.com`.
- [ ] App Privacy questionnaire completed in App Store Connect.
- [ ] App Privacy answers match actual data practices in code and SDKs.
- [ ] Export compliance questions answered for the build.
- [ ] If needed, encryption documentation uploaded and approved.
- [ ] Age rating questionnaire completed under the current rating system.
- [ ] Content rights confirmed for all assets (icons, fonts, images, copy).
- [ ] No placeholder text, dead links, or fake/incomplete flows.

## 7) App Store metadata and assets

- [ ] App name/subtitle finalized.
- [ ] Description finalized (customer-facing, accurate, no roadmap promises).
- [ ] Keywords finalized (no competitor names).
- [ ] Support URL set.
- [ ] Marketing URL set (optional but recommended).
- [ ] Copyright field set.
- [ ] Category and subcategory selected correctly.
- [ ] Age rating appears and is not Unrated.
- [ ] Pricing and availability territories configured.
- [ ] Localizations enabled only where metadata/support is ready.
- [ ] At least one screenshot uploaded per required device class.
- [ ] Screenshots represent real current UI from this exact build.
- [ ] Optional app preview video uploaded (if used).

## 8) App Review package quality

- [ ] App Review contact name/email/phone filled in.
- [ ] App Review notes added with clear 3-step test flow.
- [ ] Notes explain there is no login required.
- [ ] Notes call out anything non-obvious (permissions, edge cases).
- [ ] Optional short demo video link included.

## 9) Archive and upload (Xcode)

- [ ] In Xcode, set scheme to `Any iOS Device (arm64)` for archive.
- [ ] Create archive from Release configuration.
- [ ] Validate archive in Organizer (no critical warnings/errors).
- [ ] Upload to App Store Connect from Organizer.
- [ ] Wait for build processing to complete.
- [ ] Resolve any App Store Connect processing warnings before submission.

## 10) Attach build and submit in App Store Connect

- [ ] Create/select correct app version in App Store Connect.
- [ ] Attach the intended processed build.
- [ ] Re-verify all required fields are complete (no missing sections).
- [ ] Click `Add for Review`.
- [ ] Click `Submit for Review`.
- [ ] Confirm final status transitions to `Waiting for Review`.

## 11) After submission (do not skip)

- [ ] Monitor App Review messages multiple times daily.
- [ ] Respond quickly with concrete reproduction steps if questioned.
- [ ] If rejected, document root cause and required fix before resubmitting.
- [ ] Keep legal/support pages online and unchanged during review window.

## 12) Repo-specific values to verify each release

- [ ] `app.json` version and iOS bundle identifier are correct.
- [ ] `src/constants/releaseMetadata.ts` URLs are production-ready:
  - [ ] `https://timemaxx.app/privacy-policy`
  - [ ] `https://timemaxx.app/terms-of-service`
  - [ ] `https://timemaxx.app/support`
- [ ] Existing docs are current:
  - [ ] `docs/app-store/submission-checklist.md`
  - [ ] `docs/app-store/review-notes-template.md`
  - [ ] `CUSTOMER-UAT.md`

## 13) Optional but recommended risk controls

- [ ] Run one TestFlight internal round before App Review.
- [ ] Keep a rollback fix branch ready (`hotfix/*`) in case of rejection issues.
- [ ] Prepare canned review-response templates for common rejection categories.
