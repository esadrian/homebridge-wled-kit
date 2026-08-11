# CLAUDE.md — Project instructions

## Required version bump before install

Before building and installing into Homebridge, **always bump the package version** in `package.json`.

Homebridge caches the installed package by version. If the version does not change, the browser may keep serving the previous build even when the files on disk are different.

### Required steps when testing changes

1. Bump the version in `package.json` (e.g. `3.2.0-local.1` → `3.2.0-local.2`)
2. Build:
   ```bash
   npm run build
   ```
3. Pack and install:
   ```bash
   npm pack && sudo hb-service install homebridge-wled-kit-<new-version>.tgz
   ```
4. Restart Homebridge and hard-reload the browser to verify the changes.

> Without the version bump, you cannot reliably confirm that your local changes are active in the UI.
