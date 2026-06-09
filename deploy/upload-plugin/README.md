# Upload plugin (R2 example)

scribe's image upload is a swappable hook, not a hardwired integration - the
same principle as auth. The core service and image know nothing about R2: when
`SCRIBE_UPLOAD_CMD` is set, scribe spools each uploaded image to a temp file and
runs that command, taking the URL it prints on stdout. No command set: scribe
copies the file into the site's media dir (`media.input` from `.pages.yml`).

This directory is a copy-paste example for wiring the R2 path into a deploy. It
is intentionally **not** part of `deploy/k3s` - the base deploy stays R2-free.

## The plugin contract

`SCRIBE_UPLOAD_CMD` runs once per upload (`sh -c`), with these in the env:

| var | meaning |
|---|---|
| `SCRIBE_UPLOAD_FILE` | local path to the spooled file |
| `SCRIBE_UPLOAD_NAME` | chosen filename incl. extension (already slugified) |
| `SCRIBE_UPLOAD_EXT`  | lowercased extension incl. dot |
| `SCRIBE_UPLOAD_TYPE` | content type |
| `SCRIBE_UPLOAD_SLUG` | the post being edited (used here as the R2 key namespace) |

The command must print the resulting public URL to **stdout** and nothing else
(diagnostics go to stderr). That URL is what lands in the post.

[`upload-r2.sh`](upload-r2.sh) implements this for R2, mirroring the
nottingham-bot `!upload` convention: S3 `PutObject` to the `media-fisher-sh`
bucket, key `<slug>/<YYYY/MM/DD>/<name>`, explicit ContentType, returning the
`media.fisher.sh` URL.

## Enabling it in the k3s deploy

1. **Build the overlay image** (base scribe + `aws-cli` + the script):
   ```sh
   docker build -t ghcr.io/fisherevans/scribe-r2:v0.1.2 \
     --build-arg SCRIBE_IMAGE=ghcr.io/fisherevans/scribe:v0.1.2 \
     deploy/upload-plugin
   docker push ghcr.io/fisherevans/scribe-r2:v0.1.2
   ```
2. **Create the secret** from Bitwarden (see [secret.example.yaml](secret.example.yaml)
   for the field mapping and the one-liner).
3. **Patch the Deployment** to use that image + the secret env - see
   [deployment.patch.yaml](deployment.patch.yaml).

## Why R2 and not "page content" for the live deploy

In the deployed git-staging model, page-content uploads write the image into the
repo working tree but nothing commits the binary (only post saves commit, and
only the `.md` path), so a page-content image would never get pushed or
published. R2 sidesteps this: only the URL goes into the post, no binary in the
repo. (Committing page-content uploads through the staging layer is a possible
future path; until then R2 is the upload route that works live.)

## Lighter alternative

`aws-cli` pulls in Python. If image size matters, `apk add rclone` (a single
static binary) works against the same R2 endpoint - swap the `aws s3api
put-object` call in `upload-r2.sh` for `rclone copyto`.
