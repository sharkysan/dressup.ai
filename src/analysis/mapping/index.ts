import type { Catalog } from '../../catalog/catalog';
import { avatarParamsSchema, defaultParams, type AvatarParams } from '../../catalog/params';
import type { Calibration } from '../calibration';
import { medianColorTrimmed } from '../color';
import { faceBox as boxOf, headPose, toPixels } from '../landmarks';
import { categoryEquals, resampleMask, restrictToBox } from '../masks';
import { MASK, type Analysis, type Box } from '../types';
import { extractBrows } from './brows';
import { extractEyeColor } from './eyes';
import { measureRatios, ratiosToFaceShape, type Ratios } from './faceShape';
import { browRegionMask, hairRegion, hairTags, type HairTags } from './hair';
import { extractHairColor } from './hairColor';
import { rankHairstyles } from './hairstyle';
import { extractLipTint } from './lips';
import { extractSkin } from './skin';

export type AnalysisDebug = {
  pose: { yaw: number; pitch: number; roll: number };
  faceBox: Box;
  ratios: Ratios;
  zScores: Ratios;
  hairTags: HairTags;
  hairCandidates: { id: string; name: string; distance: number }[];
  swatches: { skin: string; hair: string | null; lips: string; eyeSample: string | null };
  brows: AvatarParams['brows'];
};

export type AnalyzeOptions = {
  calibration: Calibration;
  catalog: Catalog | null;
  base: 'a' | 'b';
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
  const lipTint = extractLipTint(image, pixels);
  const brows = extractBrows(pixels);
  const ratios = measureRatios(face);
  const { faceShape, zScores } = ratiosToFaceShape(ratios, opts.calibration);
  const ranked = opts.catalog && tags.present ? rankHairstyles(tags, opts.catalog, opts.base) : [];

  const params = avatarParamsSchema.parse({
    ...(opts.current ?? defaultParams),
    base: opts.base,
    skin,
    hairColor,
    eyeColor: eyes.preset,
    lipTint,
    hair: ranked[0]?.style.id ?? 'none',
    brows,
    faceShape,
    pose: 'stand_neutral',
    expression: 'neutral',
  } satisfies AvatarParams);

  return {
    params,
    debug: {
      pose: headPose(face.matrix),
      faceBox,
      ratios,
      zScores,
      hairTags: tags,
      hairCandidates: ranked
        .slice(0, 5)
        .map((r) => ({ id: r.style.id, name: r.style.name, distance: r.distance })),
      swatches: { skin, hair: hairSwatch, lips: lipTint, eyeSample: eyes.sample },
      brows,
    },
  };
}
