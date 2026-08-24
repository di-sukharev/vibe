import { useEffect, useRef, useState, type ComponentType } from 'react'

import { watchHeroSceneEnhancement } from './hero-scene-loading'

type CanvasSceneComponent = ComponentType<{ onReady: () => void }>

export default function HeroScene() {
  const [eligible, setEligible] = useState(false)
  const [CanvasScene, setCanvasScene] = useState<CanvasSceneComponent | null>(null)
  const [canvasReady, setCanvasReady] = useState(false)
  const eligibilityGeneration = useRef(0)

  useEffect(() => {
    let active = true
    const stopWatching = watchHeroSceneEnhancement({
      media: {
        desktop: window.matchMedia('(min-width: 1024px)'),
        motion: window.matchMedia('(prefers-reduced-motion: no-preference)'),
      },
      load: () => import('./HeroSceneCanvas'),
      onEligibilityChange: (nextEligible) => {
        eligibilityGeneration.current += 1
        setEligible(nextEligible)
        setCanvasReady(false)
      },
      onLoaded: ({ default: Scene }) => {
        if (active) setCanvasScene(() => Scene)
      },
      onLoadError: () => {
        // The static scene remains the complete, usable fallback.
      },
    })

    return () => {
      active = false
      stopWatching()
    }
  }, [])

  const canvasGeneration = eligibilityGeneration.current

  return (
    <div className="relative h-full min-h-[25rem] w-full overflow-hidden bg-[#0d0d0d]" data-hero-scene>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(255,255,255,0.13),transparent_46%),linear-gradient(145deg,rgba(23,23,23,0.98),rgba(7,7,7,1))]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] [background-size:2.4rem_2.4rem] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]"
        aria-hidden="true"
      />

      <div
        className={eligible && canvasReady ? 'hidden' : 'absolute inset-0'}
        data-hero-scene-fallback
        aria-hidden="true"
      >
        <div className="absolute top-1/2 left-1/2 h-72 w-80 -translate-x-1/2 -translate-y-1/2 rotate-6 rounded-[42%] border-2 border-white/55" />
        <div className="absolute top-1/2 left-1/2 h-48 w-60 -translate-x-1/2 -translate-y-1/2 -rotate-6 rounded-[40%] border border-white/35" />
        <div className="absolute top-1/2 left-1/2 h-24 w-72 -translate-x-1/2 -translate-y-1/2 rotate-3 rounded-[50%] border-2 border-white/65" />
        <div className="absolute top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70" />
        <div className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/50" />
      </div>

      {eligible && CanvasScene ? (
        <CanvasScene
          onReady={() => {
            if (canvasGeneration === eligibilityGeneration.current) setCanvasReady(true)
          }}
        />
      ) : null}
    </div>
  )
}
