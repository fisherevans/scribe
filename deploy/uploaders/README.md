# Upload plugins

scribe's image upload is a swappable hook, not a hardwired integration (same
principle as auth). When `SCRIBE_UPLOAD_CMD` is set, scribe spools each uploaded
image to a temp file, runs that command, and uses the URL it prints on stdout.
With nothing set, scribe copies the file into the site's media dir (`media.input`
from `.pages.yml`) instead.

The scribe image ships with a small object-store client (`rclone`) and the
reference uploaders in this directory baked in at
`/usr/local/share/scribe/uploaders/`. So the common cases are **configuration
only - no derived image, no build.**

## Using a bundled uploader

Set `SCRIBE_UPLOADER` to the name of a bundled script (the file here minus
`.sh`) and provide its config via env. The entrypoint resolves it to the script
path; an explicit `SCRIBE_UPLOAD_CMD` always wins if you set one.

| Uploader | `SCRIBE_UPLOADER` | What it does |
|---|---|---|
| [`s3.sh`](s3.sh) | `s3` | Object PUT to any S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2, MinIO). Key `<slug>/<YYYY/MM/DD>/<name>`, returns a public URL. |

Example (Cloudflare R2):

```sh
SCRIBE_UPLOADER=s3
SCRIBE_S3_BUCKET=media-example
SCRIBE_S3_PUBLIC_BASE=media.example.com           # scheme prepended if missing
SCRIBE_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
SCRIBE_S3_ACCESS_KEY_ID=...
SCRIBE_S3_SECRET_ACCESS_KEY=...
# optional: SCRIBE_S3_REGION (default auto), SCRIBE_S3_PROVIDER (default Other),
#           SCRIBE_S3_PREFIX (key namespace; default is the post slug)
```

See [`s3.sh`](s3.sh)'s header for the full variable list. Plain AWS S3 is the
same minus `SCRIBE_S3_ENDPOINT` (and `SCRIBE_S3_PROVIDER=AWS`).

## The plugin contract

`SCRIBE_UPLOAD_CMD` runs once per upload (`sh -c`), with these in the env:

| var | meaning |
|---|---|
| `SCRIBE_UPLOAD_FILE` | local path to the spooled file |
| `SCRIBE_UPLOAD_NAME` | chosen filename incl. extension (already slugified) |
| `SCRIBE_UPLOAD_EXT`  | lowercased extension incl. dot |
| `SCRIBE_UPLOAD_TYPE` | content type |
| `SCRIBE_UPLOAD_SLUG` | the post being edited (a natural key namespace) |

The command must print the resulting public URL to **stdout** and nothing else
(diagnostics to stderr). That URL is what lands in the post. A non-zero exit (or
empty stdout) surfaces as an upload error in the editor.

## Writing your own

A custom uploader is any executable honoring the contract above - no rebuild
needed. Two ways to wire one in:

1. **Mount a script** and point `SCRIBE_UPLOAD_CMD` at it. In k8s, a ConfigMap
   mounted at e.g. `/plugins/upload.sh` plus `SCRIBE_UPLOAD_CMD=/plugins/upload.sh`.
   `rclone` is on `PATH`, so an S3/B2/GCS/SFTP variant is a few lines; for other
   targets, install or mount whatever client you need.
2. **Inline a one-liner.** `SCRIBE_UPLOAD_CMD` is a shell snippet, so trivial
   cases need no file at all, e.g.
   `SCRIBE_UPLOAD_CMD='aws s3 cp "$SCRIBE_UPLOAD_FILE" "s3://b/$SCRIBE_UPLOAD_NAME" >&2 && echo "https://cdn/$SCRIBE_UPLOAD_NAME"'`.

To contribute a new bundled uploader, drop a script here and add a row to the
table above; the Dockerfile copies the whole directory into the image.

## Note on `dest=local` vs `external`

In a git-staging deploy (the k3s setup), `dest=local` (page-content) uploads
write the image into the repo working tree but nothing commits the binary - only
post saves commit, and only the `.md` path - so a local image is never pushed or
published. An external uploader (this hook) sidesteps that: only the URL goes
into the post, no binary in the repo. For a deployed site, external upload is the
route that works; `dest=local` is for local authoring where the media dir is
served directly.
