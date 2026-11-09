#!/usr/bin/env bash
# Installs the pinned Blender toolchain (tools/blender/versions.env) into .blender/ (git-ignored): Blender,
# the MPFB and VRM add-ons (into BLENDER_USER_RESOURCES, never the user's own Blender config) and the
# MakeHuman asset packs. Idempotent: a step whose output already exists and verifies is skipped, so a
# second run downloads nothing. Ends with the smoke test. Written for bash 3.2 (macOS /bin/bash).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/env.sh"
DOWNLOADS="$BLENDER_HOME/downloads"
mkdir -p "$DOWNLOADS" "$BLENDER_USER_RESOURCES"

sha256_of() { shasum -a 256 "$1" | cut -d ' ' -f 1; }

# fetch <url> <sha256, empty while unpinned>: downloads into .blender/downloads/ (once) and verifies it.
# Sets FETCHED to the file's path and FETCHED_SHA256 to its digest.
fetch() {
  local url=$1 expected=$2 dest progress
  dest="$DOWNLOADS/$(basename "$url")"
  if [ ! -s "$dest" ]; then
    echo "downloading $url"
    # The asset mirror is slow and flaky: resume partial files, retry stalls (<1 kB/s for 2 min) and errors.
    # A progress bar only on a terminal: in CI logs it would print a line per update.
    if [ -t 2 ]; then progress=--progress-bar; else progress=-sS; fi
    curl --retry 5 --retry-delay 5 --retry-all-errors --connect-timeout 30 --speed-limit 1024 \
      --speed-time 120 -fL -C - "$progress" -o "$dest.part" "$url"
    mv "$dest.part" "$dest"
  fi
  FETCHED=$dest
  FETCHED_SHA256=$(sha256_of "$dest")
  if [ -z "$expected" ]; then
    echo "sha256 $FETCHED_SHA256  $(basename "$dest") (unpinned: record it in tools/blender/versions.env)"
  elif [ "$FETCHED_SHA256" != "$expected" ]; then
    rm -f "$dest"
    echo "sha256 mismatch for $(basename "$dest"): expected $expected, got $FETCHED_SHA256 (file deleted)" >&2
    exit 1
  fi
}

# --- Blender ---------------------------------------------------------------------------------------
installed_blender_version() {
  [ -x "$BLENDER" ] || return 0
  "$BLENDER" --version 2>/dev/null | awk 'NR == 1 { print $2 }'
}

install_blender() {
  local url sha mnt
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) url=$BLENDER_URL_MACOS_ARM64 sha=$BLENDER_SHA256_MACOS_ARM64 ;;
    Darwin-x86_64) url=$BLENDER_URL_MACOS_X64 sha=$BLENDER_SHA256_MACOS_X64 ;;
    Linux-x86_64) url=$BLENDER_URL_LINUX_X64 sha=$BLENDER_SHA256_LINUX_X64 ;;
    *)
      echo "no pinned Blender build for $(uname -s)-$(uname -m)" >&2
      exit 1
      ;;
  esac
  fetch "$url" "$sha"
  if [ "$(uname -s)" = Darwin ]; then
    mnt=$(mktemp -d)
    hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$FETCHED" > /dev/null
    rm -rf "$BLENDER_HOME/Blender.app" "$BLENDER_HOME/Blender.app.part"
    if ! ditto "$mnt/Blender.app" "$BLENDER_HOME/Blender.app.part"; then
      hdiutil detach "$mnt" -quiet || true
      exit 1
    fi
    hdiutil detach "$mnt" -quiet
    rmdir "$mnt"
    mv "$BLENDER_HOME/Blender.app.part" "$BLENDER_HOME/Blender.app"
  else
    rm -rf "$BLENDER_HOME/blender" "$BLENDER_HOME/blender.part"
    mkdir -p "$BLENDER_HOME/blender.part"
    tar -xJf "$FETCHED" -C "$BLENDER_HOME/blender.part" --strip-components 1
    mv "$BLENDER_HOME/blender.part" "$BLENDER_HOME/blender"
  fi
}

if [ "$(installed_blender_version)" = "$BLENDER_VERSION" ]; then
  echo "present: Blender $BLENDER_VERSION"
else
  install_blender
  if [ "$(installed_blender_version)" != "$BLENDER_VERSION" ]; then
    echo "installed Blender does not report version $BLENDER_VERSION ($BLENDER)" >&2
    exit 1
  fi
  echo "installed: Blender $BLENDER_VERSION"
fi

# --- Add-ons (Blender extensions) ------------------------------------------------------------------
repo_list=$("$BLENDER" --command extension repo-list)
# Each repository is listed as "<id>:" followed by indented "    directory: \"…\"" etc.
repo_dir=$(printf '%s\n' "$repo_list" | awk -v id="$BLENDER_EXT_REPO:" '
  $1 == id { found = 1; next }
  found && /^[^ \t]/ { exit }
  found && $1 == "directory:" { sub(/^[ \t]*directory: */, ""); gsub(/"/, ""); print; exit }')
if [ -z "$repo_dir" ]; then
  echo "Blender has no extension repository '$BLENDER_EXT_REPO'; repo-list printed:" >&2
  printf '%s\n' "$repo_list" >&2
  exit 1
fi

# install_extension <id> <version> <url> <sha256>
install_extension() {
  local id=$1 version=$2 manifest="$repo_dir/$1/blender_manifest.toml"
  if [ -f "$manifest" ] && grep -qx "version = \"$version\"" "$manifest"; then
    echo "present: $id $version"
    return
  fi
  fetch "$3" "$4"
  "$BLENDER" --command extension install-file -r "$BLENDER_EXT_REPO" --enable "$FETCHED"
  grep -qx "version = \"$version\"" "$manifest" || {
    echo "$id $version did not install into $repo_dir" >&2
    exit 1
  }
  echo "installed: $id $version"
}

install_extension mpfb "$MPFB_VERSION" "$MPFB_URL" "$MPFB_SHA256"
install_extension vrm "$VRM_VERSION" "$VRM_URL" "$VRM_SHA256"

# --- Asset packs -----------------------------------------------------------------------------------
# MPFB resolves its user-data dir itself; env.sh must agree, since later scripts read $MPFB_DATA.
mpfb_data=$("$HERE/run.sh" "$HERE/print_paths.py" | sed -n 's/^MPFB_DATA=//p')
if [ "$mpfb_data" != "$MPFB_DATA" ]; then
  echo "MPFB reports its user data at '$mpfb_data', env.sh expects MPFB_DATA='$MPFB_DATA'" >&2
  exit 1
fi

# install_pack <name> <url> <sha256> <dest>: unzips once; a stamp records the sha256 of the zip installed.
install_pack() {
  local name=$1 url=$2 sha=$3 dest=$4 stamp
  stamp="$dest/.$name.sha256"
  if [ -f "$stamp" ] && { [ -z "$sha" ] || [ "$(cat "$stamp")" = "$sha" ]; }; then
    echo "present: $name ($(cat "$stamp"))"
    return
  fi
  fetch "$url" "$sha"
  mkdir -p "$dest"
  unzip -qo "$FETCHED" -d "$dest"
  echo "$FETCHED_SHA256" > "$stamp"
  echo "installed: $name into $dest"
}

# The system-assets zip already has the user-data layout (packs/, skins/, eyes/, …).
install_pack makehuman_system_assets "$SYSTEM_ASSETS_URL" "$SYSTEM_ASSETS_SHA256" "$MPFB_DATA"
install_pack faceunits01 "$FACEUNITS_URL" "$FACEUNITS_SHA256" "$BLENDER_HOME/packs/faceunits01"

"$HERE/run.sh" "$HERE/smoke.py"
