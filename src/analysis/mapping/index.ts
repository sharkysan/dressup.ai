import type { Catalog } from '../../catalog/catalog';
import { avatarParamsSchema, defaultParams, type AvatarParams } from '../../catalog/params';
import { medianColorTrimmed } from '../color';
import { faceBox as boxOf, headPose, toPixels } from '../landmarks';
import { categoryEquals, resampleMask, restrictToBox } from '../masks';
import { MASK, type Analysis, type Box } from '../types';
import { extractEyeColor } from './eyes';
import { browRegionMask, hairRegion, hairTags, type HairTags } from './hair';
import { extractHairColor } from './hairColor';
import { rankHairstyles } from './hairstyle';
import { extractSkin } from './skin';

export type AnalysisDebug = {
  pose: { yaw: number; pitch: number; roll: number };
  faceBox: Box;
  hairTags: HairTags;
  hairCandidates: { id: string; name: string; distance: number }[];
  swatches: { skin: string; hair: string | null; eyeSample: string | null };
};

export type AnalyzeOptions = {
  catalog: Catalog | null;
  current?: AvatarParams;
};

/** Everything after detection: observation + masks + pixels → AvatarParams (spec §6 extraction table). */
export function analyzeToParams(
  analysis: Analysis,
  opts: AnalyzeOptions,
): { params: AvatarParams; debug: AnalysisDebug } {
  const { face, mask, image, faceBox } = analysis;
  const { width, height } = image;
  const pixels = toPixels(face);
  const upscale = (category: number) =>
    resampleMask(categoryEquals(mask, category), mask.width, mask.height, width, height);
  const faceSkin = upscale(MASK.faceSkin);
  // Hair is only considered within the region around this face (spec §6), for tags *and* colour,
  // so another person's hair never sets the avatar's hair colour.
  const hair = restrictToBox(
    upscale(MASK.hair),
    width,
    height,
    hairRegion(boxOf(pixels), width, height),
  );

  const skin = extractSkin(image, faceSkin, pixels);
  const tags = hairTags(hair, width, height, pixels);
  const hairSwatch = tags.present ? extractHairColor(image, hair) : null;
  const hairColor =
    hairSwatch ??
    medianColorTrimmed(image, browRegionMask(pixels, width, height), 0.1) ??
    defaultParams.hairColor;
  const eyes = extractEyeColor(image, pixels);
  const ranked = opts.catalog && tags.present ? rankHairstyles(tags, opts.catalog) : [];

  const params = avatarParamsSchema.parse({
    ...(opts.current ?? defaultParams),
    skin,
    hairColor,
    eyeColor: eyes.preset,
    hair: ranked[0]?.style.id ?? 'none',
    pose: 'stand_neutral',
    expression: 'neutral',
  } satisfies AvatarParams);

  return {
    params,
    debug: {
      pose: headPose(face.matrix),
      faceBox,
      hairTags: tags,
      hairCandidates: ranked
        .slice(0, 5)
        .map((r) => ({ id: r.style.id, name: r.style.name, distance: r.distance })),
      swatches: { skin, hair: hairSwatch, eyeSample: eyes.sample },
    },
  };
}
