"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import type { SceneManifest } from "@interior-design/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BufferGeometry, Material, Object3D } from "three";
import { Box3, Color, Mesh, MeshStandardMaterial, PerspectiveCamera, Plane, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

import { createViewerMetricsRecorder } from "./metrics";

export type ViewerControlMode = "orbit" | "walk";
export type ViewerMaterialMode = "material" | "status";
export type WalkDirection = "backward" | "forward" | "left" | "right";

export interface WalkCommand {
  readonly direction: WalkDirection;
  readonly nonce: number;
}

interface SceneCanvasProps {
  readonly controlMode: ViewerControlMode;
  readonly glb: ArrayBuffer;
  readonly manifest: SceneManifest;
  readonly materialMode: ViewerMaterialMode;
  readonly movement: WalkCommand | undefined;
  readonly onContextLost: () => void;
  readonly onReady: () => void;
  readonly onSelect: (elementId: string) => void;
  readonly reducedMotion: boolean;
  readonly resetNonce: number;
  readonly sectionEnabled: boolean;
  readonly sectionHeightMm: number;
  readonly selectedElementId: string | undefined;
  readonly visibleLevelIds: ReadonlySet<string>;
}

interface SceneRuntimeProps extends Omit<SceneCanvasProps, "glb" | "onContextLost"> {
  readonly gltf: GLTF;
}

const mappedColour = new Color("#9ab49f");
const findingColour = new Color("#c78742");
const selectedColour = new Color("#e7b95f");

function disposeScene(scene: Object3D): void {
  scene.traverse((object) => {
    if (!isMaterialMesh(object)) return;
    object.geometry.dispose();
    meshMaterials(object).forEach((material) => {
      material.dispose();
    });
  });
}

type MaterialMesh = Mesh<BufferGeometry, Material | Material[]>;

function isMaterialMesh(object: Object3D): object is MaterialMesh {
  return object instanceof Mesh;
}

function meshMaterials(mesh: MaterialMesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function useParsedGlb(glb: ArrayBuffer): { readonly error?: Error; readonly gltf?: GLTF } {
  const [state, setState] = useState<{ readonly error?: Error; readonly gltf?: GLTF }>({});
  useEffect(() => {
    let active = true;
    const loader = new GLTFLoader();
    void loader
      .parseAsync(glb.slice(0), "")
      .then((gltf) => {
        if (!active) {
          disposeScene(gltf.scene);
          return;
        }
        setState({ gltf });
      })
      .catch((reason: unknown) => {
        if (active)
          setState({ error: reason instanceof Error ? reason : new Error("GLB parsing failed.") });
      });
    return () => {
      active = false;
    };
  }, [glb]);
  useEffect(
    () => () => {
      if (state.gltf) disposeScene(state.gltf.scene);
    },
    [state.gltf],
  );
  return state;
}

export function SceneCanvas(props: SceneCanvasProps) {
  const parsed = useParsedGlb(props.glb);
  if (parsed.error) {
    throw parsed.error;
  }
  if (!parsed.gltf) {
    return (
      <div className="scene-canvas-loading" role="status">
        <span aria-hidden="true" />
        <strong>Preparing verified GLB</strong>
        <p>The model is not marked ready until GLTFLoader finishes parsing it.</p>
      </div>
    );
  }
  return (
    <Canvas
      aria-label="Interactive derived 3D home scene"
      camera={{ far: 10_000, fov: 45, near: 0.01, position: [6, 5, 7] }}
      className="scene-canvas"
      dpr={[1, 1.5]}
      fallback={<p>WebGL could not be initialized. Use the DOM model summary.</p>}
      frameloop="demand"
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
        gl.domElement.tabIndex = -1;
        const lost = (event: Event) => {
          event.preventDefault();
          props.onContextLost();
        };
        gl.domElement.addEventListener("webglcontextlost", lost, { once: true });
      }}
      onPointerMissed={() => {
        props.onSelect("");
      }}
      role="img"
      tabIndex={-1}
    >
      <color args={["#e9ece6"]} attach="background" />
      <ambientLight intensity={1.25} />
      <directionalLight intensity={2.1} position={[4, 9, 5]} />
      <SceneRuntime {...props} gltf={parsed.gltf} />
    </Canvas>
  );
}

function SceneRuntime({
  controlMode,
  gltf,
  manifest,
  materialMode,
  movement,
  onReady,
  onSelect,
  reducedMotion,
  resetNonce,
  sectionEnabled,
  sectionHeightMm,
  selectedElementId,
  visibleLevelIds,
}: SceneRuntimeProps) {
  const { camera, gl, invalidate } = useThree();
  const metrics = useMemo(() => createViewerMetricsRecorder(), []);
  const controlsRef = useRef<OrbitControls | undefined>(undefined);
  const nodeByElementRef = useRef(new Map<string, Object3D>());
  const canonicalByObjectRef = useRef(new WeakMap<Object3D, string>());
  const originalColourRef = useRef(new WeakMap<Material, Color>());
  const [associationsReady, setAssociationsReady] = useState(false);
  const readyReportedRef = useRef(false);

  useEffect(() => {
    window.__C10_VIEWER_METRICS__ = metrics.api;
    return () => {
      if (window.__C10_VIEWER_METRICS__ === metrics.api) delete window.__C10_VIEWER_METRICS__;
    };
  }, [metrics]);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 120;
    controls.minDistance = 0.5;
    const onChange = () => {
      invalidate();
    };
    controls.addEventListener("change", onChange);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener("change", onChange);
      controls.dispose();
      controlsRef.current = undefined;
    };
  }, [camera, gl.domElement, invalidate, reducedMotion]);

  useEffect(() => {
    let active = true;
    void gltf.parser.getDependencies("node").then((nodes: Object3D[]) => {
      if (!active) return;
      const nodeByElement = new Map<string, Object3D>();
      const canonicalByObject = new WeakMap<Object3D, string>();
      for (const mapping of manifest.elementMappings) {
        for (const nodeIndex of mapping.nodeIndices) {
          const node = nodes[nodeIndex];
          if (!node) continue;
          nodeByElement.set(mapping.elementId, node);
          node.traverse((object) => canonicalByObject.set(object, mapping.elementId));
        }
      }
      gltf.scene.traverse((object) => {
        if (!isMaterialMesh(object)) return;
        const cloned = meshMaterials(object).map((material) => {
          const next: Material = material.clone();
          if (next instanceof MeshStandardMaterial) {
            originalColourRef.current.set(next, next.color.clone());
          }
          return next;
        });
        object.material = Array.isArray(object.material) ? cloned : (cloned[0] ?? object.material);
      });
      nodeByElementRef.current = nodeByElement;
      canonicalByObjectRef.current = canonicalByObject;
      setAssociationsReady(true);
      invalidate();
    });
    return () => {
      active = false;
    };
  }, [gltf, invalidate, manifest.elementMappings]);

  const resetCamera = useCallback(() => {
    const bounds = new Box3().setFromObject(gltf.scene);
    const centre = bounds.getCenter(new Vector3());
    const size = Math.max(1, bounds.getSize(new Vector3()).length());
    camera.position.set(centre.x + size * 0.75, centre.y + size * 0.65, centre.z + size * 0.9);
    if (camera instanceof PerspectiveCamera) {
      camera.far = Math.max(1_000, size * 20);
      camera.updateProjectionMatrix();
    }
    controlsRef.current?.target.copy(centre);
    controlsRef.current?.update();
    camera.lookAt(centre);
    invalidate();
  }, [camera, gltf.scene, invalidate]);

  useEffect(() => {
    resetCamera();
  }, [resetCamera, resetNonce]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = controlMode === "orbit";
    invalidate();
  }, [controlMode, invalidate]);

  useEffect(() => {
    if (!movement || controlMode !== "walk") return;
    const forward = camera.getWorldDirection(new Vector3());
    forward.y = 0;
    if (forward.lengthSq() === 0) forward.set(0, 0, -1);
    forward.normalize();
    const right = new Vector3().crossVectors(forward, camera.up).normalize();
    const delta =
      movement.direction === "forward"
        ? forward
        : movement.direction === "backward"
          ? forward.multiplyScalar(-1)
          : movement.direction === "right"
            ? right
            : right.multiplyScalar(-1);
    const minimumX = manifest.boundsMm.minimum.xMm / 1_000;
    const maximumX = manifest.boundsMm.maximum.xMm / 1_000;
    const minimumZ = -manifest.boundsMm.maximum.yMm / 1_000;
    const maximumZ = -manifest.boundsMm.minimum.yMm / 1_000;
    const next = camera.position.clone().addScaledVector(delta, 0.3);
    next.x = Math.min(maximumX, Math.max(minimumX, next.x));
    next.z = Math.min(maximumZ, Math.max(minimumZ, next.z));
    camera.position.copy(next);
    invalidate();
  }, [camera, controlMode, invalidate, manifest.boundsMm, movement]);

  useEffect(() => {
    const sectionPlane = new Plane(new Vector3(0, -1, 0), sectionHeightMm / 1_000);
    gltf.scene.traverse((object) => {
      if (!isMaterialMesh(object)) return;
      meshMaterials(object).forEach((material) => {
        material.clippingPlanes = sectionEnabled ? [sectionPlane] : [];
        material.clipShadows = sectionEnabled;
        material.needsUpdate = true;
      });
    });
    invalidate();
  }, [gltf.scene, invalidate, sectionEnabled, sectionHeightMm]);

  useEffect(() => {
    for (const mapping of manifest.elementMappings) {
      const node = nodeByElementRef.current.get(mapping.elementId);
      if (node && mapping.elementType === "level") {
        node.visible = visibleLevelIds.has(mapping.elementId);
      }
      if (!node) continue;
      node.traverse((object) => {
        if (!isMaterialMesh(object)) return;
        meshMaterials(object).forEach((material) => {
          if (!(material instanceof MeshStandardMaterial)) return;
          const original = originalColourRef.current.get(material);
          if (selectedElementId === mapping.elementId) material.color.copy(selectedColour);
          else if (materialMode === "status") {
            material.color.copy(mapping.findingCodes.length > 0 ? findingColour : mappedColour);
          } else if (original) material.color.copy(original);
          material.needsUpdate = true;
        });
      });
    }
    invalidate();
  }, [
    associationsReady,
    invalidate,
    manifest.elementMappings,
    materialMode,
    selectedElementId,
    visibleLevelIds,
  ]);

  const selectFromCanvas = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      let current: Object3D | null = event.object;
      while (current) {
        const canonicalId = canonicalByObjectRef.current.get(current);
        if (canonicalId) {
          onSelect(canonicalId);
          return;
        }
        current = current.parent;
      }
    },
    [onSelect],
  );

  useFrame(() => {
    metrics.recordFrame(performance.now(), gl.info.render.calls);
    if (associationsReady && !readyReportedRef.current) {
      readyReportedRef.current = true;
      metrics.markReady(performance.now());
      onReady();
    }
    if (controlsRef.current?.enabled && controlsRef.current.enableDamping) {
      controlsRef.current.update();
    }
  });

  return (
    <group onClick={selectFromCanvas}>
      <primitive object={gltf.scene} />
    </group>
  );
}
