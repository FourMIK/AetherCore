# QUICKBUILD (ATAK Trust Overlay)

Steps (dev env, ATAK SDK already staged in libs/, Java 17, Android SDK present):

1. Clean prior build
   pnpm run clean:atak

2. Build plugin (stub-friendly)
   pnpm run build:atak

3. Verify outputs
   - Expected JAR: plugins/atak-trust-overlay/build/outputs/main.jar
   - Staged copy: dist/atak/main.jar

4. Deploy to device/emulator (ATAK-Civ)
   pnpm run deploy:atak

5. Validate on device
   - Settings → Plugins → "AetherCore Trust Overlay" shows Loaded
   - Map overlay renders trust markers; telemetry heartbeats seen

Notes
- Requires ATAK SDK artifacts in plugins/atak-trust-overlay/libs (see local.properties atak.required.artifacts)
- Uses Gradle wrapper 8.7; Java 17; Android SDK Build Tools 34.x
- Uses archiveBaseName "main" to match deploy tooling
