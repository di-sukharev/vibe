import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

type Point3 = [number, number, number]

const SATELLITES: Array<{ color: string; phase: number; position: Point3 }> = [
  { color: '#a7f3d0', phase: 0.4, position: [2.12, 0.72, 0.28] },
  { color: '#5eead4', phase: 1.8, position: [-1.72, 1.45, -0.16] },
  { color: '#bef264', phase: 3.1, position: [-1.2, -1.72, 0.42] },
  { color: '#fcd34d', phase: 4.5, position: [1.64, -1.48, -0.24] },
]
const PARTICLE_COUNT = 54
const PARTICLE_GOLDEN_ANGLE_RADIANS = 2.399963

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

function Satellite({
  color,
  phase,
  position,
  reducedMotion,
}: {
  color: string
  phase: number
  position: Point3
  reducedMotion: boolean
}) {
  const satellite = useRef<THREE.Group>(null)
  const originY = position[1]

  useFrame(({ clock }, delta) => {
    if (reducedMotion || !satellite.current) return

    const elapsed = clock.getElapsedTime()
    satellite.current.position.y = originY + Math.sin(elapsed * 0.8 + phase) * 0.1
    satellite.current.rotation.x += delta * 0.24
    satellite.current.rotation.y += delta * 0.32
  })

  return (
    <group ref={satellite} position={position}>
      <mesh>
        <octahedronGeometry args={[0.3, 0]} />
        <meshPhysicalMaterial
          clearcoat={1}
          clearcoatRoughness={0.16}
          color={color}
          emissive={color}
          emissiveIntensity={0.12}
          metalness={0.08}
          roughness={0.2}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.43, 0.018, 8, 64]} />
        <meshBasicMaterial color={color} opacity={0.58} transparent />
      </mesh>
    </group>
  )
}

function ProjectScene({ reducedMotion }: { reducedMotion: boolean }) {
  const rig = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)
  const orbitingSystem = useRef<THREE.Group>(null)

  const connectionPositions = useMemo(
    () =>
      new Float32Array(
        SATELLITES.flatMap(({ position }) => [0, 0, 0, position[0], position[1], position[2]]),
      ),
    [],
  )

  const particlePositions = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3)

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const radius = 2.7 + (index % 7) * 0.18
      const theta = index * PARTICLE_GOLDEN_ANGLE_RADIANS
      const phi = Math.acos(1 - (2 * (index + 0.5)) / PARTICLE_COUNT)

      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[index * 3 + 1] = radius * Math.cos(phi) * 0.78
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) * 0.58
    }

    return positions
  }, [])

  useFrame(({ pointer }, delta) => {
    if (reducedMotion) return

    if (rig.current) {
      rig.current.rotation.x = THREE.MathUtils.damp(
        rig.current.rotation.x,
        -0.14 + pointer.y * 0.12,
        3.2,
        delta,
      )
      rig.current.rotation.y = THREE.MathUtils.damp(
        rig.current.rotation.y,
        0.22 + pointer.x * 0.18,
        3.2,
        delta,
      )
    }

    if (core.current) {
      core.current.rotation.x += delta * 0.12
      core.current.rotation.y += delta * 0.18
    }

    if (orbitingSystem.current) {
      orbitingSystem.current.rotation.z += delta * 0.055
    }
  })

  return (
    <>
      <ambientLight intensity={1.5} />
      <directionalLight color="#ecfdf5" intensity={3.2} position={[3.5, 4.5, 5]} />
      <pointLight color="#34d399" intensity={12} position={[-3, -1, 3]} />
      <pointLight color="#fef3c7" intensity={8} position={[3, -2, 2]} />

      <group ref={rig} rotation={[-0.14, 0.22, -0.08]}>
        <mesh ref={core}>
          <icosahedronGeometry args={[1.22, 3]} />
          <meshPhysicalMaterial
            clearcoat={1}
            clearcoatRoughness={0.1}
            color="#10b981"
            emissive="#064e3b"
            emissiveIntensity={0.24}
            metalness={0.06}
            roughness={0.18}
            transmission={0.08}
          />
        </mesh>
        <mesh scale={1.025}>
          <icosahedronGeometry args={[1.22, 2]} />
          <meshBasicMaterial color="#d1fae5" opacity={0.15} transparent wireframe />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.48, 40, 40]} />
          <meshBasicMaterial color="#f0fdf4" opacity={0.32} transparent />
        </mesh>

        <group ref={orbitingSystem}>
          <mesh rotation={[Math.PI / 2.5, 0.12, 0.34]}>
            <torusGeometry args={[1.95, 0.016, 10, 128]} />
            <meshBasicMaterial color="#6ee7b7" opacity={0.48} transparent />
          </mesh>
          <mesh rotation={[Math.PI / 3.2, -0.54, -0.34]}>
            <torusGeometry args={[2.42, 0.012, 10, 128]} />
            <meshBasicMaterial color="#a7f3d0" opacity={0.3} transparent />
          </mesh>

          <lineSegments>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[connectionPositions, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color="#6ee7b7" opacity={0.22} transparent />
          </lineSegments>

          {SATELLITES.map((satellite) => (
            <Satellite key={satellite.phase} {...satellite} reducedMotion={reducedMotion} />
          ))}
        </group>
      </group>

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particlePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#6ee7b7"
          depthWrite={false}
          opacity={0.44}
          size={0.045}
          sizeAttenuation
          transparent
        />
      </points>
    </>
  )
}

export default function HeroScene() {
  const prefersReducedMotion = usePrefersReducedMotion()

  return (
    <div className="relative h-full min-h-[25rem] w-full overflow-hidden" data-hero-scene>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(16,185,129,0.2),transparent_34%),linear-gradient(145deg,rgba(236,253,245,0.94),rgba(255,255,255,0.3)_52%,rgba(209,250,229,0.72))]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(6,78,59,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(6,78,59,0.08)_1px,transparent_1px)] [background-size:2.75rem_2.75rem] [mask-image:radial-gradient(circle_at_center,black,transparent_72%)]"
        aria-hidden="true"
      />
      <Canvas
        aria-hidden="true"
        camera={{ fov: 38, position: [0, 0, 7.2] }}
        dpr={[1, 1.5]}
        frameloop={prefersReducedMotion ? 'demand' : 'always'}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <ProjectScene reducedMotion={prefersReducedMotion} />
      </Canvas>
    </div>
  )
}
