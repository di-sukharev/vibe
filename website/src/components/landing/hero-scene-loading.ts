export interface HeroSceneMediaQuery {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

export function watchHeroSceneEligibility(
  media: { desktop: HeroSceneMediaQuery; motion: HeroSceneMediaQuery },
  onChange: (eligible: boolean) => void,
) {
  const update = () => onChange(media.desktop.matches && media.motion.matches)

  media.desktop.addEventListener('change', update)
  media.motion.addEventListener('change', update)
  update()

  return () => {
    media.desktop.removeEventListener('change', update)
    media.motion.removeEventListener('change', update)
  }
}

// Whether the static fallback outline should be visible: hidden only once the
// R3F canvas has actually mounted and rendered a frame, so there is never a gap
// where neither the fallback nor the canvas is showing.
export function getHeroSceneFallbackClassName(isCanvasSceneVisible: boolean): string {
  return isCanvasSceneVisible ? 'hidden' : 'absolute inset-0'
}

export type HeroSceneFrameloop = 'always' | 'demand' | 'never'

// The canvas keeps re-rendering every frame ('always') only while it is both
// on-screen and allowed to animate; off-screen it must stop entirely ('never')
// rather than drawing 13 meshes nobody can see.
export function getHeroSceneFrameloop(
  isVisible: boolean,
  prefersReducedMotion: boolean,
): HeroSceneFrameloop {
  if (!isVisible) return 'never'
  return prefersReducedMotion ? 'demand' : 'always'
}

export function watchHeroSceneEnhancement<T>({
  load,
  media,
  onEligibilityChange,
  onLoadError = () => {},
  onLoaded,
}: {
  load: () => Promise<T>
  media: { desktop: HeroSceneMediaQuery; motion: HeroSceneMediaQuery }
  onEligibilityChange: (eligible: boolean) => void
  onLoadError?: (error: unknown) => void
  onLoaded: (scene: T) => void
}) {
  let loadStarted = false

  return watchHeroSceneEligibility(media, (eligible) => {
    onEligibilityChange(eligible)
    if (!eligible || loadStarted) return

    loadStarted = true
    void load().then(onLoaded, onLoadError)
  })
}
