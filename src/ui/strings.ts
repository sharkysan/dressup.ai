export const strings = {
  appName: 'Kiss',
  saveImage: 'Save image',
  loadingAvatar: 'Loading avatar…',
  avatarLoadFailed: 'Could not load the avatar. Please reload the page.',
  webglUnsupported:
    "This browser can't show 3D. Please use a current version of Chrome, Firefox, Safari or Edge.",
  analysis: {
    loadingModels: 'Preparing face analysis…',
    analysing: 'Analysing your photo…',
    noFace: "We couldn't find a face. Try a well-lit photo, facing the camera.",
    faceTooSmall: 'The face is too small. Try a closer photo.',
    faceTurned: 'Please face the camera more directly.',
    decodeFailed: "We couldn't read that image. Please use a JPEG or PNG.",
    modelsFailed: "The face analysis files didn't download. Check your connection and try again.",
    privacy: 'Your photo never leaves your device.',
    retry: 'Try again',
    useDefault: 'Start from a default avatar',
  },
} as const;
