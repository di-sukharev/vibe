import {
  avatarContentTypeSchema,
  AVATAR_MAX_BYTES,
  AVATAR_MIN_BYTES,
  type AvatarContentType,
  type UploadTicket,
} from '@web-app-demo/contracts'

export type AvatarUploadFailure =
  /** The picked file is not a type or size the backend will issue a ticket for. */
  | 'unsupported-file'
  /** The file changed between asking for the ticket and sending it. */
  | 'size-changed'
  /** The network or the storage endpoint refused the transfer. */
  | 'transfer-failed'

export class AvatarUploadError extends Error {
  readonly reason: AvatarUploadFailure

  constructor(reason: AvatarUploadFailure, message: string) {
    super(message)
    this.name = 'AvatarUploadError'
    this.reason = reason
  }
}

/**
 * Browsers disagree about HEIC: Safari may report `image/heif`, and some report nothing at all
 * for a file picked from a phone. Falling back to the extension keeps a legitimate photo
 * uploadable, while anything still unrecognised is refused before a ticket is requested.
 */
export function resolveAvatarContentType(file: File): AvatarContentType | null {
  const declared = avatarContentTypeSchema.safeParse(file.type.toLowerCase())
  if (declared.success) return declared.data

  const extension = file.name.toLowerCase().split('.').pop()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'heic') return 'image/heic'
  if (extension === 'heif') return 'image/heif'

  return null
}

export function describeAvatarFile(file: File) {
  const contentType = resolveAvatarContentType(file)

  if (!contentType) {
    return { ok: false as const, reason: 'type' as const }
  }
  if (file.size < AVATAR_MIN_BYTES || file.size > AVATAR_MAX_BYTES) {
    return { ok: false as const, reason: 'size' as const }
  }

  return { ok: true as const, contentType, byteSize: file.size }
}

/**
 * Sends the file straight at the storage endpoint using the ticket's headers verbatim.
 *
 * A 412 is treated as success rather than an error. The upload key is signed write-once, so 412
 * means "this exact object is already stored" - which is what a retry after a dropped connection
 * looks like when the first attempt actually landed. Reporting it as a failure would leave the
 * user stuck on an upload that has, in fact, completed.
 */
export async function uploadAvatarObject(ticket: UploadTicket, file: File) {
  if (file.size !== ticket.contentLength) {
    throw new AvatarUploadError(
      'size-changed',
      'The file changed while it was being uploaded. Pick it again.',
    )
  }

  let response: Response
  try {
    response = await fetch(ticket.url, {
      method: ticket.method,
      headers: ticket.headers,
      body: file,
      // The ticket carries its own authority; sending cookies would only break the preflight.
      credentials: 'omit',
      mode: 'cors',
    })
  } catch {
    throw new AvatarUploadError(
      'transfer-failed',
      'The upload could not reach storage. Check your connection and try again.',
    )
  }

  if (!response.ok && response.status !== 412) {
    throw new AvatarUploadError(
      'transfer-failed',
      'Storage rejected the upload. Try again with a different file.',
    )
  }
}
