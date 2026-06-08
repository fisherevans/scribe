# scribe - deploy hand-off (for the nottingham-cloud ops agent)

You are deploying **scribe** to the k3s cluster, behind the `auth.fisher.sh`
forward-auth, reachable at **`scribe.fisher.sh`**, wired to edit and publish the
**`fisherevans/log`** blog. This document is self-contained: it has every value
and command you need. Follow it top to bottom.

## What scribe is

scribe is a content-curation web app (Go API + embedded React UI, one binary,
one origin) for the `log.fisher.sh` blog. It keeps a git checkout of
`fisherevans/log` on a persistent volume. Editors write posts/tags in the UI;
scribe commits them to a `staging` branch and, on **publish**, squash-merges the
batch onto `main` and pushes. Cloudflare Pages (already wired to `fisherevans/log`)
rebuilds the site on that push. scribe never builds or serves the blog itself -
its job ends at the git push.

It deploys exactly like **rsvp**: a pure-Go app with a single persistent volume,
`Recreate`/`replicas: 1`, behind Caddy forward-auth. The only extra wrinkle is
that scribe's container clones the blog repo onto its volume on first boot (see
`deploy/docker-entrypoint.sh`) and needs a GitHub token to push.

## Prerequisites

1. **Image published.** CI (`.github/workflows/build.yml` in `fisherevans/scribe`)
   publishes `ghcr.io/fisherevans/scribe`. The manifests pin **`:v0.1.1`** (the
   current release; published by CI). Confirm the tag exists before deploying:
   ```sh
   gh api /users/fisherevans/packages/container/scribe/versions --jq '.[].metadata.container.tags[]' 2>/dev/null \
     || gh api /orgs/fisherevans/packages/container/scribe/versions --jq '.[].metadata.container.tags[]'
   ```
   If it's missing for any reason, cut it from the scribe repo
   (`git tag v0.1.1 && git push origin v0.1.1`, wait for the `build image`
   workflow), or temporarily pin `:latest` in `deployment.yaml` for a first
   smoke deploy.

2. **GitHub push token.** scribe needs a token with push access to
   `fisherevans/log` (clone + push `main` and `staging`). The existing
   **`github-bot-pat`** field on the BW item **`nottingham-cloud`**
   (`d95f077a-0ddc-4fec-8dc4-b42a00f00cb4`, classic PAT, scopes `repo`+`read:org`)
   is sufficient - scribe only touches `src/content/`, so the lack of `workflow`
   scope is irrelevant. Reuse it, or mint a dedicated fine-grained PAT
   (Contents: Read/Write on `fisherevans/log`) and store it on a new `scribe` BW item.

## The manifests

Reference manifests live in the scribe repo at `deploy/k3s/` (namespace, pvc,
service, deployment, kustomization). Copy them into the cluster repo:

```sh
cd ~/dev/nottingham-cloud
mkdir -p k3s/projects/scribe
cp ~/dev/scribe/deploy/k3s/*.yaml k3s/projects/scribe/
```

They follow the rsvp pattern: NFS-backed PVC (`nfs-nottinghamvault`, 5Gi,
mounted `/data`), `Recreate` + single replica (single git-tree/notes writer),
`imagePullSecrets: ghcr-secret`, health probes on `/api/health`, and
`GIT_TOKEN` from a `scribe-secrets` Secret. Blog wiring is set via env in
`deployment.yaml` (`SCRIBE_BLOG_REPO=fisherevans/log`, `SCRIBE_MAIN_BRANCH=main`,
`SCRIBE_STAGING_BRANCH=staging`, `SCRIBE_PUSH=1`). The Secret is intentionally
**not** in `kustomization.yaml` - it's materialized from Bitwarden below.

## Deploy steps

All commands run from `~/dev/nottingham-cloud` with `KUBECONFIG` pointed at the
cluster (the Makefile forces `~/.kube/nottingham.yaml`).

### 1. Namespace + GHCR pull secret

```sh
kubectl apply -f k3s/projects/scribe/namespace.yaml

GHCR_TOKEN=$(echo ghcr.io | docker-credential-desktop get | jq -r .Secret)
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=fisherevans \
  --docker-password="$GHCR_TOKEN" -n scribe \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 2. Materialize `scribe-secrets` from Bitwarden

Add this target to `k3s/Makefile` (mirrors `configure-rsvp`), then run it. It
pulls `github-bot-pat` from the `nottingham-cloud` BW item:

```make
configure-scribe:
	GIT_TOKEN=$$(bw get item nottingham-cloud | jq -r '.fields[] | select(.name=="github-bot-pat") | .value'); \
	kubectl create namespace scribe --dry-run=client -o yaml | kubectl apply -f - && \
	kubectl -n scribe create secret generic scribe-secrets \
		--from-literal=GIT_TOKEN="$$GIT_TOKEN" \
		--dry-run=client -o yaml | kubectl apply -f -
```

```sh
make configure-scribe   # requires an unlocked BW session
```

### 3. Apply the app

```sh
make deploy-project PROJECT=scribe
kubectl -n scribe rollout status deployment/scribe
```

First boot is slower than steady state: the container clones `fisherevans/log`
into `/data/repo` before scribe starts. Watch it:

```sh
kubectl -n scribe logs deploy/scribe -f
# expect: "cloning fisherevans/log ..." then "git sync enabled" + "serving embedded UI"
```

### 4. Put it behind auth

a. Add a handle block to `k3s/infra/auth/caddy-config.yaml` (the Caddyfile
   ConfigMap). Caddy is first-match-wins; place it with the other app blocks:

```caddyfile
@scribe host scribe.fisher.sh
handle @scribe {
    forward_auth auth:8080 {
        uri /api/authz/forward-auth
        copy_headers Remote-User Remote-Email Remote-Name Remote-Groups
        header_up X-Forwarded-Proto https
    }
    reverse_proxy scribe.scribe.svc.cluster.local:80
}
```

b. Register scribe in the auth portal so it's authorizable: add `"scribe"` to
   the `apps` slice in `k3s/services/auth/main.go`, then rebuild + redeploy auth:

```sh
make build-auth && make deploy-auth   # build-auth pushes ghcr.io/fisherevans/auth:latest; deploy-auth restarts caddy + auth
```

(`make deploy-auth` applies the Caddyfile ConfigMap and restarts Caddy, so it
covers step 4a too.)

### 5. Route the public hostname through the tunnel

```sh
make route-add HOSTNAME=scribe.fisher.sh SERVICE=http://caddy.auth.svc.cluster.local:80
```

This upserts the proxied CNAME in the `fisher.sh` zone and adds the tunnel
ingress rule in one shot.

### 6. Stop Cloudflare Pages from building scribe's `staging` branch

scribe backup-pushes `staging` to `fisherevans/log` every ~2 min for
redundancy. The `log` CF Pages project builds **all** branches by default, so
each backup would trigger a throwaway preview build. Restrict it: in the
Cloudflare dashboard (or API) for Pages project `log`, set **Production branch =
`main`** and configure **preview deployments to exclude `staging`** (or "None").
This keeps publishes (push to `main`) building and silences staging-backup noise.

## Verify

1. `https://scribe.fisher.sh` redirects through `auth.fisher.sh`, and after login
   the editor loads.
2. Edit a post, hit **publish**, confirm the review sheet shows the changeset and
   completes ("all pushed up").
3. `git -C <a clone of fisherevans/log> log main --oneline -1` shows the new
   `publish:` commit; the CF Pages build for `log` kicks off.
4. `kubectl -n scribe exec deploy/scribe -- sh -c 'cd /data/repo && git status'`
   shows it sitting cleanly on `staging`.

## Config reference (env in `deployment.yaml`)

| Var | Value | Meaning |
|---|---|---|
| `SCRIBE_ADDR` | `:8080` | listen address (Service maps `:80` -> this) |
| `SCRIBE_REPO` | `/data/repo` | blog checkout on the PVC |
| `SCRIBE_DATA` | `/data/scribe` | private notes (never committed) |
| `SCRIBE_BLOG_REPO` | `fisherevans/log` | repo the entrypoint clones + scribe pushes |
| `SCRIBE_MAIN_BRANCH` | `main` | publish target (CF Pages production branch) |
| `SCRIBE_STAGING_BRANCH` | `staging` | where edits are committed/backed up |
| `SCRIBE_PUSH` | `1` | enable push, backup loop, and external-edit sync |
| `GIT_AUTHOR_NAME` / `_EMAIL` | Fisher Evans / fisher@fisherevans.com | commit identity |
| `GIT_TOKEN` | from `scribe-secrets` | HTTPS push credential |
| `SCRIBE_BACKUP_INTERVAL` | (default 2m) | staging backup-push cadence |
| `SCRIBE_SYNC_INTERVAL` | (default 1m) | pull/reconcile cadence for external edits |

## Caveats / things to know

- **git-over-NFS:** rsvp proves SQLite on `nfs-nottinghamvault` works, but scribe
  additionally keeps a git working tree there. Git index/ref locking over NFSv3
  is the one piece without direct precedent. Smoke-test it once after deploy:
  ```sh
  kubectl -n scribe exec deploy/scribe -- sh -c \
    'cd /data/repo && git fetch origin && git log --oneline -1 && touch x && git add x && git commit -qm probe && git reset -q --hard HEAD~1'
  ```
  If you see `.git/index.lock` or `unable to create` errors, fall back to the
  `local-path` StorageClass for `/data` (it loses node-rebuild durability but the
  repo re-clones on boot, and the only true state - private notes - is small;
  consider this acceptable if NFS locking is flaky).
- **Single writer is mandatory.** Keep `replicas: 1` + `Recreate`. Two pods on
  the shared volume will corrupt the git tree and notes.
- **One-time clone.** The PVC persists, so the clone happens once. If you ever
  need a clean re-clone, delete `/data/repo` in the pod (or the PVC) and restart.
- **No app-level auth.** scribe trusts that Caddy forward-auth gates it; within
  the cluster the pod is reachable unauthenticated (same posture as rsvp). Fine
  for this single-tenant cluster.
- **Frontmatter safety.** scribe writes schema-shaped frontmatter, but it does
  not yet run a pre-push Astro/zod validation. A malformed post would fail the CF
  Pages build silently (the existing `deploy-alert.yml` Discord ping is the
  signal). Low risk given the schema-driven editor, but worth knowing.
- **Public staging branch.** `staging` is pushed to the public `fisherevans/log`.
  Drafts on a non-default branch being publicly visible is acceptable here (no
  more exposed than existing `draft: true` posts). This is by design.

## Update / rollback

Bump the image: edit `image:` in `k3s/projects/scribe/deployment.yaml` to the new
`ghcr.io/fisherevans/scribe:vX.Y.Z`, then `make deploy-project PROJECT=scribe`.
`Recreate` + `imagePullPolicy: Always` makes it a clean swap (~5-10s downtime).
Rollback is the same with the prior tag.
