# Multi-stage build matching the nottingham-cloud convention (CGO-free static
# binary). Unlike the distroless Go apps there, scribe's runtime is alpine
# because it shells out to the real `git` binary for the staging working tree
# and commit/merge handling. No cgo, so CGO_ENABLED=0 holds.

# 1. Build the editor UI, then embed it in the binary so one service serves both
#    API and UI from a single origin (what the mobile app connects to).
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Replace the placeholder dist with the real UI build (go:embed all:dist).
RUN rm -rf internal/webui/dist
COPY --from=web /web/dist internal/webui/dist
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /scribe ./cmd/scribe

FROM alpine:3.20
# git is required (scribe shells out to it); openssh-client is not needed since
# pushes use an HTTPS token credential helper (see docker-entrypoint.sh).
# rclone is the bundled object-store client for the upload plugins (a single
# static binary - supports S3/R2/B2/GCS/etc.). It makes enabling uploads a
# config-only action: no derived image needed just to add an S3 client. See
# deploy/uploaders/README.md.
RUN apk add --no-cache git tzdata ca-certificates rclone
COPY --from=build /scribe /scribe
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Bundled upload plugins (selected at runtime via SCRIBE_UPLOADER).
COPY deploy/uploaders/ /usr/local/share/scribe/uploaders/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/share/scribe/uploaders/*.sh
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
