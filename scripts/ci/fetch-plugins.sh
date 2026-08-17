#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
manifest=${OJ_PLUGIN_MANIFEST:-"$repo_root/crates/ojhost/tests/fixtures/realworld-plugins.toml"}
cache=${OJ_PLUGIN_CACHE:-"$repo_root/.cache/oj-plugins"}
selected=",${OJ_PLUGIN_IDS:-},"

mkdir -p "$cache/downloads" "$cache/plugins"

fetch_one() {
  local id=$1 version=$2 url=$3 expected=$4 archive=$5 plugin_file=$6
  if [[ "$selected" != ",," && "$selected" != *",$id,"* ]]; then return; fi
  local asset="$cache/downloads/${id}-${version}.${archive//./-}"
  local out="$cache/plugins/$id/$version"
  local ready="$out/.verified"
  if [[ -f "$ready" && "$(<"$ready")" == "$expected" ]] && find "$out" -name "$plugin_file" -print -quit | grep -q .; then
    echo "plugin-cache hit: $id $version"
    return
  fi
  if [[ ! -f "$asset" ]] || [[ "$(sha256sum "$asset" | cut -d' ' -f1)" != "$expected" ]]; then
    echo "downloading: $id $version"
    curl --fail --location --retry 3 --output "$asset.part" "$url"
    mv "$asset.part" "$asset"
  fi
  echo "$expected  $asset" | sha256sum --check --status || {
    echo "sha256 mismatch for $id" >&2
    exit 1
  }
  rm -rf "$out"
  mkdir -p "$out"
  case "$archive" in
    zip) unzip -q "$asset" -d "$out" ;;
    tar.gz) tar -xzf "$asset" -C "$out" ;;
    deb) dpkg-deb -x "$asset" "$out" ;;
    *) echo "unsupported archive: $archive" >&2; exit 1 ;;
  esac
  local plugin
  plugin=$(find "$out" -name "$plugin_file" -print -quit)
  [[ -n "$plugin" ]] || { echo "$plugin_file not found in $id" >&2; exit 1; }
  chmod +x "$plugin" 2>/dev/null || true
  printf '%s' "$expected" > "$ready"
  echo "plugin-cache ready: $id -> $plugin"
}

id= version= url= sha256= archive= plugin_file=
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    '[[plugin]]')
      if [[ -n "$id" ]]; then fetch_one "$id" "$version" "$url" "$sha256" "$archive" "$plugin_file"; fi
      id= version= url= sha256= archive= plugin_file=
      ;;
    id\ =\ *) id=${line#*\"}; id=${id%\"} ;;
    version\ =\ *) version=${line#*\"}; version=${version%\"} ;;
    url\ =\ *) url=${line#*\"}; url=${url%\"} ;;
    sha256\ =\ *) sha256=${line#*\"}; sha256=${sha256%\"} ;;
    archive\ =\ *) archive=${line#*\"}; archive=${archive%\"} ;;
    plugin_file\ =\ *) plugin_file=${line#*\"}; plugin_file=${plugin_file%\"} ;;
  esac
done < "$manifest"
if [[ -n "$id" ]]; then fetch_one "$id" "$version" "$url" "$sha256" "$archive" "$plugin_file"; fi

echo "OJ_PLUGIN_CACHE=$cache"
