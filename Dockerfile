# Multi-stage build matching the nottingham-cloud convention (CGO-free static
# binary). The runtime image adds `git` because scribe shells out to the real
# git binary for the staging working tree and merge/conflict handling. SQLite
# uses modernc.org/sqlite (pure Go) so the CGO_ENABLED=0 build holds.

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
RUN apk add --no-cache git tzdata ca-certificates
COPY --from=build /scribe /scribe
ENTRYPOINT ["/scribe"]
