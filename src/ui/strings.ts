export const strings = {
  appName: 'Kiss',
  saveImage: 'Save image',
  loadingAvatar: 'Loading avatar…',
  avatarLoadFailed: 'Could not load the avatar. Please reload the page.',
  webglUnsupported:
    "This browser can't show 3D. Please use a current version of Chrome, Firefox, Safari or Edge.",
  analysis: {
    loadingModels: 'Preparing photo analysis…',
    analysing: 'Analysing your photo…',
    noFace: "We couldn't find a face. Try a well-lit photo, facing the camera.",
    faceTooSmall: 'The face is too small. Try a closer or higher-resolution photo.',
    faceTurned: 'Please face the camera more directly.',
    decodeFailed: "We couldn't read that image. Please use a JPEG or PNG.",
    modelsFailed: "The photo analysis files didn't download. Check your connection and try again.",
    privacy: 'Your photo never leaves your device.',
    retry: 'Try again',
    useDefault: 'Start from a default avatar',
    likenessOk: 'Face large enough for a photo face',
    likenessTooSmall: 'Face too small for a photo face — using the default face',
    bodyGate: {
      ok: 'Body measured from the photo',
      no_pose: 'No body found — using a default body for your height',
      not_visible: 'Body not fully visible — using a default body for your height',
      turned: 'Body turned from the camera — using a default body for your height',
    },
    likenessFailed: "Couldn't build a photo face — using the default face",
  },
} as const;
