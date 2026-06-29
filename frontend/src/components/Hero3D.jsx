import { useMemo, useRef, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* Auto-rotating, mouse- + scroll-reactive 3D gold channel-letter "E".
   Self-contained (three + @react-three/fiber). Lazy-loaded by the landing. */

function ELetter({ scrollRef, reduced }) {
  const ref = useRef()
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0, 0); s.lineTo(3, 0); s.lineTo(3, 0.72); s.lineTo(1, 0.72)
    s.lineTo(1, 1.64); s.lineTo(2.5, 1.64); s.lineTo(2.5, 2.36); s.lineTo(1, 2.36)
    s.lineTo(1, 3.28); s.lineTo(3, 3.28); s.lineTo(3, 4); s.lineTo(0, 4); s.closePath()
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.9, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.11, bevelSegments: 4, curveSegments: 6,
    })
    g.center()
    return g
  }, [])
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime
    const px = state.pointer.x, py = state.pointer.y
    const sc = scrollRef.current || 0
    ref.current.rotation.y = (reduced ? 0 : t * 0.32) + px * 0.6 + sc * 1.1
    ref.current.rotation.x = -0.12 + py * 0.32
    ref.current.position.y = reduced ? 0 : Math.sin(t * 0.9) * 0.12
  })
  return (
    <mesh ref={ref} geometry={geo} scale={0.82}>
      <meshStandardMaterial color="#f9a600" metalness={0.7} roughness={0.3} emissive="#3a1f00" emissiveIntensity={0.4} />
    </mesh>
  )
}

export default function Hero3D() {
  const scrollRef = useRef(0)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    const onScroll = () => { scrollRef.current = Math.min(1, (window.scrollY || 0) / (window.innerHeight || 800)) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 7], fov: 38 }} gl={{ antialias: true, alpha: true }} style={{ width: '100%', height: '100%' }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 6]} intensity={2.8} color="#fff4de" />
      <directionalLight position={[-6, -3, 2]} intensity={1.3} color="#f9a600" />
      <pointLight position={[2, -5, 4]} intensity={30} color="#ffcf6e" />
      <ELetter scrollRef={scrollRef} reduced={reduced} />
    </Canvas>
  )
}
