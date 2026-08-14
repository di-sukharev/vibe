import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AvatarResponse } from '@web-app-demo/contracts';
import { beforeEach, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * The provider is where an upload meets a session that can change under it.
 *
 * The pure controller is tested without React, but it only sees the `isCancelled` probe it is
 * handed. The rules that decide what that probe answers - and what happens to the cache and the
 * spinner when an in-flight write outlives its account - live here and cannot be observed from
 * anywhere else.
 *
 * The DOM shim below is deliberately a copy of the one in `select-registration.test.tsx`
 * rather than a shared helper: every file under `tests/` is self-contained, and this file is
 * where the copy is cheaper than the coupling. `parked/iap-provider.test.tsx` carries a third
 * copy, which is what makes the point - a shared helper would have been parked with it.
 */

type FakeElement = FakeNode & {
  childNodes: FakeNode[];
  firstChild: FakeNode | null;
  namespaceURI: string;
  ownerDocument: typeof fakeDocument;
  style: Record<string, unknown>;
  tagName: string;
};

class FakeNode {
  childNodes: FakeNode[] = [];
  nodeType: number;
  nodeName: string;
  parentNode: FakeNode | null = null;

  constructor(nodeName: string) {
    this.nodeName = nodeName.toUpperCase();
    this.nodeType = nodeName === '#text' ? 3 : 1;
  }

  appendChild(node: FakeNode) {
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(node: FakeNode, beforeNode: FakeNode | null) {
    if (!beforeNode) return this.appendChild(node);
    const index = this.childNodes.indexOf(beforeNode);
    if (index === -1) return this.appendChild(node);
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node: FakeNode) {
    this.childNodes = this.childNodes.filter((child) => child !== node);
    node.parentNode = null;
    return node;
  }

  addEventListener() {}
  removeEventListener() {}

  get firstChild() {
    return this.childNodes[0] ?? null;
  }
}

class FakeDomElement extends FakeNode {
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  ownerDocument = fakeDocument;
  style: Record<string, unknown> = {};
  tagName: string;

  constructor(tagName: string) {
    super(tagName);
    this.tagName = this.nodeName;
  }

  setAttribute() {}
  removeAttribute() {}
}

const fakeDocument = {
  nodeType: 9,
  addEventListener() {},
  removeEventListener() {},
  createElement(tagName: string) {
    return new FakeDomElement(tagName) as FakeElement;
  },
  createElementNS(_namespaceURI: string, tagName: string) {
    return new FakeDomElement(tagName) as FakeElement;
  },
  createTextNode(text: string) {
    const node = new FakeNode('#text');
    Object.assign(node, { data: text, nodeValue: text });
    return node;
  },
};

Object.assign(globalThis, {
  document: fakeDocument,
  HTMLElement: FakeDomElement,
  HTMLIFrameElement: class HTMLIFrameElement extends FakeDomElement {},
  IS_REACT_ACT_ENVIRONMENT: true,
  window: globalThis,
});

const authState: { sessionGeneration: number; user: { id: string } | null } = {
  sessionGeneration: 1,
  user: { id: 'user-a' },
};

const accountScopes = new Map<string, { generation: number; userId: string }>();

function accountScopeFor(userId: string) {
  const key = `${authState.sessionGeneration}:${userId}`;
  const existing = accountScopes.get(key);
  if (existing) return existing;
  const scope = { generation: authState.sessionGeneration, userId };
  accountScopes.set(key, scope);
  return scope;
}

function isAccountScopeCurrent(scope: { generation: number; userId: string }) {
  return Boolean(authState.user && accountScopeFor(authState.user.id) === scope);
}

mock.module('@/features/auth', () => ({
  useAuth() {
    return {
      accountScope: authState.user ? accountScopeFor(authState.user.id) : null,
      isAccountScopeCurrent,
      user: authState.user,
    };
  },
}));

function avatarResponse(updatedAt: string): AvatarResponse {
  return {
    avatar: {
      byteSize: 2048,
      contentType: 'image/jpeg',
      downloadUrl: `https://storage.example/${updatedAt}?sig=abc`,
      downloadUrlExpiresAt: '2026-08-13T00:05:00.000Z',
      updatedAt,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, reject, resolve };
}

const ticket = {
  contentLength: 2048,
  expiresAt: '2026-08-13T00:15:00.000Z',
  headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
  method: 'PUT' as const,
  uploadId: '019c0000-0000-7000-8000-000000000001',
  url: 'https://storage.example/objects/avatars/abc?sig=1',
};

type ProviderProbe = {
  avatar: { downloadUrl: string } | null;
  error: { message: string; write: string } | null;
  isRemoving: boolean;
  isUnavailable: boolean;
  isUploading: boolean;
  notice: string | null;
  reload: () => void;
  removeAvatar: () => Promise<void>;
  uploadAvatar: () => Promise<void>;
};

let avatarByUser: Record<string, AvatarResponse>;
let createGate: ReturnType<typeof deferred<void>> | null;
let pickGate: ReturnType<typeof deferred<void>> | null;
let readFailures: number;
let steps: string[];
let finalizeGate: ReturnType<typeof deferred<AvatarResponse>> | null;
let removeGate: ReturnType<typeof deferred<AvatarResponse>> | null;
let latestContext: ProviderProbe | null;
let pickResult: { byteSize: number; contentType: 'image/jpeg'; uri: string } | null;
let queryClient: QueryClient;

beforeEach(() => {
  accountScopes.clear();
  authState.sessionGeneration = 1;
  authState.user = { id: 'user-a' };
  avatarByUser = {};
  createGate = null;
  pickGate = null;
  steps = [];
  readFailures = 0;
  finalizeGate = null;
  removeGate = null;
  latestContext = null;
  pickResult = { byteSize: 2048, contentType: 'image/jpeg', uri: 'file:///tmp/avatar.jpg' };
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

const api = {
  createUpload: async () => {
    steps.push('createUpload');
    if (createGate) await createGate.promise;
    return { upload: ticket };
  },
  finalizeUpload: async () => {
    steps.push('finalizeUpload');
    if (finalizeGate) return finalizeGate.promise;
    return avatarResponse('2026-08-13T00:00:00.000Z');
  },
  getAvatar: async () => {
    if (readFailures > 0) {
      readFailures -= 1;
      throw new Error('offline');
    }
    return avatarByUser[authState.user?.id ?? ''] ?? { avatar: null };
  },
  removeAvatar: async () => {
    if (removeGate) return removeGate.promise;
    return { avatar: null } as AvatarResponse;
  },
};

async function waitForEffects() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** React Query resolves over several turns; one is not enough to see the first response. */
async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await waitForEffects();
}

async function renderTree(root: Root) {
  const { AvatarProvider, useAvatar } = await import('../src/features/avatar/provider');

  function Probe() {
    latestContext = useAvatar() as unknown as ProviderProbe;
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AvatarProvider
          api={api as never}
          picker={{
            pick: async () => {
              if (pickGate) await pickGate.promise;
              return pickResult;
            },
          }}
          send={async () => {
            steps.push('send');
            return { status: 200 };
          }}>
          <Probe />
        </AvatarProvider>
      </QueryClientProvider>,
    );
    await waitForEffects();
  });
}

async function renderProvider() {
  const root = createRoot(fakeDocument.createElement('div'));
  await renderTree(root);
  await act(async () => {
    await settle();
  });
  return root;
}

async function unmount(root: Root) {
  await act(async () => {
    root.unmount();
    await waitForEffects();
  });
}

test('publishes the finalized photo for the account that uploaded it', async () => {
  const root = await renderProvider();

  await act(async () => {
    await latestContext?.uploadAvatar();
    await settle();
  });

  expect(latestContext?.avatar?.downloadUrl).toContain('2026-08-13T00:00:00.000Z');
  expect(latestContext?.notice).toBe('Photo updated.');
  expect(latestContext?.isUploading).toBe(false);
  await unmount(root);
});

test('does not publish an upload that finalizes after the account changed', async () => {
  // The whole reason the writes are provider-owned rather than plain mutations: a finalize that
  // lands after a logout would otherwise show one account another account's photo.
  finalizeGate = deferred<AvatarResponse>();
  const root = await renderProvider();

  let upload: Promise<void> | undefined;
  await act(async () => {
    upload = latestContext?.uploadAvatar();
    await settle();
  });

  authState.sessionGeneration = 2;
  authState.user = { id: 'user-b' };
  await act(async () => {
    await renderTree(root);
  });

  await act(async () => {
    finalizeGate?.resolve(avatarResponse('2026-08-13T00:00:00.000Z'));
    await upload;
    await settle();
  });

  expect(latestContext?.avatar).toBeNull();
  expect(latestContext?.notice).toBeNull();
  await unmount(root);
});

test('does not clear the new account uploading flag when the previous upload settles late', async () => {
  // Regression: an unguarded `finally` would stop user B's spinner and re-enable the button
  // while B's own transfer is still running, which permits a second concurrent upload.
  const gateForUserA = deferred<AvatarResponse>();
  finalizeGate = gateForUserA;
  const root = await renderProvider();

  let staleUpload: Promise<void> | undefined;
  await act(async () => {
    staleUpload = latestContext?.uploadAvatar();
    await settle();
  });

  authState.sessionGeneration = 2;
  authState.user = { id: 'user-b' };
  await act(async () => {
    await renderTree(root);
  });

  // B starts an upload of its own that never settles during this test.
  finalizeGate = deferred<AvatarResponse>();
  await act(async () => {
    void latestContext?.uploadAvatar();
    await settle();
  });
  expect(latestContext?.isUploading).toBe(true);

  await act(async () => {
    // A's finalize resolves now. Its `finally` must not touch B's state.
    gateForUserA.resolve(avatarResponse('2026-08-13T00:00:00.000Z'));
    await staleUpload;
    await settle();
  });

  expect(latestContext?.isUploading).toBe(true);
  await unmount(root);
});

test('keeps each account photo under its own key', async () => {
  avatarByUser['user-a'] = avatarResponse('2026-08-13T00:00:00.000Z');
  const root = await renderProvider();

  expect(latestContext?.avatar?.downloadUrl).toContain('2026-08-13T00:00:00.000Z');

  authState.sessionGeneration = 2;
  authState.user = { id: 'user-b' };
  await act(async () => {
    await renderTree(root);
    await settle();
  });

  // Not "cleared later" - user B reads a different cache entry, so there is no frame in which
  // A's photo is on screen for B.
  expect(latestContext?.avatar).toBeNull();
  await unmount(root);
});

test('treats a cancelled picker as a non-event', async () => {
  pickResult = null;
  const root = await renderProvider();

  await act(async () => {
    await latestContext?.uploadAvatar();
    await settle();
  });

  expect(latestContext?.isUploading).toBe(false);
  expect(latestContext?.error).toBeNull();
  expect(latestContext?.notice).toBeNull();
  await unmount(root);
});

test('keeps the existing photo when an upload fails', async () => {
  avatarByUser['user-a'] = avatarResponse('2026-08-13T00:00:00.000Z');
  finalizeGate = deferred<AvatarResponse>();
  const root = await renderProvider();

  await act(async () => {
    const upload = latestContext?.uploadAvatar();
    // Only reject once the flow is actually awaiting the gate, or the rejection is unobserved.
    await settle();
    finalizeGate?.reject(new Error('finalize exploded'));
    await upload;
    await settle();
  });

  // A bad attempt must not cost the person the photo they already had.
  expect(latestContext?.avatar?.downloadUrl).toContain('2026-08-13T00:00:00.000Z');
  expect(latestContext?.error?.write).toBe('upload');
  expect(latestContext?.isUploading).toBe(false);
  await unmount(root);
});

test('clears the photo and says so when a removal succeeds', async () => {
  avatarByUser['user-a'] = avatarResponse('2026-08-13T00:00:00.000Z');
  const root = await renderProvider();

  await act(async () => {
    await latestContext?.removeAvatar();
    await settle();
  });

  expect(latestContext?.avatar).toBeNull();
  expect(latestContext?.notice).toBe('Photo removed.');
  expect(latestContext?.isRemoving).toBe(false);
  await unmount(root);
});

test('does not clear the new account photo when a removal lands after the switch', async () => {
  // The destructive half of the pair, and the one where a missed guard is not recoverable by
  // retrying: user A's removal must not empty the cache entry user B is looking at.
  const gateForUserA = deferred<AvatarResponse>();
  removeGate = gateForUserA;
  avatarByUser['user-a'] = avatarResponse('2026-08-13T00:00:00.000Z');
  avatarByUser['user-b'] = avatarResponse('2026-08-13T09:00:00.000Z');
  const root = await renderProvider();

  let staleRemoval: Promise<void> | undefined;
  await act(async () => {
    staleRemoval = latestContext?.removeAvatar();
    await settle();
  });

  authState.sessionGeneration = 2;
  authState.user = { id: 'user-b' };
  await act(async () => {
    await renderTree(root);
    await settle();
  });

  await act(async () => {
    gateForUserA.resolve({ avatar: null } as AvatarResponse);
    await staleRemoval;
    await settle();
  });

  expect(latestContext?.avatar?.downloadUrl).toContain('2026-08-13T09:00:00.000Z');
  expect(latestContext?.notice).toBeNull();
  await unmount(root);
});

test('keeps the photo and names the failed write when a removal fails', async () => {
  avatarByUser['user-a'] = avatarResponse('2026-08-13T00:00:00.000Z');
  removeGate = deferred<AvatarResponse>();
  const root = await renderProvider();

  await act(async () => {
    const removal = latestContext?.removeAvatar();
    await settle();
    removeGate?.reject(new Error('remove exploded'));
    await removal;
    await settle();
  });

  expect(latestContext?.avatar?.downloadUrl).toContain('2026-08-13T00:00:00.000Z');
  // The alert titles itself from this, so a failed removal must not read "Photo was not saved".
  expect(latestContext?.error?.write).toBe('remove');
  expect(latestContext?.isRemoving).toBe(false);
  await unmount(root);
});

test('does not clear the new account removing flag when the previous removal settles late', async () => {
  // Same hazard as the upload flag: an unguarded `finally` stops user B's spinner and re-enables
  // a destructive button while B's own removal is still in flight.
  const gateForUserA = deferred<AvatarResponse>();
  removeGate = gateForUserA;
  const root = await renderProvider();

  let staleRemoval: Promise<void> | undefined;
  await act(async () => {
    staleRemoval = latestContext?.removeAvatar();
    await settle();
  });

  authState.sessionGeneration = 2;
  authState.user = { id: 'user-b' };
  await act(async () => {
    await renderTree(root);
    await settle();
  });

  removeGate = deferred<AvatarResponse>();
  await act(async () => {
    void latestContext?.removeAvatar();
    await settle();
  });
  expect(latestContext?.isRemoving).toBe(true);

  await act(async () => {
    gateForUserA.resolve({ avatar: null } as AvatarResponse);
    await staleRemoval;
    await settle();
  });

  expect(latestContext?.isRemoving).toBe(true);
  await unmount(root);
});

test('reports a failed read instead of pretending there is no photo', async () => {
  // Without this the card offers "Upload photo" to someone who already has one and hides
  // Remove - a wrong answer presented as a confident one.
  readFailures = 1;
  avatarByUser['user-a'] = avatarResponse('2026-08-13T00:00:00.000Z');
  const root = await renderProvider();

  expect(latestContext?.isUnavailable).toBe(true);
  expect(latestContext?.avatar).toBeNull();
  await unmount(root);
});

test('recovers the photo when the read is retried', async () => {
  // `retry` is off app-wide and nothing refetches this query, so without an explicit reload a
  // single failed read would stand until the app is restarted.
  readFailures = 1;
  avatarByUser['user-a'] = avatarResponse('2026-08-13T00:00:00.000Z');
  const root = await renderProvider();

  expect(latestContext?.isUnavailable).toBe(true);

  await act(async () => {
    latestContext?.reload();
    await settle();
  });

  expect(latestContext?.isUnavailable).toBe(false);
  expect(latestContext?.avatar?.downloadUrl).toContain('2026-08-13T00:00:00.000Z');
  await unmount(root);
});

test('re-reads after a failed write, since the response may have been the only thing lost', async () => {
  // finalize can commit server-side and lose its response. Leaving the cache alone would show a
  // photo the server no longer has, under a message saying nothing was saved.
  avatarByUser['user-a'] = avatarResponse('2026-08-13T00:00:00.000Z');
  finalizeGate = deferred<AvatarResponse>();
  const root = await renderProvider();

  avatarByUser['user-a'] = avatarResponse('2026-08-13T11:00:00.000Z');

  await act(async () => {
    const upload = latestContext?.uploadAvatar();
    await settle();
    finalizeGate?.reject(new Error('timed out'));
    await upload;
    await settle();
  });

  expect(latestContext?.error?.write).toBe('upload');
  expect(latestContext?.avatar?.downloadUrl).toContain('2026-08-13T11:00:00.000Z');
  await unmount(root);
});

test('does not claim the photo is unknown when a refetch fails but an answer is cached', async () => {
  // Both write failures trigger a reload, so an offline write makes the refetch fail too. Reading
  // that as "could not be loaded" would put a destructive alert next to the photo it describes.
  avatarByUser['user-a'] = avatarResponse('2026-08-13T00:00:00.000Z');
  const root = await renderProvider();

  expect(latestContext?.isUnavailable).toBe(false);

  readFailures = 1;
  await act(async () => {
    latestContext?.reload();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  // Proves the refetch really ran and really failed, so the assertion below is about the
  // provider's reading of that state rather than about a refetch that never happened.
  expect(readFailures).toBe(0);
  expect(latestContext?.isUnavailable).toBe(false);
  expect(latestContext?.avatar?.downloadUrl).toContain('2026-08-13T00:00:00.000Z');
  await unmount(root);
});

test('hands the new account a clean surface when a write is abandoned mid-flight', async () => {
  // The guarded `finally` blocks are only correct because this reset exists: user A's callback
  // will never clear a flag for user B, so without it B inherits a spinner that no code path can
  // stop, with both buttons disabled until the app restarts.
  finalizeGate = deferred<AvatarResponse>();
  const root = await renderProvider();

  await act(async () => {
    void latestContext?.uploadAvatar();
    await settle();
  });
  expect(latestContext?.isUploading).toBe(true);

  authState.sessionGeneration = 2;
  authState.user = { id: 'user-b' };
  await act(async () => {
    await renderTree(root);
    await settle();
  });

  expect(latestContext?.isUploading).toBe(false);
  expect(latestContext?.isRemoving).toBe(false);
  await unmount(root);
});

test('does not carry one account failure message onto the next account screen', async () => {
  removeGate = deferred<AvatarResponse>();
  const root = await renderProvider();

  await act(async () => {
    const removal = latestContext?.removeAvatar();
    await settle();
    removeGate?.reject(new Error('remove exploded'));
    await removal;
    await settle();
  });
  expect(latestContext?.error?.write).toBe('remove');

  authState.sessionGeneration = 2;
  authState.user = { id: 'user-b' };
  await act(async () => {
    await renderTree(root);
    await settle();
  });

  expect(latestContext?.error).toBeNull();
  expect(latestContext?.notice).toBeNull();
  await unmount(root);
});

test('stops an in-flight upload at the first step once the account has changed', async () => {
  // The sequence takes its cancellation probe from the provider. Handing it anything that does
  // not consult the session would let the transfer run for an account that is already gone.
  const gate = deferred<void>();
  createGate = gate;
  const root = await renderProvider();

  let staleUpload: Promise<void> | undefined;
  await act(async () => {
    staleUpload = latestContext?.uploadAvatar();
    await settle();
  });

  authState.sessionGeneration = 2;
  authState.user = { id: 'user-b' };
  await act(async () => {
    await renderTree(root);
    await settle();
  });

  await act(async () => {
    gate.resolve();
    await staleUpload;
    await settle();
  });

  expect(steps).toEqual(['createUpload']);
  await unmount(root);
});

test('disables the controls while the photo chooser is still open', async () => {
  // On a device the chooser is a modal the screen cannot be tapped through, but a browser file
  // dialog leaves the page live - so the flag has to be set before `pick()`, not after it
  // returns, or a second press starts a second ticket and a second transfer.
  const gate = deferred<void>();
  pickGate = gate;
  const root = await renderProvider();

  let upload: Promise<void> | undefined;
  await act(async () => {
    upload = latestContext?.uploadAvatar();
    await settle();
  });

  expect(latestContext?.isUploading).toBe(true);
  expect(steps).toEqual([]);

  await act(async () => {
    gate.resolve();
    await upload;
    await settle();
  });

  expect(latestContext?.isUploading).toBe(false);
  await unmount(root);
});
