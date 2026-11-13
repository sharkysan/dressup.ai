import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import type { AvatarParams } from '../catalog/params';
import { loadCorrespondence, type Correspondence } from '../likeness/correspondence';
import { applyLikeness, expandHeadOffsets } from '../likeness/likenessMorph';
import type { Likeness } from '../likeness/types';
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
import { SkinTexture, decodeImageData, loadImageData, type FaceComposite } from './bodyTexture';
import { HairModel } from './HairModel';
import { loadVrm } from './loadVrm';

type Avatar = { vrm: VRM; ctx: ApplyContext; corr: Correspondence };

/**
 * Loads a VRM with its base metadata, base layer and correspondence, reports status to the store,
 * applies AvatarParams and the likeness whenever they change, mounts the hairstyle, and ticks the VRM
 * every frame. Mount with `key={url}` so a URL change remounts.
 */
export function AvatarModel({ url }: { url: string }) {
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  // The params last applied to the avatar: prepare()'s at load, then each change the store brings.
  const applied = useRef<AvatarParams | null>(null);
  const setAvatarStatus = useAppStore((s) => s.setAvatarStatus);
  const setAvatarMetrics = useAppStore((s) => s.setAvatarMetrics);
  const hair = useAppStore((s) => s.params.hair);
  const hairColor = useAppStore((s) => s.params.hairColor);
  // The shown likeness's offsets of every Body vertex, for the hair to follow.
  const [likenessOffsets, setLikenessOffsets] = useState<Float32Array | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: Avatar | null = null;
    setAvatarStatus('loading');

    const vrmLoad = loadVrm(url);
    Promise.all([vrmLoad, loadMeta(), loadImageData(BASE_LAYER_URL), loadCorrespondence()])
      .then(([vrm, meta, baseLayer, corr]) => {
        if (cancelled) {
          disposeVrm(vrm);
          return;
        }
        const { params } = useAppStore.getState();
        loaded = prepare(vrm, meta, baseLayer, corr, params);
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
  // tint or a new likeness's face). Metrics follow a body change because Box3 ignores morph targets.
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

  // Show the store's likeness (spec §7): its face composited into the skin, its head offsets as the
  // likeness morph on the head meshes and the hair, the brows hidden; none shows the default face. The
  // face texture decodes asynchronously, so the latest likeness wins. Each likeness gets one
  // FaceComposite, reused by every later params change: the skin recomposites only on a new one.
  useEffect(() => {
    if (!avatar) return;
    let active = true;
    let latest: Likeness | null = null; // prepare() showed the default face
    const show = async (likeness: Likeness | null) => {
      if (likeness === latest) return;
      latest = likeness;
      let shown: { face: FaceComposite; full: Float32Array } | null = null;
      if (likeness) {
        try {
          shown = await faceFor(likeness, avatar.corr);
        } catch (error) {
          if (active && likeness === latest) warnDefaultFace(error);
        }
        if (!active || likeness !== latest) return; // superseded while decoding
      }
      const { params } = useAppStore.getState();
      setLikenessOffsets(showLikeness(avatar, shown, params));
      applied.current = params;
    };
    void show(useAppStore.getState().likeness);
    const unsubscribe = useAppStore.subscribe((state) => void show(state.likeness));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [avatar]);

  useFrame((_, delta) => {
    avatar?.vrm.update(delta);
  });

  if (!avatar) return null;
  return (
    <>
      <primitive object={avatar.vrm.scene} />
      <HairModel
        vrm={avatar.vrm}
        hairId={hair}
        hairColor={hairColor}
        likenessOffsets={likenessOffsets}
      />
    </>
  );
}

/**
 * Builds the skin canvas from the Skin material's loaded map, and its roughness map from the material's
 * roughness and the base layer, and applies `params`; the map the canvas replaces is freed.
 */
function prepare(
  vrm: VRM,
  meta: BaseMeta,
  baseLayer: ImageData,
  corr: Correspondence,
  params: AvatarParams,
): Avatar {
  const material = standardMaterial(vrm.scene, MATERIALS.skin);
  const original = material?.map;
  // GLTFLoader decodes to an ImageBitmap, or an HTMLImageElement where bitmaps are unsupported.
  const image = original?.image as ImageBitmap | HTMLImageElement | undefined;
  if (!material || !original || !image) {
    throw new Error(`the base has no ${MATERIALS.skin} material with a map`);
  }
  // The exported roughness, read before applyParams hands it to the roughness map.
  const skin = new SkinTexture(image, baseLayer, material.roughness);
  const ctx: ApplyContext = { skin, eyes: new EyeTextures(), meta, face: null };
  applyParams(vrm, params, ctx);
  original.dispose();
  if ('close' in image) image.close();
  return { vrm, ctx, corr };
}

/**
 * A likeness for the avatar: its face texture decoded into a FaceComposite over `faceUvRect`, and its
 * head offsets as offsets of every Body vertex. Rejects on a texture that won't decode or offsets
 * that don't fit the correspondence.
 */
async function faceFor(
  likeness: Likeness,
  corr: Correspondence,
): Promise<{ face: FaceComposite; full: Float32Array }> {
  const full = expandHeadOffsets(likeness.headOffsets, corr.head, corr.bodyVertexCount);
  const pixels = await decodeImageData(likeness.faceTexture);
  return { face: { pixels, sourceSkin: likeness.sourceSkin, rect: corr.faceUvRect }, full };
}

/**
 * Puts a likeness's face and head offsets on the avatar (null: the default face) and re-applies `params`
 * so the skin composites the face. Returns the offsets shown: null also when they don't fit the base.
 */
function showLikeness(
  avatar: Avatar,
  shown: { face: FaceComposite; full: Float32Array } | null,
  params: AvatarParams,
): Float32Array | null {
  try {
    applyLikeness(avatar.vrm.scene, shown?.full ?? null);
  } catch (error) {
    warnDefaultFace(error);
    shown = null;
    applyLikeness(avatar.vrm.scene, null);
  }
  avatar.ctx.face = shown?.face ?? null;
  applyParams(avatar.vrm, params, avatar.ctx);
  return shown?.full ?? null;
}

/** Why a likeness isn't shown. Names the failure only: nothing of the photo or the offsets (spec §3). */
function warnDefaultFace(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`the photo face can't be shown, so the default face is: ${reason}`);
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
