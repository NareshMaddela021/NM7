#!/usr/bin/env bash
# Starts a one-node MongoDB 8.0 replica set in Docker for the test jobs (transactions need a replica set, like
# Atlas). The runner's Docker sometimes loses the container right after `docker run` ("is not running"); this
# prints the container's log and starts it again, up to three times, instead of failing the whole job.
set -u
IMAGE="${MONGO_IMAGE:-mongo:8.0}"
for attempt in 1 2 3; do
  docker rm -f mongo >/dev/null 2>&1 || true
  docker run -d --name mongo -p 27017:27017 "$IMAGE" --replSet rs0 --bind_ip_all >/dev/null
  ok=0
  for i in $(seq 1 30); do
    if [ "$(docker inspect -f '{{.State.Running}}' mongo 2>/dev/null)" != "true" ]; then break; fi
    if docker exec mongo mongosh --quiet --eval "db.runCommand({ping: 1}).ok" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" = "1" ]; then
    docker exec mongo mongosh --quiet --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})" >/dev/null
    for i in $(seq 1 30); do
      [ "$(docker exec mongo mongosh --quiet --eval 'db.hello().isWritablePrimary')" = "true" ] && { echo "MongoDB replica set ready (attempt $attempt)"; exit 0; }
      sleep 1
    done
  fi
  echo "::warning::MongoDB container did not come up on attempt $attempt; its log:"
  docker logs mongo 2>&1 | tail -40 || true
  docker inspect -f 'exit code {{.State.ExitCode}}, error "{{.State.Error}}"' mongo || true
done
echo "::error::MongoDB could not be started after 3 attempts"
exit 1
