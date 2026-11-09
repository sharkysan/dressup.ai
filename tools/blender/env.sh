# Sourced (bash) by setup.sh and run.sh: the paths of the project-local Blender toolchain in .blender/.
# BLENDER_USER_RESOURCES keeps Blender's config, add-ons and MPFB's data inside the repo, away from the
# user's own Blender; a caller may point it elsewhere (e.g. an empty dir to exercise the failure path).
BLENDER_TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLENDER_HOME="$(cd "$BLENDER_TOOLS/../.." && pwd)/.blender"
# shellcheck source=versions.env
. "$BLENDER_TOOLS/versions.env"

case "$(uname -s)" in
  Darwin) BLENDER="$BLENDER_HOME/Blender.app/Contents/MacOS/Blender" ;;
  *) BLENDER="$BLENDER_HOME/blender/blender" ;;
esac
# The local extension repository Blender creates by default; add-ons are installed into it.
BLENDER_EXT_REPO=user_default

export BLENDER
export BLENDER_USER_RESOURCES="${BLENDER_USER_RESOURCES:-$BLENDER_HOME/user}"
# MPFB's user-data dir: <extension_path_user of the mpfb package>/data (setup.sh checks this against MPFB).
export MPFB_DATA="$BLENDER_USER_RESOURCES/extensions/.user/$BLENDER_EXT_REPO/mpfb/data"
# faceunits01, unzipped flat by setup.sh: this dir directly holds the <unit>.target files.
export FACEUNITS_DIR="$BLENDER_HOME/packs/faceunits01"
