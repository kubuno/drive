import { Suspense, useRef, useState, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { X, Download, Box, Loader2, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileItem } from '@kubuno/drive'
import { filesApi } from '@kubuno/drive'
import { api } from '@kubuno/sdk'
// ── Supported formats ─────────────────────────────────────────────────────────

const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'ply']
const MODEL_MIMES = ['model/gltf-binary', 'model/gltf+json', 'model/obj', 'model/stl', 'model/ply']

export function is3dFile(file: FileItem): boolean {
  if (MODEL_MIMES.includes(file.mime_type)) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return MODEL_EXTENSIONS.includes(ext)
}

function getFormat(file: FileItem): 'glb' | 'gltf' | 'obj' | 'stl' | 'ply' | null {
  const mime = file.mime_type
  const ext  = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (mime === 'model/gltf-binary' || ext === 'glb')  return 'glb'
  if (mime === 'model/gltf+json'   || ext === 'gltf') return 'gltf'
  if (mime === 'model/obj'         || ext === 'obj')  return 'obj'
  if (mime === 'model/stl'         || ext === 'stl')  return 'stl'
  if (mime === 'model/ply'         || ext === 'ply')  return 'ply'
  return null
}

// ── Authenticated data fetch ──────────────────────────────────────────────────
// Downloads the file as ArrayBuffer via Axios (with Bearer token).
// Three.js loaders then parse the buffer directly — no internal XHR needed,
// which avoids any CSP connect-src restrictions on blob: URLs.

function useFileData(fileId: string) {
  const [data,    setData]    = useState<ArrayBuffer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)

    api.get(`/drive/${fileId}/download`, { responseType: 'arraybuffer' })
      .then(r => {
        if (!cancelled) setData(r.data as ArrayBuffer)
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger le fichier 3D.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [fileId])

  return { data, loading, error }
}

// ── Camera fitting ────────────────────────────────────────────────────────────

function fitCamera(
  object: THREE.Object3D,
  camera: THREE.Camera,
  controls: { target: THREE.Vector3; update(): void },
) {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return

  const center = box.getCenter(new THREE.Vector3())
  const size   = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  if (maxDim === 0) return

  if (camera instanceof THREE.PerspectiveCamera) {
    const fov  = camera.fov * (Math.PI / 180)
    const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.8
    camera.position.set(center.x + dist * 0.35, center.y + maxDim * 0.4, center.z + dist)
    camera.near = maxDim * 0.001
    camera.far  = maxDim * 200
    camera.updateProjectionMatrix()
  }

  controls.target.copy(center)
  controls.update()
}

// ── Model components — all parse from ArrayBuffer, no internal fetch ──────────

function GltfModel({ data, onError }: { data: ArrayBuffer; onError: () => void }) {
  const [scene, setScene] = useState<THREE.Group | null>(null)
  const ref     = useRef<THREE.Group>(null)
  const { camera } = useThree()
  const controls = useThree(s => s.controls) as { target: THREE.Vector3; update(): void } | null
  const fitted   = useRef(false)

  useEffect(() => {
    let cancelled = false
    new GLTFLoader().parse(
      data,
      '',
      (gltf) => { if (!cancelled) setScene(gltf.scene) },
      (err)  => { if (!cancelled) { console.error('GLTF parse error', err); onError() } },
    )
    return () => { cancelled = true }
  }, [data])

  useEffect(() => {
    if (fitted.current || !ref.current || !scene || !controls) return
    fitCamera(ref.current, camera, controls)
    fitted.current = true
  })

  if (!scene) return null
  return <primitive ref={ref} object={scene} />
}

function ObjModel({ data, onError }: { data: ArrayBuffer; onError: () => void }) {
  const ref      = useRef<THREE.Group>(null)
  const { camera } = useThree()
  const controls = useThree(s => s.controls) as { target: THREE.Vector3; update(): void } | null
  const fitted   = useRef(false)

  const obj = useMemo<THREE.Group | null>(() => {
    try {
      const text   = new TextDecoder().decode(data)
      const loaded = new OBJLoader().parse(text)
      loaded.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const hasColors = !!child.geometry.attributes.color
          child.material  = new THREE.MeshStandardMaterial({
            side: THREE.DoubleSide,
            vertexColors: hasColors,
            ...(hasColors ? {} : { color: '#b0b0b0' }),
          })
        }
      })
      return loaded
    } catch {
      return null
    }
  }, [data])

  useEffect(() => {
    if (!obj) { onError(); return }
  }, [obj])

  useEffect(() => {
    if (fitted.current || !ref.current || !obj || !controls) return
    fitCamera(ref.current, camera, controls)
    fitted.current = true
  })

  if (!obj) return null
  return <primitive ref={ref} object={obj} />
}

function StlModel({ data, onError }: { data: ArrayBuffer; onError: () => void }) {
  const ref      = useRef<THREE.Mesh>(null)
  const { camera } = useThree()
  const controls = useThree(s => s.controls) as { target: THREE.Vector3; update(): void } | null
  const fitted   = useRef(false)

  const geom = useMemo<THREE.BufferGeometry | null>(() => {
    try {
      const g = new STLLoader().parse(data)
      g.computeVertexNormals()
      return g
    } catch {
      return null
    }
  }, [data])

  useEffect(() => {
    if (!geom) { onError(); return }
  }, [geom])

  useEffect(() => {
    if (fitted.current || !ref.current || !geom || !controls) return
    fitCamera(ref.current, camera, controls)
    fitted.current = true
  })

  if (!geom) return null
  return (
    <mesh ref={ref} geometry={geom}>
      <meshStandardMaterial color="#88aacc" side={THREE.DoubleSide} />
    </mesh>
  )
}

function PlyModel({ data, onError }: { data: ArrayBuffer; onError: () => void }) {
  const ref      = useRef<THREE.Mesh>(null)
  const { camera } = useThree()
  const controls = useThree(s => s.controls) as { target: THREE.Vector3; update(): void } | null
  const fitted   = useRef(false)

  const geom = useMemo<THREE.BufferGeometry | null>(() => {
    try {
      const g = new PLYLoader().parse(data)
      g.computeVertexNormals()
      return g
    } catch {
      return null
    }
  }, [data])

  useEffect(() => {
    if (!geom) { onError(); return }
  }, [geom])

  useEffect(() => {
    if (fitted.current || !ref.current || !geom || !controls) return
    fitCamera(ref.current, camera, controls)
    fitted.current = true
  })

  if (!geom) return null
  const hasColors = !!geom.attributes.color
  return (
    <mesh ref={ref} geometry={geom}>
      <meshStandardMaterial
        vertexColors={hasColors}
        color={hasColors ? undefined : '#88aacc'}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function Scene({ data, format, autoRotate, onModelError }: {
  data: ArrayBuffer
  format: ReturnType<typeof getFormat>
  autoRotate: boolean
  onModelError: () => void
}) {
  return (
    <>
      <OrbitControls
        makeDefault
        autoRotate={autoRotate}
        autoRotateSpeed={1.5}
        enableDamping
        dampingFactor={0.05}
      />
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 10, 7]} intensity={1.4} />
      <directionalLight position={[-4, -3, -5]} intensity={0.3} />
      <hemisphereLight args={['#b1e1ff', '#b97a20', 0.5]} />
      <Grid
        args={[100, 100]}
        cellColor="#444"
        sectionColor="#333"
        fadeDistance={60}
        renderOrder={-1}
      />
      {(format === 'glb' || format === 'gltf') && <GltfModel data={data} onError={onModelError} />}
      {format === 'obj' && <ObjModel data={data} onError={onModelError} />}
      {format === 'stl' && <StlModel data={data} onError={onModelError} />}
      {format === 'ply' && <PlyModel data={data} onError={onModelError} />}
    </>
  )
}

// ── Main viewer ───────────────────────────────────────────────────────────────

export default function Files3DViewer({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const { t } = useTranslation('drive')
  const [autoRotate, setAutoRotate] = useState(false)
  const [modelError, setModelError] = useState(false)
  const format = getFormat(file)
  const ext    = file.name.split('.').pop()?.toUpperCase() ?? '3D'
  const { data, loading, error } = useFileData(file.id)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-[#1a1a2e] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-black/60 border-b border-white/10">
        <Box size={15} className="text-white/50 flex-shrink-0" />
        <span className="text-white font-medium text-sm truncate flex-1">{file.name}</span>
        <span className="text-[11px] text-white/40 bg-white/10 px-2 py-0.5 rounded font-mono">{ext}</span>

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => setAutoRotate(v => !v)}
            className={`px-3 py-1.5 rounded text-xs transition-colors ${
              autoRotate
                ? 'bg-primary text-white'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            Auto-rotation
          </button>
          <a
            href={filesApi.downloadUrl(file.id)}
            download={file.name}
            className="p-2 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            title={t('common.download')}
          >
            <Download size={15} />
          </a>
          <button
            onClick={onClose}
            className="p-2 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            title={t('viewer.close_esc')}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/60">
            <Loader2 size={28} className="animate-spin" />
            <span className="text-sm">Chargement du modèle…</span>
          </div>
        )}

        {(error || modelError) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <AlertTriangle size={28} className="text-danger" />
            <span className="text-sm text-white/70">
              {error ?? 'Impossible de charger ou d\'analyser ce fichier 3D.'}
            </span>
          </div>
        )}

        {!format && data && !modelError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
            <Box size={40} />
            <p className="text-sm">Format 3D non supporté : {ext}</p>
          </div>
        )}

        {data && format && !modelError && (
          <>
            <Canvas camera={{ position: [0, 2, 5], fov: 45 }} shadows gl={{ antialias: true }}>
              <Suspense fallback={null}>
                <Scene data={data} format={format} autoRotate={autoRotate} onModelError={() => setModelError(true)} />
              </Suspense>
            </Canvas>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/30 text-xs pointer-events-none select-none whitespace-nowrap">
              Clic gauche : rotation · Molette : zoom · Clic droit : déplacement
            </div>
          </>
        )}
      </div>
    </div>
  )
}
