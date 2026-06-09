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

Current release: **v0.1.2**.

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

> **Note on uploads:** the base image is upload-agnostic. With no upload command
> configured, the editor's upload button copies into the site media dir, but in
> the deployed git-staging model that file is never committed/published - so for
> working media uploads you want Part B. Writing posts and pasting existing
> `media.fisher.sh` URLs works on the base image with nothing extra.

---

## Part B - Enable R2 media uploads (addendum)

scribe's image upload is a **swappable hook**, not a built-in R2 integration
(same principle as auth). When `SCRIBE_UPLOAD_CMD` is set, scribe spools each
uploaded image to a temp file, runs that command, and takes the URL the command
prints on stdout. The base image ships no uploader; you layer one in.

This mirrors the local dev setup and the `!upload` Discord bot: a plain S3
`PutObject` against the `media-fisher-sh` R2 bucket, returning a
`media.fisher.sh` URL.

### B.1 The uploader script

[`deploy/upload-plugin/upload-r2.sh`](upload-plugin/upload-r2.sh) is the
reference implementation. Contract scribe gives it (per upload, via env):

| var | meaning |
|---|---|
| `SCRIBE_UPLOAD_FILE` | local path to the spooled file |
| `SCRIBE_UPLOAD_NAME` | chosen filename incl. extension (already slugified) |
| `SCRIBE_UPLOAD_EXT`  | lowercased extension incl. dot |
| `SCRIBE_UPLOAD_TYPE` | content type |
| `SCRIBE_UPLOAD_SLUG` | the post being edited (used as the R2 key namespace) |

It must print the public URL to **stdout** and nothing else (diagnostics to
stderr). What the script does:

- key = `<namespace>/<YYYY/MM/DD>/<name>`, namespace = `SCRIBE_UPLOAD_SLUG` (or
  `R2_NAMESPACE` override, or `unsorted`), date in UTC. e.g.
  `a-shaker-side-table/2026/06/09/hero-shot.png`.
- `aws s3api put-object` against the R2 endpoint with an explicit
  `--content-type` (so R2 serves images inline, not as a download).
- prints `https://<R2_PUBLIC_URL>/<key>` (prepends `https://` if the configured
  public URL is a bare domain).

Its R2 config (from env - the secret below):

| env | Bitwarden field (`nottingham-cloud`) | value |
|---|---|---|
| `R2_ENDPOINT` | `r2-endpoint` | `https://<account-id>.r2.cloudflarestorage.com` (account-scoped, not bucket-suffixed) |
| `R2_ACCESS_KEY_ID` | `r2-access-key-id` | R2 S3 access key |
| `R2_SECRET_ACCESS_KEY` | `r2-secret-access-key` | R2 S3 secret |
| `R2_BUCKET` | `r2-bucket-name` | `media-fisher-sh` |
| `R2_PUBLIC_URL` | `r2-public-url` | `media.fisher.sh` (bare domain; script adds the scheme) |

These are the same five values the `!upload` bot uses.

### B.2 Build the overlay image

The base image is bare alpine + git (no S3 client). Layer in `aws-cli` + the
script with [`deploy/upload-plugin/Dockerfile`](upload-plugin/Dockerfile):

```sh
docker build \
  -t ghcr.io/fisherevans/scribe-r2:v0.1.2 \
  --build-arg SCRIBE_IMAGE=ghcr.io/fisherevans/scribe:v0.1.2 \
  deploy/upload-plugin
docker push ghcr.io/fisherevans/scribe-r2:v0.1.2
```

The overlay inherits the base entrypoint and bakes `SCRIBE_UPLOAD_CMD=
/plugins/upload-r2.sh`. (`aws-cli` pulls Python; if image size matters, swap to
`apk add rclone` + an `rclone copyto` call - single static binary.)

> Optionally fold this into the CI workflow as a second build step keyed on the
> same tag, so `scribe-r2:vX.Y.Z` publishes alongside `scribe:vX.Y.Z`.

### B.3 Materialize the R2 secret from Bitwarden

Same pattern as `scribe-secrets` - pull from the `nottingham-cloud` BW item, do
not commit values. Example shape in
[`deploy/upload-plugin/secret.example.yaml`](upload-plugin/secret.example.yaml):

```sh
kubectl -n scribe create secret generic scribe-r2 \
  --from-literal=R2_ENDPOINT="$(scripts/bw-field.sh nottingham-cloud r2-endpoint)" \
  --from-literal=R2_ACCESS_KEY_ID="$(scripts/bw-field.sh nottingham-cloud r2-access-key-id)" \
  --from-literal=R2_SECRET_ACCESS_KEY="$(scripts/bw-field.sh nottingham-cloud r2-secret-access-key)" \
  --from-literal=R2_BUCKET="$(scripts/bw-field.sh nottingham-cloud r2-bucket-name)" \
  --from-literal=R2_PUBLIC_URL="$(scripts/bw-field.sh nottingham-cloud r2-public-url)"
```

(Run `scripts/bw-unlock.sh` first if the BW session isn't live. Better: add a
`configure-scribe-r2` make target mirroring `configure-scribe` so this is
reproducible.)

### B.4 Point the deployment at the overlay + secret

Run the overlay image and inject the R2 env from the secret. See
[`deploy/upload-plugin/deployment.patch.yaml`](upload-plugin/deployment.patch.yaml)
for the exact patch - either apply it as a kustomize overlay over `deploy/k3s`,
or set the equivalent on the live Deployment:

- `image: ghcr.io/fisherevans/scribe-r2:v0.1.2`
- five `R2_*` env vars `valueFrom` the `scribe-r2` secret

`SCRIBE_UPLOAD_CMD` is baked into the overlay image, so it doesn't need setting
here. Then `kubectl apply` and roll out as in Part A.

### B.5 Verify

In the editor (or via the API), upload a test image and confirm the round trip,
then clean up the throwaway object:

```sh
# the running pod, or any host with the R2 creds + aws-cli:
url=$(curl -s -F 'file=@/tmp/test.png;filename=test.png' \
        -F dest=external -F name=smoketest -F slug=devops-check \
        http://<scribe>/api/upload | jq -r .url)
echo "$url"                         # https://media.fisher.sh/devops-check/<date>/smoketest.png
curl -sI "$url" | head -1           # expect 200, content-type image/png

# cleanup:
AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
AWS_DEFAULT_REGION=auto aws s3api delete-object \
  --endpoint-url "$R2_ENDPOINT" --bucket "$R2_BUCKET" \
  --key "devops-check/<date>/smoketest.png"
```

(A just-deleted object can still 200 briefly from Cloudflare's CDN cache - that's
the cache, not the origin.)

Once the toggle shows up, the editor's image modal offers **External CDN** vs
**Page content**; External runs this script and drops the `media.fisher.sh` URL
straight into the post.
