# ATAK SDK artifacts for `atak-trust-overlay`

`plugins/atak-trust-overlay/build.gradle.kts` validates ATAK SDK jars before Android compilation.

## Required filenames

Default ATAK SDK contract:

- `atak-sdk.jar`

This is controlled by Gradle property `atak.required.artifacts` (comma-separated filenames), which defaults to:

```properties
atak.required.artifacts=atak-sdk.jar
```

Optional local-only stub mode:

```properties
atak.use.stub.artifacts=true
```

When `atak.use.stub.artifacts=true`, the default required artifact set becomes `main.jar` and stubs are auto-packaged from `stub-src/` for offline development.

## Placement

Place required files directly in this folder:

```bash
cp /path/to/atak-sdk.jar plugins/atak-trust-overlay/libs/atak-sdk.jar
```

## Preflight behavior

`preBuild` runs `verifyAtakSdkPrerequisites` and fails if any filename in `atak.required.artifacts` is missing from this directory.
