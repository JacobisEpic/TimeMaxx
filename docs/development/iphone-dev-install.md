# Install a Dev Build on Your Personal iPhone

This guide explains the general process for installing a local development build from your Mac onto your iPhone.

## Prerequisites

- A Mac with Xcode installed (latest stable version recommended)
- An iPhone with a USB cable (or trusted wireless debugging setup)
- Your Apple ID signed into Xcode (`Xcode -> Settings -> Accounts`)
- Project dependencies installed (`npm install`)

## 1. Open the iOS project in Xcode

- Open the iOS workspace if one exists (`*.xcworkspace`).
- If no workspace exists, open the iOS project file (`*.xcodeproj`).

Note: For React Native/Expo projects with CocoaPods, use the workspace.

## 2. Connect and trust your iPhone

- Connect your iPhone to your Mac.
- Unlock the phone and tap `Trust This Computer` if prompted.
- In Xcode, select your iPhone as the run destination.

## 3. Configure signing

In `Target -> Signing & Capabilities`:

- Enable `Automatically manage signing`
- Select your personal/team Apple ID
- Ensure bundle identifier is valid and unique for your team

## 4. Enable Developer Mode (one-time on device)

On iPhone:

- `Settings -> Privacy & Security -> Developer Mode -> On`
- Device will restart

## 5. Build and run from Xcode

- Press `Cmd+R` (Run)
- Wait for first install/build to complete
- Open the app on your iPhone

## 6. Start Metro (debug JavaScript bundler) when needed

For React Native/Expo debug builds, run:

```bash
npm run start
```

Why: Debug builds usually load JavaScript from Metro. Without it, the app may fail to load the bundle.

If you run a Release build/TestFlight build, Metro is not required.

## 7. Debug vs Release on a physical iPhone

- `Debug` builds do not embed the JavaScript bundle for this app. They expect Metro to be running on your Mac.
- `Release` builds embed `main.jsbundle` and can launch without Metro.

If you see logs like:

- `Build/Products/Debug-iphoneos/...`
- `Could not connect to the server`
- `http://<your-mac-ip>:8081/status`
- `No script URL provided. Make sure the packager is running`

then the app is usually not "broken". You installed a `Debug` build and the phone cannot reach Metro.

Use one of these paths:

- For active development: run `npm run start` and keep the Mac and iPhone on the same network, then launch the `Debug` build again.
- For standalone device testing: in Xcode set `Product -> Scheme -> Edit Scheme -> Run -> Build Configuration -> Release`, then run on the iPhone again.
- For App Store submission: use `Product -> Archive`. Archive uploads are `Release` builds and do not require Metro.

## Common statuses and troubleshooting

- `Copying shared cache symbols ...`
  - This is normal during first-time setup or after iOS/Xcode updates.
  - It can take several minutes.
- Signing errors
  - Re-select your team in Signing settings.
  - Confirm bundle identifier is unique under your team.
- Device not available in Xcode
  - Keep phone unlocked and replug cable.
  - Confirm trust prompt was accepted.
- App won’t launch in debug
  - Start Metro (`npm run start`) and run again.

## Optional: Run from terminal (project-dependent)

Many Expo projects support:

```bash
npm run ios -- --device
```

This still depends on correct Xcode signing/device setup.
