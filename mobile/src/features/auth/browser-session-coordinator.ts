export type BrowserSessionState = 'authenticated' | 'cleared';

export type BrowserSessionEvent = {
  epoch: number;
  state: BrowserSessionState;
  userId?: string;
};

export type BrowserSessionCoordinator = {
  current: () => BrowserSessionEvent;
  isCurrent: (epoch: number) => boolean;
  publish: (state: BrowserSessionState, userId?: string) => BrowserSessionEvent;
  subscribe: (listener: (event: BrowserSessionEvent) => void) => () => void;
};

type StoredBrowserSessionEvent = BrowserSessionEvent & {
  sourceId: string;
};

const browserSessionStorageKey = 'web_app_demo:expo-web-auth-session-v1';
const browserSessionChannelName = 'web_app_demo:expo-web-auth-session';
const sourceId = createId();
const listeners = new Set<(event: BrowserSessionEvent) => void>();
let currentEvent: StoredBrowserSessionEvent = {
  epoch: 0,
  sourceId,
  state: 'cleared',
};
let broadcastChannel: BroadcastChannel | null | undefined;
let storageListenerAttached = false;

export const browserSessionCoordinator: BrowserSessionCoordinator = {
  current: () => publicEvent(readCurrentEvent()),
  isCurrent: (epoch) => readCurrentEvent().epoch === epoch,
  publish: (state, userId) => {
    const event: StoredBrowserSessionEvent = {
      epoch: readCurrentEvent().epoch + 1,
      sourceId,
      state,
      ...(userId ? { userId } : {}),
    };
    currentEvent = event;
    try {
      globalThis.localStorage?.setItem(browserSessionStorageKey, JSON.stringify(event));
    } catch {
      // Restricted browser contexts still retain the tab-local epoch.
    }
    try {
      getBroadcastChannel()?.postMessage(event);
    } catch {
      // Storage events remain the primary durable cross-tab signal.
    }
    return publicEvent(event);
  },
  subscribe: (listener) => {
    listeners.add(listener);
    attachStorageListener();
    getBroadcastChannel();
    return () => {
      listeners.delete(listener);
      detachStorageListenerIfIdle();
    };
  },
};

function readCurrentEvent() {
  try {
    const storedEvent = parseStoredEvent(
      globalThis.localStorage?.getItem(browserSessionStorageKey) ?? null,
    );
    if (storedEvent && storedEvent.epoch >= currentEvent.epoch) {
      currentEvent = storedEvent;
    }
  } catch {
    // Fall back to the last event observed in this JavaScript context.
  }
  return currentEvent;
}

function acceptRemoteEvent(candidate: unknown) {
  const event = parseStoredEvent(candidate);
  if (!event || event.sourceId === sourceId) return;
  if (event.epoch < readCurrentEvent().epoch) return;
  currentEvent = event;
  const nextEvent = publicEvent(event);
  listeners.forEach((listener) => listener(nextEvent));
}

function attachStorageListener() {
  if (storageListenerAttached || typeof window === 'undefined') return;
  window.addEventListener('storage', handleStorageEvent);
  storageListenerAttached = true;
}

function detachStorageListenerIfIdle() {
  if (!storageListenerAttached || listeners.size > 0 || typeof window === 'undefined') return;
  window.removeEventListener('storage', handleStorageEvent);
  storageListenerAttached = false;
}

function handleStorageEvent(event: StorageEvent) {
  if (event.key !== browserSessionStorageKey) return;
  acceptRemoteEvent(event.newValue);
}

function getBroadcastChannel() {
  if (broadcastChannel !== undefined) return broadcastChannel;
  if (typeof BroadcastChannel === 'undefined') {
    broadcastChannel = null;
    return broadcastChannel;
  }
  broadcastChannel = new BroadcastChannel(browserSessionChannelName);
  broadcastChannel.addEventListener('message', (event) => {
    acceptRemoteEvent(event.data);
  });
  return broadcastChannel;
}

function parseStoredEvent(value: unknown): StoredBrowserSessionEvent | null {
  try {
    const parsed = typeof value === 'string'
      ? JSON.parse(value) as Partial<StoredBrowserSessionEvent>
      : value as Partial<StoredBrowserSessionEvent> | null;
    if (
      !parsed ||
      !Number.isSafeInteger(parsed.epoch) ||
      (parsed.epoch ?? -1) < 0 ||
      typeof parsed.sourceId !== 'string' ||
      (parsed.state !== 'authenticated' && parsed.state !== 'cleared') ||
      (parsed.userId !== undefined && typeof parsed.userId !== 'string')
    ) {
      return null;
    }
    return {
      epoch: parsed.epoch as number,
      sourceId: parsed.sourceId,
      state: parsed.state,
      ...(parsed.userId ? { userId: parsed.userId } : {}),
    };
  } catch {
    return null;
  }
}

function publicEvent(event: StoredBrowserSessionEvent): BrowserSessionEvent {
  return {
    epoch: event.epoch,
    state: event.state,
    ...(event.userId ? { userId: event.userId } : {}),
  };
}

function createId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
