type CapacitorHapticsPlugin = {
  selectionChanged?: () => Promise<void> | void;
  impact?: (options: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }) => Promise<void> | void;
};

type ExpoHapticsModule = {
  selectionAsync?: () => Promise<void>;
  impactAsync?: (options: { style: 'light' | 'medium' | 'heavy' }) => Promise<void>;
};

export type HapticType = 'selection' | 'light' | 'medium' | 'heavy';

interface HapticTelemetryCounters {
  selection: number;
  light: number;
  medium: number;
  heavy: number;
  suppressed: number;
}

let userEnabled = true;
let screenReaderSuppressed = false;
let reduceMotionPreferred = false;
let telemetry: HapticTelemetryCounters = {
  selection: 0,
  light: 0,
  medium: 0,
  heavy: 0,
  suppressed: 0,
};

const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const query = window.matchMedia(REDUCE_MOTION_QUERY);
  reduceMotionPreferred = query.matches;
  const handleChange = (event: MediaQueryListEvent) => {
    reduceMotionPreferred = event.matches;
  };
  try {
    query.addEventListener('change', handleChange);
  } catch (error) {
    // Older browsers use addListener; ignore failures silently.
    if (typeof query.addListener === 'function') {
      query.addListener(handleChange);
    }
  }
}

export function setHapticsEnabled(enabled: boolean) {
  userEnabled = enabled;
}

export function suppressHapticsForScreenReader(suppressed: boolean) {
  screenReaderSuppressed = suppressed;
}

export function getHapticsTelemetry(): Readonly<HapticTelemetryCounters> {
  return telemetry;
}

export function resetHapticsTelemetry() {
  telemetry = {
    selection: 0,
    light: 0,
    medium: 0,
    heavy: 0,
    suppressed: 0,
  };
}

export function triggerHaptic(type: HapticType) {
  if (!shouldTriggerHaptics()) {
    telemetry.suppressed += 1;
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  const plugin = resolveCapacitorHaptics();
  if (plugin) {
    if (type === 'selection' || type === 'light') {
      if (invokeSelectionHaptic(plugin)) {
        telemetry.selection += 1;
        return;
      }
      if (invokeImpactHaptic(plugin, 'LIGHT')) {
        telemetry.light += 1;
        return;
      }
    } else if (type === 'medium') {
      if (invokeImpactHaptic(plugin, 'MEDIUM')) {
        telemetry.medium += 1;
        return;
      }
    } else if (type === 'heavy') {
      if (invokeImpactHaptic(plugin, 'HEAVY')) {
        telemetry.heavy += 1;
        return;
      }
    }
  }

  const expo = resolveExpoHaptics();
  if (expo) {
    if (type === 'selection' || type === 'light') {
      if (invokeExpoSelection(expo)) {
        telemetry.selection += 1;
        return;
      }
      if (invokeExpoImpact(expo, 'light')) {
        telemetry.light += 1;
        return;
      }
    } else if (type === 'medium') {
      if (invokeExpoImpact(expo, 'medium')) {
        telemetry.medium += 1;
        return;
      }
    } else if (type === 'heavy') {
      if (invokeExpoImpact(expo, 'heavy')) {
        telemetry.heavy += 1;
        return;
      }
    }
  }

  if (type === 'selection' || type === 'light') {
    if (vibrate(15)) {
      telemetry.light += 1;
    }
    return;
  }

  if (type === 'medium') {
    if (vibrate([18, 32, 18])) {
      telemetry.medium += 1;
    }
    return;
  }

  if (type === 'heavy') {
    if (vibrate([25, 45, 25])) {
      telemetry.heavy += 1;
    }
  }
}

function shouldTriggerHaptics() {
  if (!userEnabled || screenReaderSuppressed || reduceMotionPreferred) {
    return false;
  }
  if (typeof navigator === 'undefined') {
    return false;
  }
  return true;
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }
  try {
    navigator.vibrate(pattern);
    return true;
  } catch (error) {
    return false;
  }
}

function resolveCapacitorHaptics(): CapacitorHapticsPlugin | null {
  const global = window as unknown as {
    Capacitor?: {
      Plugins?: {
        Haptics?: CapacitorHapticsPlugin;
      };
    };
  };
  return global.Capacitor?.Plugins?.Haptics ?? null;
}

function resolveExpoHaptics(): ExpoHapticsModule | null {
  const global = window as unknown as {
    ExpoHaptics?: ExpoHapticsModule;
  };
  return global.ExpoHaptics ?? null;
}

function invokeSelectionHaptic(plugin: CapacitorHapticsPlugin) {
  if (!plugin.selectionChanged) {
    return false;
  }
  try {
    plugin.selectionChanged();
    return true;
  } catch (error) {
    return false;
  }
}

function invokeImpactHaptic(
  plugin: CapacitorHapticsPlugin,
  style: 'LIGHT' | 'MEDIUM' | 'HEAVY',
) {
  if (!plugin.impact) {
    return false;
  }
  try {
    plugin.impact({ style });
    return true;
  } catch (error) {
    return false;
  }
}

function invokeExpoSelection(expo: ExpoHapticsModule) {
  if (!expo.selectionAsync) {
    return false;
  }
  expo.selectionAsync().catch(() => undefined);
  return true;
}

function invokeExpoImpact(
  expo: ExpoHapticsModule,
  style: 'light' | 'medium' | 'heavy',
) {
  if (!expo.impactAsync) {
    return false;
  }
  expo.impactAsync({ style }).catch(() => undefined);
  return true;
}
