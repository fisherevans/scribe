#!/bin/sh
# s3.sh - bundled scribe upload plugin for S3-compatible object storage.
#
# scribe's image upload is a swappable hook: when SCRIBE_UPLOAD_CMD is set,
# scribe spools each uploaded image to a temp file, runs the command, and uses
# the URL it prints to stdout. This script is one bundled implementation of that
# hook - a plain object PUT to any S3-compatible store (AWS S3, Cloudflare R2,
# Backblaze B2, MinIO, ...), returning a public URL. It ships inside the scribe
# image, so enabling it is configuration only - no derived image, no build.
#
# Select it with `SCRIBE_UPLOADER=s3` (the entrypoint resolves that to this
# path) or point SCRIBE_UPLOAD_CMD straight at it. Writing your own uploader is
# the same shape: any executable that honors the contract below; mount it into
# the container and set SCRIBE_UPLOAD_CMD to its path. rclone is on PATH for it.
#
# Contract scribe gives the command (per upload, via env):
#   SCRIBE_UPLOAD_FILE - local path to the spooled file
#   SCRIBE_UPLOAD_NAME - chosen filename incl. extension (already slugified)
#   SCRIBE_UPLOAD_EXT  - lowercased extension incl. dot
#   SCRIBE_UPLOAD_TYPE - content type
#   SCRIBE_UPLOAD_SLUG - the post being edited; used here as the key namespace
# It must print the public URL to stdout and nothing else (diagnostics -> stderr).
#
# Configuration (env):
#   SCRIBE_S3_BUCKET            - bucket name (required)
#   SCRIBE_S3_PUBLIC_BASE       - public URL base for stored objects, e.g.
#                                 media.example.com or https://media.example.com
#                                 (scheme prepended if missing) (required)
#   SCRIBE_S3_ACCESS_KEY_ID     - S3 access key (required)
#   SCRIBE_S3_SECRET_ACCESS_KEY - S3 secret (required)
#   SCRIBE_S3_ENDPOINT          - S3 endpoint; empty = AWS S3. For R2:
#                                 https://<account>.r2.cloudflarestorage.com
#   SCRIBE_S3_REGION            - region (default: auto, which suits R2)
#   SCRIBE_S3_PROVIDER          - rclone S3 provider (default: Other; e.g.
#                                 AWS, Cloudflare, Minio, Wasabi)
#   SCRIBE_S3_PREFIX            - key namespace override; default is the post slug
#
# Key scheme: <namespace>/<YYYY/MM/DD>/<name> (date in UTC), e.g.
# a-shaker-side-table/2026/06/10/hero-shot.png. Public URL is
# <SCRIBE_S3_PUBLIC_BASE>/<key>.

set -eu

: "${SCRIBE_UPLOAD_FILE:?missing SCRIBE_UPLOAD_FILE}"
: "${SCRIBE_S3_BUCKET:?set SCRIBE_S3_BUCKET}"
: "${SCRIBE_S3_PUBLIC_BASE:?set SCRIBE_S3_PUBLIC_BASE}"
: "${SCRIBE_S3_ACCESS_KEY_ID:?set SCRIBE_S3_ACCESS_KEY_ID}"
: "${SCRIBE_S3_SECRET_ACCESS_KEY:?set SCRIBE_S3_SECRET_ACCESS_KEY}"

name="${SCRIBE_UPLOAD_NAME:-$(basename "$SCRIBE_UPLOAD_FILE")}"

# Namespace: explicit override, else the post slug, else a catch-all.
namespace="${SCRIBE_S3_PREFIX:-${SCRIBE_UPLOAD_SLUG:-unsorted}}"
namespace="${namespace#/}"
namespace="${namespace%/}"
[ -n "$namespace" ] || namespace="unsorted"

date="$(date -u +%Y/%m/%d)"
key="${namespace}/${date}/${name}"

# rclone remote defined entirely via env (RCLONE_CONFIG_<NAME>_*), so there is
# no config file to write - works read-only and as any uid. Name the remote DST.
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_DST_TYPE=s3
export RCLONE_CONFIG_DST_PROVIDER="${SCRIBE_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_DST_ACCESS_KEY_ID="$SCRIBE_S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$SCRIBE_S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_DST_REGION="${SCRIBE_S3_REGION:-auto}"
if [ -n "${SCRIBE_S3_ENDPOINT:-}" ]; then
    export RCLONE_CONFIG_DST_ENDPOINT="$SCRIBE_S3_ENDPOINT"
fi

# --s3-no-check-bucket: skip the HeadBucket probe (object-scoped R2/S3 tokens
# often can't see bucket metadata). Explicit Content-Type so the store serves
# images inline instead of forcing a download.
ctype="${SCRIBE_UPLOAD_TYPE:-}"
if [ -n "$ctype" ]; then
    rclone copyto --s3-no-check-bucket --header-upload "Content-Type: $ctype" \
        "$SCRIBE_UPLOAD_FILE" "DST:${SCRIBE_S3_BUCKET}/${key}" 1>&2
else
    rclone copyto --s3-no-check-bucket \
        "$SCRIBE_UPLOAD_FILE" "DST:${SCRIBE_S3_BUCKET}/${key}" 1>&2
fi

# Normalize the public base to an absolute URL (bare domain -> https://).
public="${SCRIBE_S3_PUBLIC_BASE%/}"
case "$public" in
    http://* | https://*) ;;
    *) public="https://$public" ;;
esac

# stdout: the one thing scribe consumes - the URL to drop into the post.
printf '%s/%s\n' "$public" "$key"
