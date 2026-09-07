import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether the viewport matches a CSS media query, following it as the window is resized or the
 * query changes. The answer is read synchronously on the first render, so a component that
 * picks its markup from it never paints the other layout for a frame. Without `matchMedia`
 * (a static render) the answer is `false`.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mediaQueryList = window.matchMedia(query)
      mediaQueryList.addEventListener('change', onChange)
      return () => mediaQueryList.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = () => currentlyMatches(query)

  // The same reader serves as the static-render snapshot: this app has no server, and a render
  // without `matchMedia` gets the `false` the guard returns.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function currentlyMatches(query: string) {
  return typeof matchMedia === 'function' && matchMedia(query).matches
}
