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
import { avatarRemoveErrorMessage, avatarUploadErrorMessage } from './avatar-messages';
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
  isRemoving: boolean;
  isUploading: boolean;
  notice: string | null;
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
    // Comfortably inside the download URL's lifetime, so a cached response never hands the
    // image loader a signature that has already expired.
    staleTime: 60_000,
  });

  const ownsOperation = useCallback(
    () => accountScope !== null && isAccountScopeCurrent(accountScope),
    [accountScope, isAccountScopeCurrent],
  );

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

    let picked;
    try {
      picked = await picker.pick();
    } catch (pickFailure) {
      setError({ message: avatarUploadErrorMessage(pickFailure), write: 'upload' });
      return;
    }

    // Cancelling is not a failure; nothing on screen should change.
    if (!picked) return;

    setIsUploading(true);
    try {
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
      }
    } finally {
      setIsUploading(false);
    }
  }, [api, commit, ownsOperation, picker, send]);

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
      }
    } finally {
      setIsRemoving(false);
    }
  }, [api, commit, ownsOperation]);

  const value = useMemo(
    () => ({
      avatar: avatarQuery.data?.avatar ?? null,
      error,
      isRemoving,
      isUploading,
      notice,
      removeAvatar,
      uploadAvatar,
    }),
    [
      avatarQuery.data,
      error,
      isRemoving,
      isUploading,
      notice,
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
