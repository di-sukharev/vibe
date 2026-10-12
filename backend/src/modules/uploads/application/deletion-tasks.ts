export const abandonedUploadGraceMs = 60 * 60 * 1000

/** Delete promptly, then sweep any bytes written later through the old upload URL. */
export function avatarDeletionTasks(
  avatar: { objectKey: string; expiresAt: Date },
  now: Date,
) {
  const task = {
    type: 'uploads:delete-object',
    payload: { objectKey: avatar.objectKey },
  }
  const finalAt = new Date(avatar.expiresAt.getTime() + abandonedUploadGraceMs)
  return [
    { ...task, dedupeKey: `${avatar.objectKey}:immediate`, scheduledFor: now },
    ...(finalAt > now
      ? [{ ...task, dedupeKey: `${avatar.objectKey}:final`, scheduledFor: finalAt }]
      : []),
  ]
}
