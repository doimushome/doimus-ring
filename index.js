"use strict";

const { RingApi, RingDeviceType } = require("ring-client-api");

function createLogger(api, prefix) {
  return (level, msg) => api.log(level, `[${prefix}] ${msg}`);
}

let ringApi = null;
let devices = new Map();
let pollTimer = null;
let locationModeTimer = null;
let savedApi = null;
let log = null;
const lastKnown = new Map();

function makeDeviceId(zid, suffix = "") {
  return `ring-${zid}${suffix ? "-" + suffix : ""}`;
}

function mapDeviceType(dt) {
  if (
    [
      RingDeviceType.ContactSensor,
      RingDeviceType.RetrofitZone,
      RingDeviceType.TiltSensor,
      RingDeviceType.GlassbreakSensor,
      RingDeviceType.Sensor,
      RingDeviceType.MotionSensor,
      RingDeviceType.BeamsMotionSensor,
      RingDeviceType.FloodFreezeSensor,
      RingDeviceType.FreezeSensor,
      RingDeviceType.WaterSensor,
      RingDeviceType.TemperatureSensor,
      RingDeviceType.SmokeAlarm,
      RingDeviceType.CoAlarm,
      RingDeviceType.SmokeCoListener,
      RingDeviceType.KiddeSmokeCoAlarm,
      RingDeviceType.BaseStation,
      RingDeviceType.BaseStationPro,
      RingDeviceType.Keypad,
    ].includes(dt)
  ) {
    return "sensor";
  }
  if (dt === RingDeviceType.SecurityPanel) return "sensor";
  if (dt === RingDeviceType.Lock || /^lock($|\.)/.test(dt)) return "lock";
  if (dt === RingDeviceType.Switch || dt === RingDeviceType.WaterValve)
    return "switch";
  if (dt === RingDeviceType.Outlet) return "outlet";
  if (dt === RingDeviceType.Fan) return "fan";
  if (dt === RingDeviceType.Thermostat) return "thermostat";
  if (
    [
      RingDeviceType.MultiLevelSwitch,
      RingDeviceType.MultiLevelBulb,
      RingDeviceType.BeamsSwitch,
      RingDeviceType.BeamsMultiLevelSwitch,
      RingDeviceType.BeamsTransformerSwitch,
      RingDeviceType.BeamsLightGroupSwitch,
    ].includes(dt)
  ) {
    return "light";
  }
  return null;
}

function cameraCapabilities(cam, cfg) {
  const caps = [],
    state = {};
  if (!cfg.hideCameraMotionSensor) {
    caps.push("motion");
    state.motion = false;
  }
  if (cam.hasBattery) {
    caps.push("battery", "battery_low");
    state.battery = cam.batteryLevel ?? 100;
    state.battery_low = cam.hasLowBattery ?? false;
  }
  if (cam.hasLight && !cfg.hideCameraLight) {
    caps.push("on");
    state.on = cam.data?.led_status === "on";
  }
  if (cam.hasSiren && !cfg.hideCameraSirenSwitch) {
    caps.push("active");
    state.active = Boolean(cam.data?.siren_status?.seconds_remaining);
  }
  if (cam.hasInHomeDoorbell && !cfg.hideInHomeDoorbellSwitch) {
    caps.push("active");
    state.active = cam.data?.settings?.chime_settings?.enabled ?? false;
  }
  if (cam.isDoorbot && !cfg.hideDoorbellSwitch) {
    caps.push("doorbell");
    state.doorbell = false;
  }
  return { caps, state };
}

function deviceCapabilities(dev, type) {
  const caps = [],
    state = {};
  const dt = dev.deviceType;

  if (type === "lock") {
    caps.push("locked", "battery", "battery_low");
    state.locked = dev.data?.locked === "locked";
    state.battery = dev.data?.batteryLevel ?? 100;
    state.battery_low = dev.data?.batteryStatus === "low";
  } else if (type === "switch" || type === "outlet") {
    caps.push("on");
    state.on = dev.data?.on === true;
  } else if (type === "light") {
    caps.push("on");
    state.on = dev.data?.on === true;
    if (
      [
        RingDeviceType.MultiLevelSwitch,
        RingDeviceType.MultiLevelBulb,
        RingDeviceType.BeamsSwitch,
        RingDeviceType.BeamsMultiLevelSwitch,
      ].includes(dt)
    ) {
      caps.push("brightness");
      state.brightness = Math.round((dev.data?.level ?? 1) * 100);
    }
  } else if (type === "fan") {
    caps.push("on", "rotation_speed");
    state.on = dev.data?.on === true;
    state.rotation_speed = Math.round((dev.data?.level ?? 0) * 100);
  } else if (type === "thermostat") {
    caps.push("temperature", "target_temp", "heating_state", "heating_mode");
    state.temperature = dev.data?.temperature ?? dev.data?.celsius ?? 0;
    state.target_temp = dev.data?.setPoint ?? 20;
    state.heating_state = 0;
    state.heating_mode = 0;
  } else if (type === "sensor") {
    if (
      [
        RingDeviceType.ContactSensor,
        RingDeviceType.RetrofitZone,
        RingDeviceType.TiltSensor,
        RingDeviceType.GlassbreakSensor,
      ].includes(dt)
    ) {
      caps.push("contact", "battery", "battery_low");
      state.contact = dev.data?.faulted === true;
      state.battery = dev.data?.batteryLevel ?? 100;
      state.battery_low = dev.data?.batteryStatus === "low";
    } else if (
      dt === RingDeviceType.MotionSensor ||
      dt === RingDeviceType.BeamsMotionSensor
    ) {
      caps.push("motion", "battery", "battery_low");
      state.motion = dev.data?.faulted === true;
      state.battery = dev.data?.batteryLevel ?? 100;
      state.battery_low = dev.data?.batteryStatus === "low";
    } else if (
      dt === RingDeviceType.FloodFreezeSensor ||
      dt === RingDeviceType.WaterSensor
    ) {
      caps.push("leak", "battery", "battery_low");
      state.leak = dev.data?.faulted === true;
      state.battery = dev.data?.batteryLevel ?? 100;
      state.battery_low = dev.data?.batteryStatus === "low";
    } else if (dt === RingDeviceType.FreezeSensor) {
      caps.push("active", "battery", "battery_low");
      state.active = dev.data?.faulted === true;
      state.battery = dev.data?.batteryLevel ?? 100;
      state.battery_low = dev.data?.batteryStatus === "low";
    } else if (dt === RingDeviceType.TemperatureSensor) {
      caps.push("temperature", "battery", "battery_low");
      state.temperature = dev.data?.celsius ?? 0;
      state.battery = dev.data?.batteryLevel ?? 100;
      state.battery_low = dev.data?.batteryStatus === "low";
    } else if (
      [
        RingDeviceType.SmokeAlarm,
        RingDeviceType.CoAlarm,
        RingDeviceType.SmokeCoListener,
        RingDeviceType.KiddeSmokeCoAlarm,
      ].includes(dt)
    ) {
      caps.push("smoke", "battery", "battery_low");
      state.smoke =
        dev.data?.alarmStatus === "active" ||
        dev.data?.smoke?.alarmStatus === "active";
      state.battery = dev.data?.batteryLevel ?? 100;
      state.battery_low = dev.data?.batteryStatus === "low";
    } else if (dt === RingDeviceType.SecurityPanel) {
      caps.push("mode", "active");
      state.mode = "disarmed";
      state.active = false;
    } else if (
      [
        RingDeviceType.BaseStation,
        RingDeviceType.BaseStationPro,
        RingDeviceType.Keypad,
      ].includes(dt)
    ) {
      caps.push("battery", "battery_low");
      state.battery = dev.data?.batteryLevel ?? 100;
      state.battery_low = dev.data?.batteryStatus === "low";
    } else {
      caps.push("active");
      state.active = false;
    }
  }
  return { caps, state };
}

async function syncDevices(cfg, api) {
  try {
    const locations = await ringApi.getLocations();
    const seen = new Set();

    for (const loc of locations) {
      if (cfg.locationIds?.length && !cfg.locationIds.includes(loc.id))
        continue;
      log("info", `Syncing: ${loc.name}`);

      for (const cam of loc.cameras) {
        if (cfg.hideDeviceIds?.includes(makeDeviceId(cam.id))) continue;
        const { caps, state } = cameraCapabilities(cam, cfg);
        if (caps.length) {
          const did = makeDeviceId(cam.id, "cam");
          seen.add(did);
          if (!devices.has(did)) {
            api.registerDevice({
              id: did,
              name: `${cam.name}`,
              type: "camera",
              capabilities: caps,
              state,
            });
            log("info", `Registered camera: ${cam.name}`);
          }
          devices.set(did, { device: cam, type: "camera" });
        }
        if (cam.hasLight && !cfg.hideCameraLight) {
          const ldid = makeDeviceId(cam.id, "light");
          seen.add(ldid);
          if (!devices.has(ldid)) {
            api.registerDevice({
              id: ldid,
              name: `${cam.name} Light`,
              type: "light",
              capabilities: ["on"],
              state: { on: cam.data?.led_status === "on" },
            });
          }
          devices.set(ldid, { device: cam, type: "camera-light" });
        }
        if (cam.hasSiren && !cfg.hideCameraSirenSwitch) {
          const sdid = makeDeviceId(cam.id, "siren");
          seen.add(sdid);
          if (!devices.has(sdid)) {
            api.registerDevice({
              id: sdid,
              name: `${cam.name} Siren`,
              type: "switch",
              capabilities: ["on"],
              state: { on: Boolean(cam.data?.siren_status?.seconds_remaining) },
            });
          }
          devices.set(sdid, { device: cam, type: "camera-siren" });
        }
      }

      for (const chime of loc.chimes) {
        const did = makeDeviceId(chime.id, "chime");
        seen.add(did);
        if (!devices.has(did)) {
          api.registerDevice({
            id: did,
            name: `${chime.name}`,
            type: "switch",
            capabilities: ["active"],
            state: { active: !chime.data?.do_not_disturb?.seconds_left },
          });
        }
        devices.set(did, { device: chime, type: "chime" });
      }

      if (loc.hasHubs) {
        try {
          const alarmDevices = await loc.getDevices();
          for (const dev of alarmDevices) {
            if (cfg.hideDeviceIds?.includes(makeDeviceId(dev.id))) continue;
            const type = mapDeviceType(dev.deviceType);
            if (!type) continue;
            if (type === "sensor" && dev.data?.status === "disabled") continue;
            if (
              cfg.hideLightGroups &&
              dev.deviceType === RingDeviceType.BeamsLightGroupSwitch
            )
              continue;

            const did = makeDeviceId(dev.id, type);
            seen.add(did);
            if (!devices.has(did)) {
              const { caps, state } = deviceCapabilities(dev, type);
              api.registerDevice({
                id: did,
                name: dev.name,
                type,
                capabilities: caps,
                state,
              });
              log("info", `Registered ${type}: ${dev.name}`);
            }
            devices.set(did, { device: dev, type, location: loc });
          }
        } catch (e) {
          log("error", `Alarm device sync failed: ${e.message}`);
        }
      }

      if (await loc.supportsLocationModeSwitching()) {
        const mdid = makeDeviceId(loc.id, "mode");
        seen.add(mdid);
        if (!devices.has(mdid)) {
          api.registerDevice({
            id: mdid,
            name: `${loc.name} Mode`,
            type: "sensor",
            capabilities: ["mode"],
            state: { mode: "disarmed" },
          });
        }
        devices.set(mdid, { location: loc, type: "location-mode" });
      }
    }

    for (const [did] of devices) {
      if (!seen.has(did)) {
        devices.delete(did);
        log("info", `Removed stale: ${did}`);
      }
    }
  } catch (e) {
    log("error", `Sync failed: ${e.message}`);
  }
}

async function pollStates(cfg, api) {
  for (const [did, info] of devices) {
    try {
      if (info.type === "camera") {
        const cam = info.device;
        await cam.requestUpdate().catch(() => {});
        const updates = {};
        if (!cfg.hideCameraMotionSensor)
          updates.motion = cam.data?.motion_detection_enabled === true;
        if (cam.hasBattery) {
          updates.battery = cam.batteryLevel ?? 100;
          updates.battery_low = cam.hasLowBattery ?? false;
        }
        if (cam.hasLight && !cfg.hideCameraLight)
          updates.on = cam.data?.led_status === "on";
        if (cam.hasSiren && !cfg.hideCameraSirenSwitch)
          updates.active = Boolean(cam.data?.siren_status?.seconds_remaining);
        guardUpdate(did, updates);
      } else if (info.type === "camera-light") {
        await info.device.requestUpdate().catch(() => {});
        guardUpdate(did, {
          on: info.device.data?.led_status === "on",
        });
      } else if (info.type === "camera-siren") {
        await info.device.requestUpdate().catch(() => {});
        guardUpdate(did, {
          on: Boolean(info.device.data?.siren_status?.seconds_remaining),
        });
      } else if (info.type === "chime") {
        guardUpdate(did, {
          active: !info.device.data?.do_not_disturb?.seconds_left,
        });
      } else if (info.type === "location-mode") {
      } else {
        const dev = info.device;
        const dt = dev.deviceType;
        const d = dev.data;
        if (!d) continue;

        function g(updates) { guardUpdate(did, updates); }

        if (
          [
            RingDeviceType.ContactSensor,
            RingDeviceType.RetrofitZone,
            RingDeviceType.TiltSensor,
            RingDeviceType.GlassbreakSensor,
          ].includes(dt)
        ) {
          g({
            contact: d.faulted === true,
            battery: d.batteryLevel ?? 100,
            battery_low: d.batteryStatus === "low",
          });
        } else if (
          dt === RingDeviceType.MotionSensor ||
          dt === RingDeviceType.BeamsMotionSensor
        ) {
          g({
            motion: d.faulted === true,
            battery: d.batteryLevel ?? 100,
            battery_low: d.batteryStatus === "low",
          });
        } else if (
          dt === RingDeviceType.FloodFreezeSensor ||
          dt === RingDeviceType.WaterSensor
        ) {
          g({
            leak: d.faulted === true,
            battery: d.batteryLevel ?? 100,
            battery_low: d.batteryStatus === "low",
          });
        } else if (dt === RingDeviceType.FreezeSensor) {
          g({
            active: d.faulted === true,
            battery: d.batteryLevel ?? 100,
            battery_low: d.batteryStatus === "low",
          });
        } else if (dt === RingDeviceType.TemperatureSensor) {
          g({
            temperature: d.celsius ?? 0,
            battery: d.batteryLevel ?? 100,
            battery_low: d.batteryStatus === "low",
          });
        } else if (
          [
            RingDeviceType.SmokeAlarm,
            RingDeviceType.CoAlarm,
            RingDeviceType.SmokeCoListener,
          ].includes(dt)
        ) {
          g({
            smoke: d.alarmStatus === "active",
            battery: d.batteryLevel ?? 100,
            battery_low: d.batteryStatus === "low",
          });
        } else if (dt === RingDeviceType.KiddeSmokeCoAlarm) {
          g({
            smoke: d.components?.["alarm.smoke"]?.alarmStatus === "active",
            battery: d.batteryLevel ?? 100,
            battery_low: d.batteryStatus === "low",
          });
        } else if (dt === RingDeviceType.SecurityPanel) {
          const alarmState = d.alarmInfo?.state;
          let mode = "disarmed",
            active = false;
          if (alarmState === "burglar-alarm" || alarmState === "fire-alarm")
            active = true;
          if (d.mode === "some") mode = "armed_home";
          else if (d.mode === "all") mode = "armed_away";
          else if (d.mode === "night") mode = "armed_night";
          g({ mode, active });
        } else if (dt === RingDeviceType.Lock) {
          g({
            locked: d.locked === "locked",
            battery: d.batteryLevel ?? 100,
            battery_low: d.batteryStatus === "low",
          });
        } else if (
          [
            RingDeviceType.MultiLevelSwitch,
            RingDeviceType.MultiLevelBulb,
            RingDeviceType.BeamsSwitch,
            RingDeviceType.BeamsMultiLevelSwitch,
          ].includes(dt)
        ) {
          g({
            on: d.on === true,
            brightness: Math.round((d.level ?? 1) * 100),
          });
        } else if (
          dt === RingDeviceType.Switch ||
          dt === RingDeviceType.Outlet ||
          dt === RingDeviceType.BeamsTransformerSwitch ||
          dt === RingDeviceType.WaterValve
        ) {
          g({ on: d.on === true });
        } else if (dt === RingDeviceType.Fan) {
          g({
            on: d.on === true,
            rotation_speed: Math.round((d.level ?? 0) * 100),
          });
        } else if (dt === RingDeviceType.Thermostat) {
          g({
            temperature: d.celsius ?? 0,
            target_temp: d.setPoint ?? 20,
          });
        }
      }
    } catch (e) {
      log("debug", `Poll error ${did}: ${e.message}`);
    }
  }
}

async function pollLocationModes(cfg, api) {
  try {
    const locations = await ringApi.getLocations();
    for (const loc of locations) {
      if (cfg.locationIds?.length && !cfg.locationIds.includes(loc.id))
        continue;
      const mdid = makeDeviceId(loc.id, "mode");
      if (!devices.has(mdid)) continue;
      const mode = await loc.getMode();
      const map = {
        none: "disarmed",
        some: "armed_home",
        all: "armed_away",
        night: "armed_night",
      };
      api.updateDeviceState(mdid, { mode: map[mode] || "disarmed" });
    }
  } catch (e) {
    log("error", `Location mode poll: ${e.message}`);
  }
}

async function handleCommand(deviceId, key, value, api) {
  const info = devices.get(deviceId);
  if (!info) return;

  try {
    if (info.type === "camera") {
      const cam = info.device;
      if (key === "on" && cam.hasLight) {
        await cam.setLight(value);
        api.updateDeviceState(deviceId, { on: value });
      } else if (key === "active" && cam.hasSiren) {
        await cam.setSiren(value);
        api.updateDeviceState(deviceId, { active: value });
      }
    } else if (info.type === "camera-light") {
      if (key === "on") {
        await info.device.setLight(value);
        api.updateDeviceState(deviceId, { on: value });
      }
    } else if (info.type === "camera-siren") {
      if (key === "on") {
        await info.device.setSiren(value);
        api.updateDeviceState(deviceId, { on: value });
      }
    } else if (info.type === "chime") {
      if (key === "active") {
        if (value) await info.device.clearSnooze();
        else await info.device.snooze(1440);
        api.updateDeviceState(deviceId, { active: value });
      }
    } else if (info.type === "location-mode") {
      const map = {
        disarmed: "none",
        armed_home: "some",
        armed_away: "all",
        armed_night: "night",
      };
      await info.location.setLocationMode(map[value] || "none");
      api.updateDeviceState(deviceId, { mode: value });
    } else if (info.device?.deviceType === RingDeviceType.SecurityPanel) {
      if (key === "mode") {
        const map = {
          disarmed: "none",
          armed_home: "some",
          armed_away: "all",
          armed_night: "night",
        };
        await info.location.setAlarmMode(map[value] || "none");
        api.updateDeviceState(deviceId, { mode: value });
      }
    } else if (info.type === "lock" && key === "locked") {
      if (value) {
        await info.device.sendCommand("lock.lock");
        api.updateDeviceState(deviceId, { locked: true });
      } else {
        await info.device.sendCommand("lock.unlock");
        api.updateDeviceState(deviceId, { locked: false });
      }
    } else if (
      key === "on" &&
      [
        RingDeviceType.Switch,
        RingDeviceType.Outlet,
        RingDeviceType.BeamsTransformerSwitch,
        RingDeviceType.WaterValve,
      ].includes(info.device?.deviceType)
    ) {
      await info.device.sendCommand("switch.on", { value });
      api.updateDeviceState(deviceId, { on: value });
    } else if (
      [
        RingDeviceType.MultiLevelSwitch,
        RingDeviceType.MultiLevelBulb,
        RingDeviceType.BeamsSwitch,
        RingDeviceType.BeamsMultiLevelSwitch,
      ].includes(info.device?.deviceType)
    ) {
      if (key === "on") {
        await info.device.sendCommand("switch.on", { value });
        api.updateDeviceState(deviceId, { on: value });
      } else if (key === "brightness") {
        await info.device.sendCommand("switch.level", { level: value / 100 });
        api.updateDeviceState(deviceId, { brightness: value });
      }
    } else if (info.device?.deviceType === RingDeviceType.Fan) {
      if (key === "on") {
        await info.device.sendCommand("switch.on", { value });
        api.updateDeviceState(deviceId, { on: value });
      } else if (key === "rotation_speed") {
        await info.device.sendCommand("switch.level", { level: value / 100 });
        api.updateDeviceState(deviceId, { rotation_speed: value });
      }
    } else if (info.device?.deviceType === RingDeviceType.Thermostat) {
      if (key === "target_temp") {
        await info.device.sendCommand("thermostat.set-point", {
          setPoint: value,
        });
        api.updateDeviceState(deviceId, { target_temp: value });
      } else if (key === "heating_mode") {
        const modeMap = { 0: "off", 1: "heat", 2: "cool", 3: "aux" };
        await info.device.sendCommand("thermostat.mode", {
          mode: modeMap[value] || "off",
        });
        api.updateDeviceState(deviceId, { heating_mode: value });
      }
    }
  } catch (e) {
    log("error", `Command failed ${deviceId}: ${e.message}`);
  }
}

module.exports = {
  async start(config, api) {
    savedApi = api;
    log = createLogger(api, "Ring");
    ringApi = new RingApi({
      refreshToken: config.refreshToken,
      cameraStatusPollingSeconds: config.cameraStatusPollingSeconds || 20,
      avoidSnapshotBatteryDrain: config.avoidSnapshotBatteryDrain || false,
    });

    ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
      if (newRefreshToken && newRefreshToken !== config.refreshToken) {
        config.refreshToken = newRefreshToken;
        log("info", "Ring refresh token updated");
      }
    });

    api.onCommand((deviceId, key, value) => {
      handleCommand(deviceId, key, value, api).catch((e) =>
        log("error", `Command error: ${e.message}`),
      );
    });

    await syncDevices(config, api);
    await pollStates(config, api);

    const interval = (config.cameraStatusPollingSeconds || 20) * 1000;
    pollTimer = setInterval(() => {
      pollStates(config, api).catch((e) =>
        log("error", `Poll: ${e.message}`),
      );
    }, interval);
    if (pollTimer.unref) pollTimer.unref();

    locationModeTimer = setInterval(() => {
      pollLocationModes(config, api).catch((e) =>
        log("error", `Mode poll: ${e.message}`),
      );
    }, 60000);
    if (locationModeTimer.unref) locationModeTimer.unref();

    function guardUpdate(did, updates) {
      const prev = lastKnown.get(did);
      if (!prev || Object.keys(updates).some(k => updates[k] !== prev[k])) {
        api.updateDeviceState(did, updates);
        lastKnown.set(did, { ...prev, ...updates });
      }
    }

    ringApi.onMotionDetected.subscribe((motion) => {
      for (const [did, info] of devices) {
        if (info.type === "camera" && info.device.id === motion.id) {
          api.updateDeviceState(did, { motion: motion.detected });
          break;
        }
      }
    });

    ringApi.onDoorbellPressed.subscribe((doorbell) => {
      for (const [did, info] of devices) {
        if (info.type === "camera" && info.device.id === doorbell.id) {
          api.updateDeviceState(did, { doorbell: true });
          setTimeout(
            () => api.updateDeviceState(did, { doorbell: false }),
            5000,
          );
          break;
        }
      }
    });

    ringApi.onLocationModeChange.subscribe((locationId, mode) => {
      const did = makeDeviceId(locationId, "mode");
      if (devices.has(did)) {
        const map = {
          none: "disarmed",
          some: "armed_home",
          all: "armed_away",
          night: "armed_night",
        };
        api.updateDeviceState(did, { mode: map[mode] || "disarmed" });
      }
    });
  },

  stop() {
    if (pollTimer) clearInterval(pollTimer);
    if (locationModeTimer) clearInterval(locationModeTimer);
    pollTimer = null;
    locationModeTimer = null;
    if (ringApi) {
      ringApi.disconnect();
      ringApi = null;
    }
    devices.clear();
  },

  async setConfig(cfg) {
    this.stop();
    await this.start(cfg, savedApi);
  },
};
