#!/bin/sh
set -e

. /app/file-env.sh
load_file_env

exec node dist/main.js
