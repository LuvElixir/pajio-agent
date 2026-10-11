#!/usr/bin/env bash
set -euo pipefail
umask 077
native_source="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
keycloak_lib="${1:?Keycloak 26.7.4 lib directory}"
native_build="${2:?New build output directory}"
test -f "$keycloak_lib/org.keycloak.keycloak-core-26.7.4.jar"
mkdir -p "$native_build/classes/META-INF/services"
javac --release 21 -encoding UTF-8 -Xlint:all -Werror -cp "$keycloak_lib/*" -d "$native_build/classes" "$native_source"/src/io/pajio/nativeclient/*.java
cp "$native_source"/META-INF/services/* "$native_build/classes/META-INF/services/"
(cd "$native_build/classes" && jar --create --no-manifest --date=2026-10-12T00:00:00Z --file ../pajio-native-client.jar META-INF io)
sha256sum "$native_build/pajio-native-client.jar"
