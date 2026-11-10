#!/usr/bin/env bash
# Download small public test media containing people into backend/samples/.
set -euo pipefail
cd "$(dirname "$0")/../samples" 2>/dev/null || { mkdir -p "$(dirname "$0")/../samples"; cd "$(dirname "$0")/../samples"; }
[ -f people-detection.mp4 ] || curl -fL -o people-detection.mp4 https://github.com/intel-iot-devkit/sample-videos/raw/master/people-detection.mp4
[ -f bus.jpg ] || curl -fL -o bus.jpg https://ultralytics.com/images/bus.jpg
ls -lh
