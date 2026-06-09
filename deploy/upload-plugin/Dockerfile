# Example: a thin image that adds R2 upload to scribe via the SCRIBE_UPLOAD_CMD
# plugin hook. The base scribe image is deliberately R2-free (bare alpine + git);
# this overlay layers in an uploader so server-side uploads push to R2. Build it
# in your deploy infra and run it in place of the base image when you want
# uploads enabled.
#
#   docker build -t ghcr.io/fisherevans/scribe-r2:v0.1.2 \
#     --build-arg SCRIBE_IMAGE=ghcr.io/fisherevans/scribe:v0.1.2 \
#     deploy/upload-plugin
#
# aws-cli drives the S3 PutObject against R2. rclone is a lighter alternative
# (apk add rclone, single static binary) if image size matters - swap the
# command in upload-r2.sh accordingly.
ARG SCRIBE_IMAGE=ghcr.io/fisherevans/scribe:latest
FROM ${SCRIBE_IMAGE}
RUN apk add --no-cache aws-cli bash
COPY upload-r2.sh /plugins/upload-r2.sh
RUN chmod +x /plugins/upload-r2.sh
ENV SCRIBE_UPLOAD_CMD=/plugins/upload-r2.sh
