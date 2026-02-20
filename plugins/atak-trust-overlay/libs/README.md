# ATAK SDK artifacts for `atak-trust-overlay`

`plugins/atak-trust-overlay/build.gradle.kts` validates ATAK SDK jars before Android compilation.

## Required filenames

Default offline contract:

- `main.jar`

This is controlled by Gradle property `atak.required.artifacts` (comma-separated filenames), which defaults to:

```properties
atak.required.artifacts=main.jar
```

## Placement

Place required files directly in this folder:

```bash
cp atak/ATAK/app/build/libs/main.jar plugins/atak-trust-overlay/libs/main.jar
```

## Preflight behavior

`preBuild` runs `verifyAtakSdkArtifacts` and fails if any filename in `atak.required.artifacts` is missing from this directory.
