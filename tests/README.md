# Test Suite

```
tests/
├── setup.ts
├── mocks/homebridge.ts
├── wledDevice.test.ts
├── wledUtils.test.ts
├── discoveryService.test.ts
├── platform.test.ts
├── platformAccessory.test.ts
├── combinedAccessory.test.ts
├── nightlightAccessory.test.ts
├── hyperHDRClient.test.ts
├── settings.test.ts
└── integration.test.ts
```

## Commands

```bash
npm test              # all tests
npm run test:unit     # unit suite used by prebuild
npm run test:coverage
npm run test:watch
```

## Coverage focus

| Area                         | Notes                                                   |
| ---------------------------- | ------------------------------------------------------- |
| `device/wledDevice`          | HTTP/WS state, color, presets, segments                 |
| `shared/wledUtils`           | Color, naming, config helpers                           |
| `discovery/discoveryService` | mDNS/UDP discovery                                      |
| `platform`                   | Registration (manual + discovered via `registerDevice`) |
| Accessories                  | Light, combined, nightlight                             |
| `hyperHDRClient`             | JSON-RPC power/ping                                     |

Gaps intentionally lighter: Custom UI (`homebridge-ui/public`), effects/segment accessories (thin wrappers over shared helpers).

## Mocks

See `tests/mocks/homebridge.ts` for `MockLogger`, `MockAPI`, `MockPlatformAccessory`, and config helpers.
