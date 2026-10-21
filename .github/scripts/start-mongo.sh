#!/usr/bin/env bash
# Starts a one-node MongoDB replica set in Docker for the test jobs (transactions need a replica set, like Atlas).
# Production is MongoDB 8.0 on Atlas, so 8.0 is tried first. The 8.0 image refuses to start on runners whose
# Linux kernel is 6.19 or newer (MongoDB SERVER-121912, "known incompatibility"); when that happens the next
# series is used instead, and the job log says so. A container that dies for any other reason is retried.
set -u
IMAGES=("${MONGO_IMAGE:-mongo:8.0}" mongo:8.3 mongo:9.0)
try_image() {
  local image="$1"
  docker rm -f mongo >/dev/null 2>&1 || true
  docker run -d --name mongo -p 27017:27017 "$image" --replSet rs0 --bind_ip_all >/dev/null
  for i in $(seq 1 30); do
    if [ "$(docker inspect -f '{{.State.Running}}' mongo 2>/dev/null)" != "true" ]; then return 1; fi
    if docker exec mongo mongosh --quiet --eval "db.runCommand({ping: 1}).ok" >/dev/null 2>&1; then
      docker exec mongo mongosh --quiet --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})" >/dev/null
      for j in $(seq 1 30); do
        [ "$(docker exec mongo mongosh --quiet --eval 'db.hello().isWritablePrimary')" = "true" ] && return 0
        sleep 1
      done
      return 1
    fi
    sleep 1
  done
  return 1
}
for image in "${IMAGES[@]}"; do
  for attempt in 1 2; do
    if try_image "$image"; then
      echo "MongoDB replica set ready: $image ($(docker exec mongo mongosh --quiet --eval 'db.version()'))"
      exit 0
    fi
    log=$(docker logs mongo 2>&1 | tail -20)
    if grep -q "SERVER-121912\|kernel versions" <<<"$log"; then
      echo "::warning::$image cannot run on this runner's kernel ($(uname -r)); trying the next MongoDB series"
      break
    fi
    echo "::warning::$image did not come up on attempt $attempt; its log:"
    echo "$log"
  done
done
echo "::error::MongoDB could not be started with any of: ${IMAGES[*]}"
exit 1
