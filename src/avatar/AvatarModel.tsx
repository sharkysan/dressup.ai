import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import type { AvatarParams } from '../catalog/params';
import { useAppStore } from '../store/useAppStore';
import { applyParams, type ApplyContext } from './applyParams';
import {
  BASE_LAYER_URL,
  BASE_META_URL,
  MATERIALS,
  baseMetaSchema,
  type BaseMeta,
} from './baseContract';
import { EyeTextures, standardMaterial } from './baseMaterials';
import { SkinTexture, loadImageData } from './bodyTexture';
import { HairModel } from './HairModel';
import { loadVrm } from './loadVrm';

type Avatar = { vrm: VRM; ctx: ApplyContext };

/**
 * Loads a VRM with its base metadata and base layer, reports status to the store, applies AvatarParams
 * whenever they change, mounts the hairstyle, and ticks the VRM every frame. Mount with `key={url}` so
 * a URL change remounts.
 */
export function AvatarModel({ url }: { url: string }) {
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  // The params last applied to the avatar: prepare()'s at load, then each change the store brings.
  const applied = useRef<AvatarParams | null>(null);
  const setAvatarStatus = useAppStore((s) => s.setAvatarStatus);
  const setAvatarMetrics = useAppStore((s) => s.setAvatarMetrics);
  const hair = useAppStore((s) => s.params.hair);
  const hairColor = useAppStore((s) => s.params.hairColor);

  useEffect(() => {
    let cancelled = false;
    let loaded: Avatar | null = null;
    setAvatarStatus('loading');

    const vrmLoad = loadVrm(url);
    Promise.all([vrmLoad, loadMeta(), loadImageData(BASE_LAYER_URL)])
      .then(([vrm, meta, baseLayer]) => {
        if (cancelled) {
          disposeVrm(vrm);
          return;
        }
        const { params } = useAppStore.getState();
        loaded = prepare(vrm, meta, baseLayer, params);
        applied.current = params;
        setAvatarMetrics(measure(vrm, params.body.heightCm));
        setAvatar(loaded);
        setAvatarStatus('ready');
      })
      .catch((error: unknown) => {
        // The VRM may have loaded while the metadata or base layer failed: nothing else will free it.
        if (!loaded) vrmLoad.then(disposeVrm, () => undefined);
        if (cancelled) return;
        setAvatarStatus('error', error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      if (!loaded) return;
      loaded.ctx.skin.dispose();
      loaded.ctx.eyes.dispose();
      disposeVrm(loaded.vrm);
    };
  }, [url, setAvatarStatus, setAvatarMetrics]);

  // Re-apply params on every store change (cheap: absolute sets; the skin recomposites only on a new
  // tint). Metrics follow a body change because Box3 ignores morph targets.
  useEffect(() => {
    if (!avatar) return;
    const update = (params: AvatarParams) => {
      if (params === applied.current) return;
      const previous = applied.current;
      applyParams(avatar.vrm, params, avatar.ctx);
      applied.current = params;
      if (params.body !== previous?.body) {
        setAvatarMetrics(measure(avatar.vrm, params.body.heightCm));
      }
    };
    // Params set after prepare() read them and before this effect subscribed (e.g. the moment the
    // status turned ready) would otherwise wait for the next change: apply them now.
    update(useAppStore.getState().params);
    return useAppStore.subscribe((state) => update(state.params));
  }, [avatar, setAvatarMetrics]);

  useFrame((_, delta) => {
    avatar?.vrm.update(delta);
  });

  if (!avatar) return null;
  return (
    <>
      <primitive object={avatar.vrm.scene} />
      <HairModel vrm={avatar.vrm} hairId={hair} hairColor={hairColor} />
    </>
  );
}

/**
 * Builds the skin canvas from the Skin material's loaded map, and its roughness map from the material's
 * roughness and the base layer, and applies `params`; the map the canvas replaces is freed.
 */
function prepare(vrm: VRM, meta: BaseMeta, baseLayer: ImageData, params: AvatarParams): Avatar {
  const material = standardMaterial(vrm.scene, MATERIALS.skin);
  const original = material?.map;
  // GLTFLoader decodes to an ImageBitmap, or an HTMLImageElement where bitmaps are unsupported.
  const image = original?.image as ImageBitmap | HTMLImageElement | undefined;
  if (!material || !original || !image) {
    throw new Error(`the base has no ${MATERIALS.skin} material with a map`);
  }
  // The exported roughness, read before applyParams hands it to the roughness map.
  const skin = new SkinTexture(image, baseLayer, material.roughness);
  const ctx = { skin, eyes: new EyeTextures(), meta };
  applyParams(vrm, params, ctx);
  original.dispose();
  if ('close' in image) image.close();
  return { vrm, ctx };
}

const disposeVrm = (vrm: VRM) => VRMUtils.deepDispose(vrm.scene);

async function loadMeta(): Promise<BaseMeta> {
  const response = await fetch(BASE_META_URL);
  if (!response.ok) throw new Error(`Failed to load ${BASE_META_URL}: HTTP ${response.status}`);
  return baseMetaSchema.parse(await response.json());
}

/** Head-bone world height and requested height in metres, for camera framing. */
function measure(vrm: VRM, heightCm: number): { headY: number; height: number } {
  vrm.scene.updateMatrixWorld(true);
  const head = vrm.humanoid?.getRawBoneNode('head');
  const headY = head ? head.getWorldPosition(new Vector3()).y : (heightCm / 100) * 0.89;
  return { headY, height: heightCm / 100 };
}
