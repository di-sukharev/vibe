import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useAuth } from '@/features/auth'
import { createAvatarUpload, deleteAvatar, fetchAvatar, finalizeAvatarUpload } from './api'
import { AvatarUploadError, describeAvatarFile, uploadAvatarObject } from './upload'

function describeRejection(reason: 'type' | 'too-small' | 'too-large') {
  if (reason === 'type') return 'Pick a JPEG, PNG, or HEIC image.'
  if (reason === 'too-small') return 'That file is too small to be a photo. Pick another one.'
  return 'Pick an image smaller than 5 MB.'
}

export const avatarQueryKeys = {
  current: () => ['avatar', 'current'] as const,
}

export function useAvatarQuery() {
  const auth = useAuth()

  return useQuery({
    queryKey: avatarQueryKeys.current(),
    queryFn: () => fetchAvatar(auth.transport),
    // The download URL is short-lived, so a cached response outlives its own link. Refetching
    // well inside the window keeps the rendered image from breaking mid-session.
    staleTime: 60_000,
  })
}

export function useUploadAvatarMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      const described = describeAvatarFile(file)
      if (!described.ok) {
        throw new AvatarUploadError('unsupported-file', describeRejection(described.reason))
      }

      const { upload } = await createAvatarUpload(auth.transport, {
        contentType: described.contentType,
        byteSize: described.byteSize,
      })
      await uploadAvatarObject(upload, file)

      return finalizeAvatarUpload(auth.transport, upload.uploadId)
    },
    onSuccess: (response) => {
      queryClient.setQueryData(avatarQueryKeys.current(), response)
    },
  })
}

export function useDeleteAvatarMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => deleteAvatar(auth.transport),
    onSuccess: (response) => {
      queryClient.setQueryData(avatarQueryKeys.current(), response)
    },
  })
}

/**
 * Turns a signed download URL into a blob URL for `<img>`.
 *
 * Loading the image with `fetch` rather than pointing `<img src>` at the signed URL is what
 * keeps the two storage drivers behaving identically. `secureHeaders()` sets
 * `Cross-Origin-Resource-Policy: same-origin` on the API, which blocks a no-cors image load from
 * the web origin; a CORS-mode fetch is not subject to that rule, and an S3 endpoint answers the
 * same way. It also keeps a time-limited credential out of the DOM.
 */
export function useAvatarImage(downloadUrl: string | undefined) {
  // Keyed by the URL it was loaded from, so a stale blob is filtered out on render rather than
  // cleared with a synchronous setState in the effect body.
  const [loaded, setLoaded] = useState<{ source: string; objectUrl: string } | null>(null)

  useEffect(() => {
    if (!downloadUrl) return

    let cancelled = false
    let created: string | null = null

    void (async () => {
      try {
        const response = await fetch(downloadUrl, { credentials: 'omit', mode: 'cors' })
        if (!response.ok) return

        created = URL.createObjectURL(await response.blob())
        if (cancelled) {
          URL.revokeObjectURL(created)
          return
        }
        setLoaded({ source: downloadUrl, objectUrl: created })
      } catch {
        // A broken image is a cosmetic failure: the fallback initials stay in place.
      }
    })()

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [downloadUrl])

  return downloadUrl && loaded?.source === downloadUrl ? loaded.objectUrl : null
}
