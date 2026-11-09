/** Hair detection shared by removeHair and extractHair. VRoid: mesh 'Hair', materials '*_HAIR'; others: 'hair*'. */
export function isHairMeshName(name: string | undefined): boolean {
  return /^hair/i.test(name ?? '');
}

export function isHairMaterialName(name: string | undefined): boolean {
  return /(^hair|_hair$)/i.test(name ?? '');
}

export function isHairJointName(name: string | undefined): boolean {
  return /^J_Sec_Hair/i.test(name ?? '') || /^hair/i.test(name ?? '');
}
