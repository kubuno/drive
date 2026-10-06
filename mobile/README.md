# Kubuno Drive — mobile apps

Reserved for the mobile clients of the drive module, organised like the desktop app (`../desktop`):

```
mobile/
  common/    the complete mobile app, shared by Android and iOS
  android/   only what Android does differently, and its entry point
  ios/       only what iOS does differently, and its entry point
```

Today the Android app of Drive lives in the `kubuno/mobile` repository (`app-drive`); it moves here when the mobile
apps follow the one-repository-per-module organisation. Like every other client, it applies the name rules of
`../common/core` (`kubuno-drive-core`), held by the conformance vectors of `../common/vectors`.
