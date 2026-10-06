/**
 * The parts of `Files3DViewer.kbview` still written in React (the codemod could not convert them; see the
 * TODO comments in the view). Each is rendered by a `<ReactHost>` with the values it reads as props.
 */
import { Suspense, useRef, useState, useEffect, useMemo } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { OrbitControls, Grid } from "@react-three/drei"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import * as THREE from "three"
import { Download } from "lucide-react"
import type { FileItem } from "@kubuno/drive"
import { downloadSignedUrl } from "@kubuno/sdk"
import { fileSourceUrl } from "../services/externalPreview"
import type { Files3DViewer } from './Files3DViewer'
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
export { GltfModel }

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
export { ObjModel }

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
export { StlModel }

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
export { PlyModel }

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
export { Scene }

export function Part1({ file, t }: { file: NonNullable<Files3DViewer['props']['file']>; t: NonNullable<Files3DViewer['tr']> }) {
  return (
    <a
                href={fileSourceUrl(file)}
                download={file.name}
                onClick={e => { e.preventDefault(); void downloadSignedUrl(fileSourceUrl(file), file.name) }}
                className="p-2 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title={t('common.download')}
              >
                <Download size={15} />
              </a>
  )
}

export function Part2({ data, format, autoRotate, setModelError }: { data: NonNullable<Files3DViewer['data']>; format: NonNullable<Files3DViewer['format']>; autoRotate: NonNullable<Files3DViewer['autoRotate']>; setModelError: NonNullable<Files3DViewer['setModelError']> }) {
  return (
    <Canvas camera={{ position: [0, 2, 5], fov: 45 }} shadows gl={{ antialias: true }}>
                  <Suspense fallback={null}>
                    <Scene data={data} format={format} autoRotate={autoRotate} onModelError={() => setModelError(true)} />
                  </Suspense>
                </Canvas>
  )
}
