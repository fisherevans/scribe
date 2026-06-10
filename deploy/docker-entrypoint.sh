#!/bin/sh
# scribe container entrypoint. Bootstraps a checkout of the blog repo on the
# mounted volume (first boot only), wires git identity + push credentials from
# the environment, then hands off to the scribe binary. All scribe config is
# read from SCRIBE_* env vars, so no flags are needed here.
set -eu

: "${SCRIBE_REPO:=/data/repo}"
: "${SCRIBE_DATA:=/data/scribe}"
: "${SCRIBE_BLOG_REPO:?set SCRIBE_BLOG_REPO, e.g. fisherevans/log}"
: "${GIT_AUTHOR_NAME:=scribe}"
: "${GIT_AUTHOR_EMAIL:=scribe@fisher.sh}"
export SCRIBE_REPO SCRIBE_DATA

mkdir -p "$SCRIBE_DATA"

git config --global user.name "$GIT_AUTHOR_NAME"
git config --global user.email "$GIT_AUTHOR_EMAIL"
# The working tree lives on an NFS volume owned by another uid; trust it.
git config --global --add safe.directory '*'
# Supply the push token without writing it to disk (helper reads $GIT_TOKEN).
if [ -n "${GIT_TOKEN:-}" ]; then
    git config --global credential.helper \
        '!f() { echo username=x-access-token; echo "password=${GIT_TOKEN}"; }; f'
fi

if [ ! -e "$SCRIBE_REPO/.git" ]; then
    echo "scribe: cloning ${SCRIBE_BLOG_REPO} into ${SCRIBE_REPO}"
    git clone "https://github.com/${SCRIBE_BLOG_REPO}.git" "$SCRIBE_REPO"
fi

# Optional: select a bundled upload plugin by name (e.g. SCRIBE_UPLOADER=s3)
# instead of spelling out the script path. An explicit SCRIBE_UPLOAD_CMD wins.
# See deploy/uploaders/README.md.
if [ -z "${SCRIBE_UPLOAD_CMD:-}" ] && [ -n "${SCRIBE_UPLOADER:-}" ]; then
    cmd="/usr/local/share/scribe/uploaders/${SCRIBE_UPLOADER}.sh"
    if [ ! -x "$cmd" ]; then
        echo "scribe: unknown SCRIBE_UPLOADER='${SCRIBE_UPLOADER}' (no $cmd)" >&2
        exit 1
    fi
    export SCRIBE_UPLOAD_CMD="$cmd"
    echo "scribe: upload plugin = ${SCRIBE_UPLOADER} ($cmd)"
fi

exec /scribe "$@"
