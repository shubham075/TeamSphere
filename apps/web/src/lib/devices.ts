/** Preferred call devices, remembered per browser / desktop install. Empty = system default. */
export interface DevicePrefs {
  audioinput?: string;
  videoinput?: string;
  audiooutput?: string;
}

const KEY = 'teamsphere.callDevices';

export function getDevicePrefs(): DevicePrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as DevicePrefs;
  } catch {
    return {};
  }
}

export function setDevicePref(kind: keyof DevicePrefs, deviceId: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getDevicePrefs(), [kind]: deviceId || undefined }));
  } catch {
    /* storage unavailable: keep the default */
  }
}

/** Noise suppression and echo cancellation on by default (SOURCE_OF_TRUTH §3.5). */
export function audioConstraints(deviceId?: string): MediaTrackConstraints {
  return { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}
