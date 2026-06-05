# Multi-stage build matching the nottingham-cloud convention (CGO-free static
# binary). The runtime image adds `git` because scribe shells out to the real
# git binary for the staging working tree and merge/conflict handling. SQLite
# uses modernc.org/sqlite (pure Go) so the CGO_ENABLED=0 build holds.
FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /scribe ./cmd/scribe

FROM alpine:3.20
RUN apk add --no-cache git tzdata ca-certificates
COPY --from=build /scribe /scribe
ENTRYPOINT ["/scribe"]
