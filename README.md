# doimus-ring

Doimus native plugin for Ring devices. Supports Ring doorbells, cameras, alarm system, smart lighting, and third-party sensors connected via Ring Alarm.

> **Note:** Video streaming is not supported in Doimus v1. Cameras expose motion detection, light control, siren, and doorbell events only.

## Features

- **Cameras & Doorbells** — motion detection, light control, siren switch, doorbell press events
- **Ring Alarm** — arm/disarm (home/away/night), alarm state monitoring
- **Sensors** — contact, motion, temperature, water leak, freeze, smoke, CO, glassbreak
- **Smart Locks** — lock/unlock, battery status
- **Smart Lighting** — on/off, brightness (Beams, switches, outlets, fans)
- **Chimes** — do not disturb control
- **Thermostats** — temperature control, mode selection
- **Location Modes** — arm/disarm for homes without Ring Alarm
- Automatic token refresh via `onRefreshTokenUpdated`
- Real-time motion and doorbell events via push notifications
- Configurable polling intervals

## Prerequisites

1. A Ring account
2. A refresh token — generate one with:
   ```bash
   npx -p ring-client-api ring-auth-cli
   ```
   See [Refresh Tokens Wiki](https://github.com/dgreif/ring/wiki/Refresh-Tokens) for details.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `refreshToken` | string | — | Ring API refresh token (required) |
| `cameraStatusPollingSeconds` | integer | `20` | Polling interval for camera/chime status |
| `avoidSnapshotBatteryDrain` | boolean | `false` | Minimize battery camera polling |
| `hideCameraLight` | boolean | `false` | Hide light controls for cameras |
| `hideCameraMotionSensor` | boolean | `false` | Hide motion sensors for cameras |
| `hideCameraSirenSwitch` | boolean | `false` | Hide siren switch for cameras |
| `hideDoorbellSwitch` | boolean | `false` | Hide doorbell event switch |
| `hideInHomeDoorbellSwitch` | boolean | `false` | Hide in-home doorbell toggle |
| `hideAlarmSirenSwitch` | boolean | `false` | Hide alarm siren switch |
| `hideLightGroups` | boolean | `false` | Hide Ring lighting groups |
| `hideDeviceIds` | string[] | `[]` | Array of device IDs to hide |
| `locationIds` | string[] | `[]` | Only include these locations (empty = all) |

## Device Types

| Ring Device | Doimus Type | Capabilities |
|---|---|---|
| Camera / Doorbell | `camera` | `motion`, `doorbell`, `on` (light), `active` (siren), `battery`, `battery_low` |
| Camera Light | `light` | `on` |
| Camera Siren | `switch` | `on` |
| Chime | `switch` | `active` (do not disturb) |
| Security Panel | `sensor` | `mode`, `active` |
| Contact/Motion/Leak/Freeze/Temp Sensor | `sensor` | `contact`/`motion`/`leak`/`active`/`temperature`, `battery`, `battery_low` |
| Smoke/CO Alarm | `sensor` | `smoke`, `battery`, `battery_low` |
| Lock | `lock` | `locked`, `battery`, `battery_low` |
| Switch / Outlet / Water Valve | `switch`/`outlet` | `on` |
| Multi-level Switch / Bulb / Beams | `light` | `on`, `brightness` |
| Fan | `fan` | `on`, `rotation_speed` |
| Thermostat | `thermostat` | `temperature`, `target_temp`, `heating_state`, `heating_mode` |
| Location Mode | `sensor` | `mode` |

## Installation

```bash
# From npm (when published)
POST /api/v1/plugins/install
{ "package": "@doimus/ring", "native": true, "config": { "refreshToken": "your-token" } }

# From GitHub
POST /api/v1/plugins/install
{ "package": "matteocrippa/doimus-ring", "source": "github", "native": true, "config": { "refreshToken": "your-token" } }
```

## Architecture

- **ESM module** — uses `ring-client-api` v14+ (ESM-only)
- **Stable device IDs** — derived from Ring `zid` (persists across restarts)
- **Event-driven** — push notifications for motion/doorbell via Ring's push service
- **Polling fallback** — configurable interval for camera/chime/sensor state
- **Command protocol** — uses `RingDevice.sendCommand()` for all device actions

## Limitations

- **No video streaming** — Doimus v1 does not support camera video feeds
- **No 2-way audio** — Intercom and camera 2-way audio not supported
- **Snapshots** — Battery cameras may have delayed snapshots
- **ONVIF cameras** — Third-party cameras via Ring Edge not supported

## Credits

Based on [ring-client-api](https://github.com/dgreif/ring) by Dustin Greif.

## License

MIT
