#!/bin/bash
# Compatibility entry point: keep all packaging logic in setup.sh.
set -euo pipefail
exec /bin/bash "$(dirname "$0")/setup.sh" "$@"
