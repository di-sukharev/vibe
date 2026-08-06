import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

type Point3 = [number, number, number]

// Monochrome scene: depth comes from two grey levels, not from hue.
const STROKE = '#ffffff'
const ACCENT = '#8a8a8a'
const DESIGN_WIDTH = 7.8
const DESIGN_HEIGHT = 7.2

const OUTER_CONTOUR: Point3[] = [
  [-1.72, 2.73, 0],
  [-0.42, 3.04, 0],
  [0.86, 2.93, 0],
  [2.08, 2.51, 0],
  [3.15, 1.62, 0],
  [3.55, 0.54, 0],
  [3.43, -0.72, 0],
  [2.82, -1.76, 0],
  [1.92, -2.61, 0],
  [0.62, -3.04, 0],
  [-0.84, -2.98, 0],
  [-2.08, -2.54, 0],
  [-3.12, -1.65, 0],
  [-3.46, -0.48, 0],
  [-3.38, 0.84, 0],
  [-2.84, 1.94, 0],
]

const MIDDLE_CONTOUR: Point3[] = [
  [-1.62, 2.02, 0],
  [-0.72, 2.44, 0],
  [0.42, 2.43, 0],
  [1.46, 2.12, 0],
  [2.43, 1.42, 0],
  [2.67, 0.38, 0],
  [2.53, -0.76, 0],
  [1.85, -1.71, 0],
  [0.87, -2.22, 0],
  [-0.3, -2.31, 0],
  [-1.45, -1.96, 0],
  [-2.31, -1.21, 0],
  [-2.68, -0.13, 0],
  [-2.49, 1.02, 0],
]

const INNER_CONTOUR: Point3[] = [
  [-0.96, 1.5, 0],
  [-0.24, 1.72, 0],
  [0.52, 1.53, 0],
  [1.18, 1.05, 0],
  [1.51, 0.28, 0],
  [1.42, -0.61, 0],
  [0.86, -1.32, 0],
  [0.08, -1.64, 0],
  [-0.72, -1.42, 0],
  [-1.31, -0.82, 0],
  [-1.5, 0.02, 0],
  [-1.36, 0.87, 0],
]

const EYE_CONTOUR: Point3[] = [
  [-3.06, -0.08, 0],
  [-2.12, 0.55, 0],
  [-0.86, 0.98, 0],
  [0.18, 1.07, 0],
  [1.5, 0.77, 0],
  [2.91, 0.13, 0],
  [1.82, -0.54, 0],
  [0.61, -0.96, 0],
  [-0.58, -1.02, 0],
  [-1.95, -0.64, 0],
]

function createEllipsePoints(radiusX: number, radiusY: number, rotation: number): Point3[] {
  return Array.from({ length: 72 }, (_, index) => {
    const angle = (index / 72) * Math.PI * 2
    const x = Math.cos(angle) * radiusX
    const y = Math.sin(angle) * radiusY

    return [
      x * Math.cos(rotation) - y * Math.sin(rotation),
      x * Math.sin(rotation) + y * Math.cos(rotation),
      0,
    ]
  })
}

const ORBIT_A = createEllipsePoints(3.08, 0.63, 0.1)
const ORBIT_B = createEllipsePoints(2.78, 0.78, -0.2)

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(true)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches)

    updatePreference()
    mediaQuery.addEventListener('change', updatePreference)

    return () => mediaQuery.removeEventListener('change', updatePreference)
  }, [])

  return prefersReducedMotion
}

function BlueprintPath({
  color = STROKE,
  opacity = 1,
  points,
  radius = 0.018,
}: {
  color?: string
  opacity?: number
  points: Point3[]
  radius?: number
}) {
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), true, 'centripetal'),
    [points],
  )

  return (
    <mesh>
      <tubeGeometry args={[curve, 112, radius, 6, true]} />
      <meshBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        opacity={opacity}
        toneMapped={false}
        transparent
      />
    </mesh>
  )
}

function CalibrationMark({ position, rotation }: { position: [number, number, number]; rotation: number }) {
  return (
    <mesh position={position} rotation={[0, 0, rotation]}>
      <boxGeometry args={[0.47, 0.035, 0.035]} />
      <meshBasicMaterial color={STROKE} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

function BlueprintPattern({ reducedMotion }: { reducedMotion: boolean }) {
  const rig = useRef<THREE.Group>(null)
  const orbitalLayer = useRef<THREE.Group>(null)
  const innerLayer = useRef<THREE.Group>(null)
  const viewport = useThree((state) => state.viewport)
  const patternScale = Math.min(viewport.width / DESIGN_WIDTH, viewport.height / DESIGN_HEIGHT) * 0.94

  useFrame(({ pointer }, delta) => {
    if (reducedMotion) return

    if (rig.current) {
      rig.current.rotation.x = THREE.MathUtils.damp(rig.current.rotation.x, pointer.y * 0.055, 3.4, delta)
      rig.current.rotation.y = THREE.MathUtils.damp(rig.current.rotation.y, pointer.x * 0.075, 3.4, delta)
    }

    if (orbitalLayer.current) {
      orbitalLayer.current.rotation.z += delta * 0.018
    }

    if (innerLayer.current) {
      innerLayer.current.rotation.z -= delta * 0.01
    }
  })

  return (
    <group ref={rig} scale={patternScale}>
      <BlueprintPath opacity={0.78} points={OUTER_CONTOUR} radius={0.022} />
      <BlueprintPath opacity={0.48} points={MIDDLE_CONTOUR} />

      <group ref={innerLayer}>
        <BlueprintPath color={ACCENT} opacity={0.52} points={INNER_CONTOUR} />
      </group>

      <group ref={orbitalLayer}>
        <BlueprintPath opacity={0.92} points={EYE_CONTOUR} radius={0.024} />
        <BlueprintPath color={ACCENT} opacity={0.54} points={ORBIT_A} radius={0.014} />
        <BlueprintPath opacity={0.58} points={ORBIT_B} radius={0.014} />
      </group>

      <mesh position={[0, 0, 0.08]}>
        <torusGeometry args={[0.66, 0.026, 8, 96]} />
        <meshBasicMaterial color={STROKE} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.09]}>
        <torusGeometry args={[0.27, 0.026, 8, 72]} />
        <meshBasicMaterial color={ACCENT} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.1]}>
        <circleGeometry args={[0.055, 32]} />
        <meshBasicMaterial color={STROKE} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>

      <CalibrationMark position={[-1.73, 2.83, 0.12]} rotation={-1.14} />
      <CalibrationMark position={[3.23, 1.29, 0.12]} rotation={0.42} />
      <CalibrationMark position={[1.26, -2.92, 0.12]} rotation={-1.08} />
      <CalibrationMark position={[-3.22, -1.42, 0.12]} rotation={0.42} />
    </group>
  )
}

export default function HeroScene() {
  const prefersReducedMotion = usePrefersReducedMotion()

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
      <Canvas
        aria-hidden="true"
        camera={{ position: [0, 0, 10], zoom: 70 }}
        dpr={[1, 1.5]}
        frameloop={prefersReducedMotion ? 'demand' : 'always'}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        orthographic
      >
        <BlueprintPattern reducedMotion={prefersReducedMotion} />
      </Canvas>
    </div>
  )
}
