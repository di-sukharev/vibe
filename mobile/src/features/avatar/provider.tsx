import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Avatar, AvatarResponse } from '@web-app-demo/contracts';

import { useAuth } from '@/features/auth';
import type { UploadSender } from '@/platform/uploads';
import type { AvatarApiPort } from './api';
import { uploadPickedAvatar } from './avatar-controller';
import {
  avatarPickErrorMessage,
  avatarRemoveErrorMessage,
  avatarUploadErrorMessage,
} from './avatar-messages';
import type { AvatarPickerPort } from './picker';

/**
 * Keyed by user rather than cleared on sign-out.
 *
 * A fixed key would need clearing when the account changes, and between the render that sees the
 * new user and the effect that clears the cache there is a frame where the previous account's
 * photo is still on screen. Keying by user means a different account simply reads a different
 * entry, so that window cannot exist.
 */
const avatarQueryKey = (userId: string) => ['avatar', 'current', userId] as const;

/** Which write failed, so the alert can name it instead of guessing. */
export type AvatarWrite = 'remove' | 'upload';

type AvatarContextValue = {
  avatar: Avatar | null;
  error: { message: string; write: AvatarWrite } | null;
  /**
   * The photo has never been read, so `avatar` says nothing about whether one exists.
   *
   * Deliberately not "the last read failed": a refetch that fails while an answer is already
   * cached leaves the screen correct, and both write failures trigger such a refetch - so the
   * wider reading would put a "photo could not be loaded" alert next to the photo.
   */
  isUnavailable: boolean;
  isRemoving: boolean;
  isUploading: boolean;
  notice: string | null;
  reload: () => void;
  removeAvatar: () => Promise<void>;
  uploadAvatar: () => Promise<void>;
};

const AvatarContext = createContext<AvatarContextValue | null>(null);

/**
 * Owns the current avatar and the two writes that change it.
 *
 * Writes are provider-owned callbacks with explicit flags rather than mutations, matching the
 * rest of this app. The reason is not only consistency: every write here has to survive a logout
 * or an account switch landing mid-flight, and committing a result into the cache for a session
 * that is gone would show one account another account's photo. That guard is expressed with the
 * session generation, which a generic mutation has no notion of.
 *
 * Everything native arrives as a prop - the api, the picker, and the byte sender - so this file
 * imports no Expo module and the feature stays testable from the outside.
 */
export function AvatarProvider({
  api,
  children,
  picker,
  send,
}: {
  api: AvatarApiPort;
  children: ReactNode;
  picker: AvatarPickerPort;
  send: UploadSender;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<AvatarContextValue['error']>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const { isAccountScopeCurrent } = auth;
  const accountScope = auth.accountScope;
  const userId = auth.user?.id ?? null;

  // A new account must not inherit the previous one's message or spinner. The query is keyed by
  // user so the photo itself is already safe, but this state is not - billing resets the same way.
  useEffect(() => {
    setError(null);
    setNotice(null);
    setIsRemoving(false);
    setIsUploading(false);
  }, [accountScope?.generation, userId]);

  const avatarQuery = useQuery({
    enabled: Boolean(userId),
    queryFn: () => api.getAvatar(),
    queryKey: avatarQueryKey(userId ?? ''),
    // Marks the response stale; it does not refetch. This provider is mounted at the root and
    // never remounts, and nothing here wires focus or connectivity refetching, so on a device
    // this query runs about once per session. On iOS and Android what then keeps the photo on
    // screen past the download URL's five-minute life is not this number but `avatarCacheKey`:
    // expo-image resolves by that key and never asks for the URL again. The web build ignores
    // `cacheKey` entirely and holds the image in the object URL that `expo-image` builds from
    // its own fetch, which dies with the component - so there a remount after five minutes
    // re-requests an expired signature. Both cases end at the fallback initials until the next
    // launch, and neither is visible to this provider: the query succeeded, only the image
    // loader failed, so `reload` is not offered for them. Accepted because the photo is
    // decorative and every action stays correct. A product that needs the picture itself to
    // recover should refetch on foreground, the way billing's `AppState` listener does, rather
    // than retry from the image's own error - which loops when storage is what is broken.
    staleTime: 60_000,
  });

  const ownsOperation = useCallback(
    () => accountScope !== null && isAccountScopeCurrent(accountScope),
    [accountScope, isAccountScopeCurrent],
  );

  /**
   * Re-reads the stored photo.
   *
   * The only recovery this feature has. A read failure is terminal without it - `retry` is off
   * app-wide, this query has no refetch trigger, and nothing else invalidates its key - so a
   * launch during a dropped connection would otherwise show initials, hide the Remove button,
   * and stay that way until the app is restarted.
   */
  const reload = useCallback(() => {
    if (userId) void queryClient.invalidateQueries({ queryKey: avatarQueryKey(userId) });
  }, [queryClient, userId]);

  const commit = useCallback(
    (response: AvatarResponse, successNotice: string) => {
      if (userId) queryClient.setQueryData(avatarQueryKey(userId), response);
      setNotice(successNotice);
      setError(null);
    },
    [queryClient, userId],
  );

  const uploadAvatar = useCallback(async () => {
    setError(null);
    setNotice(null);

    // Set before the picker opens, not after it returns. On a device the picker is a modal the
    // screen cannot be tapped through, but in a browser the file dialog leaves the page live, so
    // a second press would start a second ticket and a second transfer.
    setIsUploading(true);

    try {
      let picked;
      try {
        picked = await picker.pick();
      } catch (pickFailure) {
        if (ownsOperation()) {
          setError({ message: avatarPickErrorMessage(pickFailure), write: 'upload' });
        }
        return;
      }

      // Cancelling is not a failure; nothing on screen should change.
      if (!picked) return;

      const response = await uploadPickedAvatar({
        api,
        isCancelled: () => !ownsOperation(),
        picked,
        send,
      });

      if (response && ownsOperation()) commit(response, 'Photo updated.');
    } catch (uploadFailure) {
      // A failed upload leaves the existing photo alone: the cache is untouched, only the
      // message changes, so a working avatar is never lost to a bad attempt.
      if (ownsOperation()) {
        setError({ message: avatarUploadErrorMessage(uploadFailure), write: 'upload' });
        // The write may have committed and only its response been lost. Re-reading keeps the
        // screen honest about what the server actually holds, whichever way it went.
        reload();
      }
    } finally {
      // Guarded like every other write here. A slow upload can settle after its owner has been
      // replaced, and clearing the flag unconditionally would stop the *new* account's spinner
      // and re-enable its button mid-transfer. The scope-change effect above already cleared
      // this flag for the new session, so there is nothing left here to clean up.
      if (ownsOperation()) setIsUploading(false);
    }
  }, [api, commit, ownsOperation, picker, reload, send]);

  const removeAvatar = useCallback(async () => {
    setError(null);
    setNotice(null);
    setIsRemoving(true);

    try {
      const response = await api.removeAvatar();
      if (ownsOperation()) commit(response, 'Photo removed.');
    } catch (removeFailure) {
      if (ownsOperation()) {
        setError({ message: avatarRemoveErrorMessage(removeFailure), write: 'remove' });
        reload();
      }
    } finally {
      if (ownsOperation()) setIsRemoving(false);
    }
  }, [api, commit, ownsOperation, reload]);

  const value = useMemo(
    () => ({
      avatar: avatarQuery.data?.avatar ?? null,
      error,
      isRemoving,
      isUnavailable: avatarQuery.isLoadingError,
      isUploading,
      notice,
      reload,
      removeAvatar,
      uploadAvatar,
    }),
    [
      avatarQuery.data,
      avatarQuery.isLoadingError,
      error,
      isRemoving,
      isUploading,
      notice,
      reload,
      removeAvatar,
      uploadAvatar,
    ],
  );

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

export function useAvatar() {
  const context = useContext(AvatarContext);
  if (!context) throw new Error('useAvatar must be used inside AvatarProvider');
  return context;
}
