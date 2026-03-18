# App Store Submission Checklist Status

Last updated: March 18, 2026

## Legend
- COMPLETE: Implemented in this repository or confirmed in app behavior.
- N/A: Not applicable to current app scope.
- MANUAL: Requires App Store Connect, legal hosting, business account, or release process work.

## 1) Unfinished flows
- COMPLETE: No "coming soon" or fake screens detected.
- COMPLETE: Primary flows (timeline, create/edit/delete blocks, settings) are functional.
- COMPLETE: Real states exist (empty day, error alerts, loading around save actions).
- COMPLETE: Main interactive buttons have handlers.

## 2) Legal pages (public URLs)
- COMPLETE: Privacy Policy exists in [legal/privacy-policy.md](../../legal/privacy-policy.md).
- COMPLETE: Terms of Service exists in [legal/terms-of-service.md](../../legal/terms-of-service.md).
- COMPLETE: Legal pages are linked in-app via Settings -> Legal & Support.
- MANUAL: Add Privacy Policy public URL in App Store Connect.
- COMPLETE: Support page exists in [legal/support.md](../../legal/support.md).
- COMPLETE: Support email is configured to `jacobchin.builds@gmail.com` in app and legal docs.
- COMPLETE: Privacy policy describes data collection, storage, and deletion.

## 3) Business setup
- MANUAL: Small Business Program enrollment.
- MANUAL: Paid Apps Agreement status.
- MANUAL: Tax forms status.
- MANUAL: Banking status.
- MANUAL: Export compliance answers in App Store Connect.

## 4) App listing setup
- MANUAL: Age rating questionnaire.
- MANUAL: Pricing and availability territories.

## 5) Permissions + privacy UX
- COMPLETE: No sensitive permission prompts are currently implemented.
- COMPLETE: No location usage in code.
- COMPLETE: No unnecessary permission prompts on first launch.
- N/A: ATT (no cross-app tracking present).
- MANUAL: App Privacy nutrition label in App Store Connect must match implementation.
- N/A: User Privacy Choices URL (no privacy choice backend currently).

## 6) Subscriptions / IAP
- N/A: No IAP/subscription features in this app version.

## 7) Accounts
- N/A: No user account creation/login system in current app version.

## 8) Community / Chat
- N/A: No user-generated social/community/chat features.

## 9) Store listing assets
- MANUAL: Store description first lines.
- MANUAL: Real screenshots for core flows.
- COMPLETE: No competitor mentions found in-app.
- MANUAL: Keywords selection in App Store Connect.
- MANUAL: Promotional text (optional).

## 10) Localization
- MANUAL: Confirm only intended locales are enabled in App Store Connect.

## 11) QA
- COMPLETE: Core flow testing guidance captured in review notes template.
- MANUAL: Run fresh install + upgrade install checks before submit.
- MANUAL: Run slow/offline behavior checks on target devices.
- MANUAL: Run iPhone + iPad pass and capture evidence.
- MANUAL: Final crash/logic pass on release build.

## 12) Content + IP
- MANUAL: Confirm all visual/content assets are owned or licensed.
- COMPLETE: No misleading hidden UI flow observed in code.
- N/A: No AI/LLM features in current app version.

## 13) Reviewer access
- COMPLETE: [review-notes template](./review-notes-template.md) includes short literal 3-step instructions.
- N/A: Test account not needed without auth.
- MANUAL: Add optional short recording link if desired.
- COMPLETE: No special hardware/location constraints.

## 14) Final submit pass
- MANUAL: Validate listing copy/screenshots match the exact build submitted.
- MANUAL: Validate all public listing URLs are live and non-404.
- COMPLETE: No placeholder text or fake flows detected in-app.
- COMPLETE: Core use-case can be completed quickly.
- MANUAL: Set up rapid response process for App Review messages.

## Remaining actions requiring your input
1. Verify public legal URLs resolve without 404 and are submitted in App Store Connect.
2. Verify support inbox monitoring process is active for App Review and production.
3. Complete App Store Connect configuration items (privacy label, age rating, pricing, agreements, tax, banking, export compliance).
4. Produce and upload final App Store listing copy + screenshots.
