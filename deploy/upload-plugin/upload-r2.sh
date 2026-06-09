#!/usr/bin/env bash
#
# upload-r2.sh - SCRIBE_UPLOAD_CMD implementation for Cloudflare R2.
#
# Mirrors the nottingham-bot `!upload` flow: a plain S3 PutObject against the
# media-fisher-sh bucket, keyed <namespace>/<YYYY/MM/DD>/<name>, replying with
# the public https://media.fisher.sh/<key> URL. Same R2 endpoint, same key
# scheme, same explicit ContentType (so R2 serves images/PDFs inline instead of
# forcing a download). Uses the aws CLI; boto3 would be equivalent.
#
# scribe runs this once per image and reads the URL we print to stdout (and
# nothing else - all diagnostics go to stderr). It passes the file via env:
#   SCRIBE_UPLOAD_FILE - local path to the uploaded file
#   SCRIBE_UPLOAD_NAME - chosen filename incl. extension (already slugified)
#   SCRIBE_UPLOAD_TYPE - the upload's content type
#   SCRIBE_UPLOAD_SLUG - the post being edited; used as the key namespace
#
# R2 config (same five values the bot materializes from the `nottingham-cloud`
# Bitwarden item; names match deploy.sh exactly):
#   R2_ENDPOINT          - account-scoped endpoint, https://<account>.r2.cloudflarestorage.com
#   R2_ACCESS_KEY_ID     - R2 S3 access key
#   R2_SECRET_ACCESS_KEY - R2 S3 secret
#   R2_BUCKET            - media-fisher-sh
#   R2_PUBLIC_URL        - https://media.fisher.sh
#   R2_NAMESPACE         - optional; overrides the per-post namespace
#
# Wire it up:  export SCRIBE_UPLOAD_CMD="$PWD/deploy/upload-plugin/upload-r2.sh"
# (in the k3s deploy this is baked into the overlay image - see README.md)

set -euo pipefail

: "${SCRIBE_UPLOAD_FILE:?missing SCRIBE_UPLOAD_FILE}"
: "${R2_ENDPOINT:?set R2_ENDPOINT}"
: "${R2_BUCKET:?set R2_BUCKET}"
: "${R2_PUBLIC_URL:?set R2_PUBLIC_URL}"
: "${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}"

name="${SCRIBE_UPLOAD_NAME:-$(basename "$SCRIBE_UPLOAD_FILE")}"

# Namespace: explicit override, else the post slug, else the bot's default.
namespace="${R2_NAMESPACE:-${SCRIBE_UPLOAD_SLUG:-unsorted}}"
namespace="${namespace#/}"; namespace="${namespace%/}"

date="$(date -u +%Y/%m/%d)"
key="${namespace}/${date}/${name}"

ctype="${SCRIBE_UPLOAD_TYPE:-application/octet-stream}"

# aws reads AWS_* / region from env; map R2's S3 token onto them for this call.
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
AWS_DEFAULT_REGION="auto" \
aws s3api put-object \
    --endpoint-url "$R2_ENDPOINT" \
    --bucket "$R2_BUCKET" \
    --key "$key" \
    --body "$SCRIBE_UPLOAD_FILE" \
    --content-type "$ctype" \
    1>&2

# Normalize the public base: the BW value is a bare domain (media.fisher.sh),
# so prepend a scheme when missing - the inserted src must be absolute.
public="${R2_PUBLIC_URL%/}"
case "$public" in http://*|https://*) ;; *) public="https://$public" ;; esac

# stdout: the one thing scribe consumes - the URL to drop into the post.
printf '%s/%s\n' "$public" "$key"
