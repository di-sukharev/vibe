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
