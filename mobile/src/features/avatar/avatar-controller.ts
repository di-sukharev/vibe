import type { AvatarResponse } from '@web-app-demo/contracts';

import { sendUploadTicket, type UploadSender } from '@/platform/uploads';
import type { AvatarApiPort } from './api';
import type { PickedAvatar } from './picker';

/**
 * The upload sequence, as a plain function.
 *
 * Ticket, then bytes, then finalize - and finalize only after storage has the bytes, because it
 * is the step that verifies size, type, and magic bytes before publishing. Keeping the sequence
 * out of the provider is what lets it be tested without React and without a native module.
 */
export async function uploadPickedAvatar(input: {
  api: Pick<AvatarApiPort, 'createUpload' | 'finalizeUpload'>;
  isCancelled?: () => boolean;
  picked: PickedAvatar;
  send: UploadSender;
}): Promise<AvatarResponse | null> {
  // The picker can sit open for a long time. Checking before the first call keeps a pending
  // upload row from being minted - with the new session's token - for an account that never
  // asked for one.
  if (input.isCancelled?.()) return null;

  const { upload } = await input.api.createUpload({
    byteSize: input.picked.byteSize,
    contentType: input.picked.contentType,
  });

  // The session can change under a multi-step operation. Stopping here leaves an unfinalized
  // upload, which the backend sweeps; committing it would write into a session that is gone.
  if (input.isCancelled?.()) return null;

  await sendUploadTicket(
    upload,
    { byteSize: input.picked.byteSize, uri: input.picked.uri },
    { send: input.send },
  );

  if (input.isCancelled?.()) return null;

  return input.api.finalizeUpload(upload.uploadId);
}
