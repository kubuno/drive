# Kubuno Drive — mobile apps

The mobile clients of the Drive module: **Kubuno Drive** (Android, `com.kubuno.android`), an iOS version to come.

This app used to live in the shared `kubuno/mobile` repository; it moved here in October 2026 with its history.
The libraries every Kubuno app shares (API client, device accounts, UI components, viewers) live in the core
repository, `core/mobile`, and are consumed as published Maven artifacts `com.kubuno.mobile:*`.

## Layout

```
mobile/
  settings.gradle.kts, build.gradle.kts, gradle/   the Gradle root
  common/    the complete app, shared by Android and iOS (Kotlin Multiplatform + Compose Multiplatform, phase 2)
  android/   only what Android does differently, and its entry point; today the whole app (android/app)
  android/sync  the offline sync engine of the app (Room, delta feed, outbox, workers), an Android library
  ios/       only what iOS does differently, and its entry point (phase 2)
```

Today the app is still a plain Android (Jetpack Compose) app, so all of it sits in `android/app`. The conversion
to Kotlin Multiplatform moves the screens, view models and repositories to `common/` and leaves `android/` with
the entry point and the Android-only services; the plan is in `core/mobile/README.md` ("Phase 2").

## Kubuno Drive

A native client for the Kubuno drive module, in the spirit of the Nextcloud mobile app:
browse and manage files, upload and download with resumable chunked transfers, keep files
available offline, and auto-upload your camera roll — all against your own server. It is
offline-first (Room as the UI source of truth), conflict-safe (`If-Match` etags produce
Nextcloud-style conflict copies), and uses idempotent, replayable writes.

Like every other client, it is meant to apply the name rules of `../common/core` (`kubuno-drive-core`), held by the
conformance vectors of `../common/vectors`.

## Build

Requirements: JDK 17+ (21 recommended), the Android SDK (platform 36, build-tools 35) with `ANDROID_HOME` set,
and read access to the Kubuno Maven registry for the shared libraries: a token in your **user** Gradle properties
(`kubunoGitlabToken=…` in `~/.gradle/gradle.properties`, or `KUBUNO_GITLAB_TOKEN`), see `core/mobile/README.md`.

```bash
cd mobile
./gradlew assembleDebug            # debug APK: android/app/build/outputs/apk/debug/
./gradlew test                     # unit tests
./gradlew :app:assembleRelease     # R8-minified release APK (unsigned unless -PkubunoKeystore=… is given)
```

The version of the shared libraries is pinned in `gradle/libs.versions.toml` (`kubunoMobile`). To build against a
core checkout instead (to try a change of the shared libraries before it is published), point Gradle at it:

```bash
./gradlew assembleDebug -Pkubuno.coreMobile=../../core/mobile    # or KUBUNO_CORE_MOBILE=…
```

## Releases

The app is versioned on its own (`versionName` / `versionCode` in `android/app/build.gradle.kts`), independently
of the module's server. A tag `mobile-v<versionName>` on this repository builds the release APK and attaches it to a
release; the module's own `v*` tags keep releasing the server package. The workflow `.github/workflows/mobile.yml`
builds and tests the app on every change under `mobile/`, against the shared libraries checked out from the core at
the tag `mobile-v<kubunoMobile>`.
