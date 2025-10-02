export function triggerSelectionHaptic() {
  if (typeof window === 'undefined') {
    return;
  }

  const plugin = resolveCapacitorHaptics();
  if (plugin?.selectionChanged) {
    try {
      plugin.selectionChanged();
      return;
    } catch (error) {
      // ignore missing haptics support
    }
  }
  if (plugin?.impact) {
    try {
      plugin.impact({ style: 'LIGHT' });
      return;
    } catch (error) {
      // ignore
    }
  }

  const expo = resolveExpoHaptics();
  if (expo?.selectionAsync) {
    expo.selectionAsync().catch(() => undefined);
    return;
  }

  vibrate(15);
}

export function triggerConfirmationHaptic() {
  if (typeof window === 'undefined') {
    return;
  }

  const plugin = resolveCapacitorHaptics();
  if (plugin?.impact) {
    try {
      plugin.impact({ style: 'MEDIUM' });
      return;
    } catch (error) {
      // ignore
    }
  }

  const expo = resolveExpoHaptics();
  if (expo?.impactAsync) {
    expo.impactAsync({ style: 'medium' }).catch(() => undefined);
    return;
  }

  vibrate([20, 40, 20]);
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch (error) {
    // ignore vibration errors
  }
}

function resolveCapacitorHaptics():
  | {
      selectionChanged?: () => Promise<void> | void;
      impact?: (options: { style: string }) => Promise<void> | void;
    }
  | null {
  const global = window as unknown as {
    Capacitor?: {
      Plugins?: {
        Haptics?: {
          selectionChanged?: () => Promise<void> | void;
          impact?: (options: { style: string }) => Promise<void> | void;
        };
      };
    };
  };
  return global.Capacitor?.Plugins?.Haptics ?? null;
}

function resolveExpoHaptics():
  | {
      selectionAsync?: () => Promise<void>;
      impactAsync?: (options: { style: string }) => Promise<void>;
    }
  | null {
  const global = window as unknown as {
    ExpoHaptics?: {
      selectionAsync?: () => Promise<void>;
      impactAsync?: (options: { style: string }) => Promise<void>;
    };
  };
  return global.ExpoHaptics ?? null;
}
