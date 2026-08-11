<DIV ALIGN="CENTER" STYLE="text-align:center">
   
# Simpler WLED for Homebridge
[![Version](https://img.shields.io/npm/v/homebridge-simpler-wled?color=%230559C9&label=Latest%20Version&logo=data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCEtLSBHZW5lcmF0ZWQgYnkgUGl4ZWxtYXRvciBQcm8gMy43LjEgLS0+Cjxzdmcgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiB2aWV3Qm94PSIwIDAgMTYgMTYiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgICA8cGF0aCBpZD0iUGF0aCIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9Im5vbmUiIGQ9Ik0gNyAxNiBMIDcgMTMgTCA2IDEzIEwgNiAxNiBMIDcgMTYgWiBNIDcgMTIgTCA3IDEzIEwgOCAxMyBMIDggMTIgTCA3IDEyIFogTSAxMiA2IEwgMTIgMTAgTCAxMyAxMCBMIDEzIDExIEwgMTIgMTEgTCAxMiAxMiBMIDExIDEyIEwgMTEgMTEgTCAxMCAxMSBMIDEwIDE1IEwgOSAxNSBMIDkgMTEgTCA3IDExIEwgNyAxMiBMIDYgMTIgTCA2IDExIEwgNSAxMSBMIDUgMTIgTCA0IDEyIEwgNCAxMyBMIDIgMTMgTCAyIDEyIEwgMSAxMiBMIDEgMTAgTCAwIDEwIEwgMCA5IEwgMSA5IEwgMSAxMCBMIDIgMTAgTCAyIDEyIEwgNCAxMiBMIDQgMTEgTCAzIDExIEwgMyAxMCBMIDQgMTAgTCA0IDMgTCA1IDMgTCA1IDIgTCA2IDIgTCA2IDEgTCAxMCAxIEwgMTAgMiBMIDExIDIgTCAxMSAzIEwgMTIgMyBMIDEyIDQgTCAxMSA0IEwgMTEgNiBMIDEyIDYgWiBNIDEwIDQgTCAxMCAzIEwgMTEgMyBMIDExIDQgTCAxMCA0IFogTSAxMCA0IEwgMTAgNiBMIDkgNiBMIDkgNCBMIDEwIDQgWiBNIDE0IDEyIEwgMTMgMTIgTCAxMyAxMyBMIDE1IDEzIEwgMTUgMTAgTCAxNCAxMCBMIDE0IDEyIFogTSAxNSAxMCBMIDE2IDEwIEwgMTYgOSBMIDE1IDkgTCAxNSAxMCBaIE0gOCA4IEwgOSA4IEwgOSA3IEwgOCA3IEwgOCA4IFogTSA2IDYgTCA1IDYgTCA1IDQgTCA2IDQgTCA2IDMgTCA3IDMgTCA3IDQgTCA4IDQgTCA4IDYgTCA3IDYgTCA3IDQgTCA2IDQgTCA2IDYgWiIvPgo8L3N2Zz4K&style=for-the-badge)](https://www.npmjs.com/package/homebridge-simpler-wled)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

</DIV>

A Homebridge plugin for controlling WLED-powered LED strips through HomeKit.

## What is WLED?

[WLED](https://kno.wled.ge/) is an open-source firmware for ESP8266 and ESP32 microcontrollers that allows you to control NeoPixel (WS2812B) and other LED strips over WiFi. It provides a user-friendly web interface and extensive API for controlling your LEDs.

## Features

- Control WLED devices through HomeKit
- On/Off, Brightness, Color (RGB/HSV), and Color Temperature (CCT) control
- Integrated preset selector (TV-style input selector) for easy access to saved WLED presets
- **Nightlight timers** — per-device timer switches that activate WLED's built-in nightlight fade-off
- **HyperHDR integration** — sync power on/off and brightness to a HyperHDR instance, exposed as a Switch or Outlet accessory
- **Interactive Discovery UI** — scan your network for WLED devices and add them with one click
- Single-accessory mode: Light + Preset selector in one HomeKit accessory
- Manual configuration for advanced setups
- Real-time updates via WebSockets (with exponential-backoff reconnection)
- Fallback to HTTP polling for older firmware

## Installation

### Prerequisites

- [Homebridge](https://github.com/homebridge/homebridge/wiki) v1.3.0 or higher
- Node.js v14.0.0 or higher
- WLED firmware v0.13+ (recommended for WebSocket support)

### Installation Steps

1. **Install Homebridge** if you haven't already using the [official instructions](https://github.com/homebridge/homebridge/wiki)
2. **Install Homebridge Config UI X** (if not already installed) - highly recommended for the interactive discovery UI
3. **Install this plugin** using one of these methods:
   - Via Homebridge Config UI X: Search for "Simpler WLED" in the Plugins tab and click Install
   - Via npm: `npm install -g homebridge-simpler-wled`
4. **Configure the plugin** using the methods described below
5. **Restart Homebridge**

## Configuration

### Quick Start with Discovery UI (Recommended)

If you're using [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x), the easiest way to set up your WLED devices is through the interactive discovery interface:

1. Navigate to the **Plugins** tab in Homebridge Config UI X
2. Find **Simpler WLED** and click **Settings**
3. **Use the Discovery UI** to find WLED devices on your network:
   - Click "Start Discovery" to scan for devices
   - View device details (IP, version, MAC address, LED count)
   - Click "Add to Configuration" to automatically add devices
4. Configure default settings for your devices (optional)
5. Click **Save** to apply your changes
6. Restart Homebridge

See [UI_DISCOVERY_GUIDE.md](./UI_DISCOVERY_GUIDE.md) for detailed information about the discovery interface.

### Manual Configuration

You can also manually configure devices by editing your Homebridge `config.json` file directly. Here's a complete example with all available options:

#### Minimal Configuration

The simplest configuration - just add devices manually:

```json
{
  "platform": "Simpler WLED",
  "name": "Simpler WLED",
  "manualDevicesSection": {
    "devices": [
      {
        "name": "Living Room LEDs",
        "host": "192.168.1.100"
      }
    ]
  }
}
```

#### Full Configuration Example

Complete configuration showing all available options:

```json
{
  "platform": "Simpler WLED",
  "name": "Simpler WLED",
  "logLevel": "info",
  "tvNameSuffix": "Presets",
  "customInputLabel": "Custom",
  "autoStopDiscoveryWhenAllConfigured": true,
  "defaultSettingsSection": {
    "defaultUsePresetService": true,
    "defaultUseWebSockets": true
  },
  "manualDevicesSection": {
    "nightlight": {
      "enabled": false,
      "timers": [
        { "name": "15 min", "seconds": 900 },
        { "name": "30 min", "seconds": 1800 }
      ]
    },
    "devices": [
      {
        "name": "Living Room LEDs",
        "host": "192.168.1.100",
        "port": 80,
        "enabled": true,
        "deviceSettings": {
          "usePresetService": true,
          "singleAccessoryWithTV": false,
          "useWebSockets": true,
          "enabledPresets": ["1", "2", "3"],
          "nightlight": {
            "enabled": true,
            "timers": [
              { "name": "15 min", "seconds": 900 },
              { "name": "30 min", "seconds": 1800 }
            ]
          },
          "hyperHDR": {
            "enabled": true,
            "host": "192.168.1.11",
            "port": 8090,
            "component": "LEDDEVICE",
            "token": "",
            "serviceType": "Switch",
            "switchName": "HyperHDR"
          }
        }
      }
    ]
  }
}
```

### Platform Configuration Options

These settings apply to the entire platform:

| Property | Type | Description | Default | Required |
|----------|------|-------------|---------|----------|
| `platform` | string | Must be `"Simpler WLED"` | - | **Yes** |
| `name` | string | Name of the platform in Homebridge | `"Simpler WLED"` | **Yes** |
| `logLevel` | string | Logging level: `"error"`, `"warn"`, `"info"`, or `"debug"` | `"info"` | No |
| `autoStopDiscoveryWhenAllConfigured` | boolean | In the Custom UI Discovery tab, automatically stop discovery once all discovered devices are already configured | `true` | No |
| `tvNameSuffix` | string | Suffix appended to the TV/preset accessory name | `"Presets"` | No |
| `customInputLabel` | string | Label shown for the manual/no-preset input (Identifier `0`) in the TV input list | `"Custom"` | No |

### Default Settings Section

Settings in `defaultSettingsSection` apply to devices added through the Discovery UI:

| Property | Type | Description | Default | Required |
|----------|------|-------------|---------|----------|
| `defaultUsePresetService` | boolean | Add preset controls for discovered devices | `true` | No |
| `defaultUseWebSockets` | boolean | Use WebSockets for discovered devices | `true` | No |

### Manual Device Configuration

Devices in `manualDevicesSection.devices` array support these properties:

| Property | Type | Description | Default | Required |
|----------|------|-------------|---------|----------|
| `name` | string | Display name for the device in HomeKit | - | **Yes** |
| `host` | string | IP address or hostname of the WLED device | - | **Yes** |
| `port` | integer | HTTP port of the WLED device | `80` | No |
| `enabled` | boolean | Enable/disable device without removing from config | `true` | No |

#### Device Settings

Settings in `deviceSettings` object control individual device behavior:

| Property | Type | Description | Default | Required |
|----------|------|-------------|---------|----------|
| `usePresetService` | boolean | Add preset selector controls | `true` | No |
| `singleAccessoryWithTV` | boolean | Expose Light + Presets as a single HomeKit accessory. Requires restart; HomeKit may cache old accessories | `false` | No |
| `useWebSockets` | boolean | Use WebSockets for real-time updates (requires WLED v0.13+) | `true` | No |
| `enabledPresets` | array | Array of preset IDs to expose (e.g., `["1", "2", "3"]`). Leave empty to show all. Configure via UI. | `[]` | No |
| `nightlight` | object | Per-device nightlight timer settings — see [Nightlight Timers](#nightlight-timers) | - | No |
| `hyperHDR` | object | HyperHDR sync settings — see [HyperHDR Integration](#hyperhdr-integration) | - | No |

## Feature Details

### Color Temperature (CCT)

The plugin exposes a Color Temperature characteristic (153–500 Mireds) in HomeKit alongside the standard RGB color controls. This maps to WLED's segment CCT value, letting you shift between warm and cool white directly from the Home app or Siri.

WLED must have a white channel or CCT-capable LEDs configured for this to have a visible effect on the hardware.

### Nightlight Timers

Nightlight timers create one Switch accessory per timer that activates WLED's built-in nightlight fade-off. When you turn the switch on, WLED starts a countdown and gradually dims to off.

Timers can be configured globally (under `manualDevicesSection.nightlight`) as defaults for all devices, or per-device (under `deviceSettings.nightlight`). Per-device settings take precedence.

```json
{
  "deviceSettings": {
    "nightlight": {
      "enabled": true,
      "timers": [
        { "name": "15 min", "seconds": 900 },
        { "name": "30 min", "seconds": 1800 },
        { "name": "1 hour", "seconds": 3600 }
      ]
    }
  }
}
```

Each timer appears as a separate Switch in HomeKit named `<device name> <timer name>`.

### HyperHDR Integration

When enabled, the plugin mirrors WLED's power state and brightness to a [HyperHDR](https://github.com/awawa-dev/HyperHDR) instance via its JSON-RPC API. This is useful when WLED LEDs are also driven by HyperHDR and you want a single HomeKit toggle to control both.

A dedicated Switch (or Outlet) accessory named "HyperHDR" (configurable) is added inside the same accessory group, letting you toggle HyperHDR independently from HomeKit as well.

**Configuration:**

```json
{
  "deviceSettings": {
    "hyperHDR": {
      "enabled": true,
      "host": "192.168.1.11",
      "port": 8090,
      "component": "LEDDEVICE",
      "token": "",
      "serviceType": "Switch",
      "switchName": "HyperHDR"
    }
  }
}
```

| Property | Type | Description | Default |
|----------|------|-------------|---------|
| `enabled` | boolean | Enable HyperHDR sync | `false` |
| `host` | string | IP address or hostname of the HyperHDR instance | - |
| `port` | integer | HyperHDR JSON-RPC port | `8090` |
| `component` | string | Component to toggle: `"LEDDEVICE"` or `"ALL"` | `"LEDDEVICE"` |
| `token` | string | Auth token (leave empty if not required) | - |
| `serviceType` | string | HomeKit service type: `"Switch"` or `"Outlet"` | `"Switch"` |
| `switchName` | string | Name shown in HomeKit for the HyperHDR accessory | `"HyperHDR"` |

HyperHDR errors are logged as warnings and never block WLED operation.

### Preset Controls

By default, this plugin creates preset controls for each WLED device, allowing you to switch between your saved WLED presets directly from HomeKit.

**Features:**
- Preset selector appears as an input source selector in HomeKit (similar to TV inputs)
- Each WLED preset appears as a selectable input
- Includes a manual/no-preset input (Identifier `0`) labeled `Custom` (configurable via `customInputLabel`)
- Easily switch presets through the Home app, Control Center, or Siri
- Presets are automatically synchronized from your WLED device
- Option to filter which presets are shown using the `enabledPresets` array
- When you change color from the Light accessory, any active preset is cleared (switches back to manual color, `ps=0`, `fx=0`)

**Single Accessory Mode (Optional):**
If `deviceSettings.singleAccessoryWithTV` is enabled, the Light + TV input selector are exposed under a single HomeKit accessory. You may need to remove cached accessories in the Home app after enabling/disabling this due to HomeKit caching.

**Configuration - Show All Presets:**
```json
{
  "deviceSettings": {
    "usePresetService": true
  }
}
```

**Configuration - Show Specific Presets Only:**
```json
{
  "deviceSettings": {
    "usePresetService": true,
    "enabledPresets": ["1", "2", "5"]
  }
}
```

**Tip:** Use the Discovery UI's preset manager to easily select which presets to enable!

**Disabling Presets:**
If you don't want preset controls, set `usePresetService` to `false`:
```json
{
  "deviceSettings": {
    "usePresetService": false
  }
}

### WebSocket Support

This plugin uses WebSockets (when enabled) to provide real-time updates from your WLED devices.

**Benefits:**
- Instant state updates when changes are made outside of HomeKit
- Reduced network traffic compared to polling
- Lower latency for a more responsive experience
- Less CPU and memory usage on your Homebridge server

**Requirements:**
- WLED firmware v0.13 or newer
- WebSocket support must be enabled in your WLED device settings

**Configuration:**
WebSockets are enabled by default. To disable:
```json
{
  "deviceSettings": {
    "useWebSockets": false,
    "pollInterval": 5
  }
}
```

**Fallback Behavior:**
If WebSockets are unavailable or disabled, the plugin automatically falls back to HTTP polling using the configured `pollInterval`.

### Discovery Methods

The plugin offers two ways to find WLED devices on your network:

#### 1. Interactive Discovery UI (Recommended)

Use the Custom Plugin UI in Homebridge Config UI X to manually trigger discovery scans:
- On-demand scanning - only runs when you click "Start Discovery"
- Real-time results showing device details
- One-click device addition to configuration
- No continuous background scanning to reduce network load

**Discovery protocols used:**
- **mDNS (Bonjour)** - Discovers WLED devices advertising via mDNS
- **SSDP (UPnP)** - Discovers WLED devices responding to SSDP queries

#### 2. Manual Configuration

For devices that can't be discovered automatically, or if you prefer explicit configuration:
- Add devices directly to `config.json`
- Works for devices on different subnets or VLANs
- Useful for devices with mDNS/SSDP disabled
- Recommended for static, permanent installations

## Troubleshooting

### Discovery Not Finding Devices

**Problem:** Discovery UI doesn't find your WLED devices

**Solutions:**
- Ensure your WLED devices are on the same network/subnet as your Homebridge server
- Check that your network allows mDNS and SSDP traffic (some routers/firewalls block multicast)
- Update your WLED firmware to the latest version
- Verify WLED web interface is accessible at `http://<device-ip>`
- Try adding the device manually using its IP address in the configuration

### Device Not Responding in HomeKit

**Problem:** Device appears in HomeKit but doesn't respond to commands

**Solutions:**
- Verify you can access the WLED web interface at `http://<device-ip>`
- Check that the IP address and port are correctly configured
- Ensure your WLED device is powered on and connected to WiFi
- If using DHCP, consider setting a static IP reservation for your WLED device
- Check Homebridge logs for error messages (`logLevel: "debug"` for detailed info)
- Restart both the WLED device and Homebridge

### HomeKit Not Showing Real-time Updates

**Problem:** Changes made in WLED web interface don't appear immediately in HomeKit

**Solutions:**
- Enable WebSockets if you're using WLED v0.13 or newer:
  ```json
  { "deviceSettings": { "useWebSockets": true } }
  ```
- If WebSockets aren't working, decrease the `pollInterval` for more frequent updates:
  ```json
  { "deviceSettings": { "pollInterval": 5 } }
  ```
- Verify WebSocket support is enabled in your WLED device settings
- Check network firewall isn't blocking WebSocket connections
- Restart the WLED device and Homebridge

### Presets Not Appearing or Updating

**Problem:** WLED presets don't show up or aren't updating in HomeKit

**Solutions:**
- Ensure `usePresetService` is set to `true` (it's enabled by default)
- Create presets in your WLED device first (they must exist to be discovered)
- If using `enabledPresets`, verify the preset IDs are correct (e.g., `["1", "2", "3"]`)
- Restart Homebridge to refresh preset list
- Check that presets have names in WLED (unnamed presets may not appear correctly)

### Performance Issues

**Problem:** Homebridge running slowly or consuming excessive resources

**Solutions:**
- Enable WebSockets instead of polling when possible (reduces overhead)
- Limit the number of enabled presets using `enabledPresets` array

### Plugin Not Appearing in Config UI X

**Problem:** Can't find the plugin or Custom UI in Homebridge Config UI X

**Solutions:**
- Ensure plugin is properly installed: `npm list -g homebridge-simpler-wled`
- Restart Homebridge Config UI X
- Clear browser cache and reload the page
- Check that Homebridge Config UI X is up to date
- Verify plugin installed correctly: check for errors in Homebridge logs

### Getting Debug Information

Enable debug logging to troubleshoot issues:

```json
{
  "platform": "Simpler WLED",
  "logLevel": "debug"
}
```

Then check Homebridge logs for detailed information about plugin operations.

## Development

### Setup

1. **Clone this repository:**
   ```bash
   git clone https://github.com/drewcovi/homebridge-simpler-wled.git
   cd homebridge-simpler-wled
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the plugin:**
   ```bash
   npm run build
   ```

4. **Watch for changes during development (optional):**
   ```bash
   npm run watch
   ```

### Local testing with Homebridge

Homebridge caches installed plugins by version. **Always bump the version in `package.json` before each local install**, or the UI may keep serving the previous build.

1. **Bump the version** in `package.json` (example: `3.2.0-local.1` → `3.2.0-local.2`).
2. **Build:**
   ```bash
   npm run build
   ```
3. **Pack and install into Homebridge:**
   ```bash
   npm pack && sudo hb-service install homebridge-simpler-wled-<nueva-versión>.tgz
   ```
   Replace `<nueva-versión>` with the exact version from `package.json` (for example `homebridge-simpler-wled-3.2.0-local.2.tgz`).

   If `hb-service` is not on your `PATH`, use the one from this repo after `npm install`:
   ```bash
   npm pack
   sudo ./node_modules/.bin/hb-service install homebridge-simpler-wled-<nueva-versión>.tgz
   ```
   You can also install into the Homebridge storage folder directly:
   ```bash
   npm pack
   cd ~/.homebridge && npm install /path/to/homebridge-simpler-wled/homebridge-simpler-wled-<nueva-versión>.tgz --save
   ```
4. **Restart Homebridge** and hard-reload the Config UI X page in the browser to confirm the new version is active.

Without the version bump, you cannot reliably confirm that your local changes are what Homebridge is running.

### Available Scripts

- `npm run build` - Clean, lint, test, and build the plugin and UI
- `npm run watch` - Build and watch for file changes
- `npm run clean` - Remove build artifacts
- `npm run lint` - Run ESLint on TypeScript files
- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:verbose` - Run tests with verbose output
- `npm run test:unit` - Run unit tests only

### Project Structure

- `src/` - TypeScript source files
  - `platform.ts` - Main platform implementation
  - `platformAccessory.ts` - Light-only accessory (Lightbulb service)
  - `combinedAccessory.ts` - Single-accessory mode (Lightbulb + TV/presets)
  - `presetsAccessory.ts` - Standalone preset selector (TV service)
  - `nightlightAccessory.ts` - Nightlight timer switches
  - `wledDevice.ts` - WLED device communication (HTTP + WebSocket)
  - `hyperHDRClient.ts` - HyperHDR JSON-RPC client
  - `discoveryService.ts` - mDNS and SSDP discovery
  - `settings.ts` - Plugin constants
- `homebridge-ui/` - Custom UI for Homebridge Config UI X
- `tests/` - Unit tests
- `config.schema.json` - Configuration schema for Homebridge Config UI X

### Testing

The plugin includes comprehensive unit tests. Run them with:

```bash
npm test
```

For continuous testing during development:

```bash
npm run test:watch
```

### Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## Support

- **Issues:** Report bugs or request features on [GitHub Issues](https://github.com/drewcovi/homebridge-simpler-wled/issues)
- **WLED Documentation:** [WLED Knowledge Base](https://kno.wled.ge/)
- **Homebridge Documentation:** [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki)

## License

MIT

## Credits

Developed by Drew Covi

Special thanks to the [WLED project](https://github.com/Aircoookie/WLED) for creating an amazing LED controller firmware.
