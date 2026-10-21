# Runtime base moves off EOL alpine 3.20 for the eMudhra CA distrust

**Date:** 2026-10-21
**Type:** infra
**Version:** v0.5.1
**Author:** claude-code

## What changed

The runtime stage moved from `alpine:3.20` to `alpine:3.22`. No code changed.

## Why

On 2026-10-20 an eMudhra intermediate CA was compromised, and the fix ships as
`ca-certificates` 20261020, which distrusts the affected chains. Alpine 3.20 is EOL
and will never receive that package, so rebuilding on 3.20 left the image trusting
the compromised chains no matter how fresh the build. 3.22 carries the fixed package
and is supported until 2027-05. Tracked in fisherevans/nottingham-cloud#800.

The release image was checked before deploy: its `/etc/ssl/certs/ca-certificates.crt`
trusts none of the 12 known-bad chains.
