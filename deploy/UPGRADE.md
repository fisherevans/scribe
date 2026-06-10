# Upgrading scribe + enabling R2 media uploads

A DevOps handoff: how to roll the deployed scribe forward to the latest release,
and how to turn on server-side media uploads to R2 (`media.fisher.sh`) the way
the local setup does. Two independent parts - Part A is the routine version bump;
Part B is a one-time setup to enable uploads.

Conventions match the rest of nottingham-cloud (per-project k3s manifests under
`deploy/k3s`, secrets materialized out-of-band from Bitwarden).

---

## Part A - Upgrade to the latest version

Releases are tag-driven. Pushing a `vX.Y.Z` git tag triggers the
[build workflow](../.github/workflows/build.yml), which publishes
`ghcr.io/fisherevans/scribe:vX.Y.Z` (plus `:latest` / `:<branch>` / `:sha-...`).
The deployment pins an explicit tag.

Current release: **v0.1.3**.

1. Confirm the image is built and pushed:
   ```sh
   gh run list --repo fisherevans/scribe --workflow=build.yml --limit 3
   # or: docker manifest inspect ghcr.io/fisherevans/scribe:v0.1.2 >/dev/null && echo ok
   ```
2. The pin in [`deploy/k3s/deployment.yaml`](k3s/deployment.yaml) is already
   `:v0.1.2`. For future bumps, edit that one line to the new tag.
3. Apply:
   ```sh
   kubectl apply -k deploy/k3s
   ```
   The Deployment uses `strategy: Recreate` (scribe is a single writer over one
   git working tree + notes file), so expect a few seconds of downtime while the
   old pod terminates before the new one starts.
4. Verify:
   ```sh
   kubectl -n scribe rollout status deploy/scribe
   kubectl -n scribe exec deploy/scribe -- wget -qO- localhost:8080/api/health
   ```

The `scribe-secrets` Secret (the `GIT_TOKEN` used to clone/push the blog repo) is
unchanged and materialized out-of-band from Bitwarden (the `make configure-scribe`
pattern) - nothing to do here unless rotating it.

> **Note on uploads:** the base image is upload-agnostic *until configured*. With
> no upload plugin selected, the editor's upload button copies into the site media
> dir, but in the deployed git-staging model that file is never committed/published
> - so for working media uploads you want Part B. As of v0.1.3 Part B is
> configuration only (the image ships `rclone` + the uploader scripts); no derived
> image. Writing posts and pasting existing `media.fisher.sh` URLs works with
> nothing extra.

---

## Part B - Enable media uploads (configuration only)

scribe's image upload is a **swappable hook**, not a built-in integration (same
principle as auth). When `SCRIBE_UPLOAD_CMD` is set, scribe spools each uploaded
image to a temp file, runs that command, and takes the URL the command prints on
stdout. With nothing set, the editor copies into the site media dir instead -
inert in the git-staging deploy, since that binary is never committed.

The scribe image **ships `rclone` plus the reference uploaders** (see
[`deploy/uploaders/`](uploaders/README.md)) baked in at
`/usr/local/share/scribe/uploaders/`. So enabling uploads is configuration only -
no derived image, no `docker build`. (Pre-v0.1.3 this needed a `scribe-r2` overlay
image; that's gone.) The bundled `s3` uploader is a plain object PUT to any
S3-compatible store; here, the `media-fisher-sh` R2 bucket, returning
`media.fisher.sh` URLs - the same bucket + key scheme as the `!upload` Discord
bot.

### B.1 Select the uploader + supply config

Two env to turn it on, plus the storage credentials:

- `SCRIBE_UPLOADER=s3` - selects the bundled `s3.sh` (the entrypoint resolves the
  name to the script path; an explicit `SCRIBE_UPLOAD_CMD` would override).
- the `SCRIBE_S3_*` config below, injected from a Secret.

| env | Bitwarden field (`nottingham-cloud`) | value |
|---|---|---|
| `SCRIBE_S3_ENDPOINT` | `r2-endpoint` | `https://<account-id>.r2.cloudflarestorage.com` (account-scoped; empty = AWS S3) |
| `SCRIBE_S3_ACCESS_KEY_ID` | `r2-access-key-id` | S3 access key |
| `SCRIBE_S3_SECRET_ACCESS_KEY` | `r2-secret-access-key` | S3 secret |
| `SCRIBE_S3_BUCKET` | `r2-bucket-name` | `media-fisher-sh` |
| `SCRIBE_S3_PUBLIC_BASE` | `r2-public-url` | `media.fisher.sh` (bare domain; the script adds the scheme) |

Optional: `SCRIBE_S3_REGION` (default `auto`), `SCRIBE_S3_PROVIDER` (default
`Other`; `AWS`/`Cloudflare`/`Minio`/...), `SCRIBE_S3_PREFIX` (key namespace
override; default is the post slug). Keys are `<namespace>/<YYYY/MM/DD>/<name>`,
UTC date, e.g. `a-shaker-side-table/2026/06/10/hero-shot.png`. These are the same
five values the `!upload` bot uses; see [`uploaders/s3.sh`](uploaders/s3.sh).

### B.2 Materialize the secret from Bitwarden

Same pattern as `scribe-secrets` - pull from the `nottingham-cloud` BW item, do
not commit values. In nottingham-cloud this is `make configure-scribe-r2` (it
emits the `SCRIBE_S3_*` keys below). The equivalent one-liner:

```sh
kubectl -n scribe create secret generic scribe-r2 \
  --from-literal=SCRIBE_S3_ENDPOINT="$(scripts/bw-field.sh nottingham-cloud r2-endpoint)" \
  --from-literal=SCRIBE_S3_ACCESS_KEY_ID="$(scripts/bw-field.sh nottingham-cloud r2-access-key-id)" \
  --from-literal=SCRIBE_S3_SECRET_ACCESS_KEY="$(scripts/bw-field.sh nottingham-cloud r2-secret-access-key)" \
  --from-literal=SCRIBE_S3_BUCKET="$(scripts/bw-field.sh nottingham-cloud r2-bucket-name)" \
  --from-literal=SCRIBE_S3_PUBLIC_BASE="$(scripts/bw-field.sh nottingham-cloud r2-public-url)"
```

(Run `scripts/bw-unlock.sh` first if the BW session isn't live.)

### B.3 Point the deployment at it

No image change - the base image already has the uploader. Add to the `scribe`
container's `env`:

- `SCRIBE_UPLOADER` = `s3` (plain value)
- the five `SCRIBE_S3_*` vars `valueFrom` the `scribe-r2` secret

Then `kubectl apply -k deploy/k3s` and roll out as in Part A.

### B.4 Verify

`GET /api/capabilities` reports `{"upload":{"external":true}}` once configured.
Upload a test image, confirm the round trip, then clean up the throwaway object:

```sh
url=$(curl -s -F 'file=@/tmp/test.png;filename=test.png' \
        -F dest=external -F name=smoketest -F slug=devops-check \
        http://<scribe>/api/upload | jq -r .url)
echo "$url"                         # https://media.fisher.sh/devops-check/<date>/smoketest.png
curl -sI "$url" | head -1           # expect 200, content-type image/png

# cleanup (rclone is in the pod; reuse the SCRIBE_S3_* env):
kubectl -n scribe exec deploy/scribe -- sh -c '
  export RCLONE_CONFIG=/dev/null RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER=Other \
    RCLONE_CONFIG_DST_ACCESS_KEY_ID="$SCRIBE_S3_ACCESS_KEY_ID" \
    RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$SCRIBE_S3_SECRET_ACCESS_KEY" \
    RCLONE_CONFIG_DST_REGION=auto RCLONE_CONFIG_DST_ENDPOINT="$SCRIBE_S3_ENDPOINT"
  rclone deletefile --s3-no-check-bucket "DST:$SCRIBE_S3_BUCKET/devops-check/<date>/smoketest.png"'
```

(A just-deleted object can still 200 briefly from Cloudflare's CDN cache - that's
the cache, not the origin.)

In the editor's image modal this is the **External CDN** option; it runs the
uploader and drops the `media.fisher.sh` URL straight into the post.

### B.5 A different store, or your own uploader

`SCRIBE_UPLOADER=s3` with no `SCRIBE_S3_ENDPOINT` (and `SCRIBE_S3_PROVIDER=AWS`)
is plain AWS S3; the same script covers B2, MinIO, Wasabi, etc. For anything the
bundled scripts don't cover, mount your own script (ConfigMap) and point
`SCRIBE_UPLOAD_CMD` at it - no rebuild; `rclone` is on `PATH`. See
[`deploy/uploaders/README.md`](uploaders/README.md) for the contract and
examples.
