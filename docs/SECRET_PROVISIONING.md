# Desktop Release Secret Provisioning Guide

## Required Secrets for Production Releases

### Windows Code Signing
- **WINDOWS_CERTIFICATE**: Base64-encoded PFX certificate file
- **WINDOWS_CERTIFICATE_PASSWORD**: Password for the PFX certificate

To provision:
```bash
# Convert PFX to base64
base64 -i certificate.pfx | pbcopy  # macOS
base64 -w 0 certificate.pfx         # Linux

# Add to GitHub Secrets:
# Settings -> Secrets and variables -> Actions -> New repository secret
# Name: WINDOWS_CERTIFICATE
# Value: <paste base64 content>
# 
# Name: WINDOWS_CERTIFICATE_PASSWORD
# Value: <your certificate password>
```

### macOS Code Signing
- **APPLE_CERTIFICATE**: Base64-encoded P12 certificate file
- **APPLE_CERTIFICATE_PASSWORD**: Password for the P12 certificate
- **APPLE_SIGNING_IDENTITY**: Developer ID Application certificate identity

To provision:
```bash
# Export certificate from Keychain as P12, then convert to base64
base64 -i certificate.p12 | pbcopy  # macOS
base64 -w 0 certificate.p12         # Linux

# Add to GitHub Secrets:
# Settings -> Secrets and variables -> Actions -> New repository secret
# Name: APPLE_CERTIFICATE
# Value: <paste base64 content>
#
# Name: APPLE_CERTIFICATE_PASSWORD
# Value: <your certificate password>
#
# Name: APPLE_SIGNING_IDENTITY
# Value: "Developer ID Application: Your Name (TEAM_ID)"
```

## Pre-Release Builds (Testing)

For testing purposes, you can create pre-release builds WITHOUT provisioning these secrets by using pre-release version tags:

```bash
# These tags will bypass code signing requirements:
git tag v1.0.0-alpha
git tag v1.0.0-beta
git tag v1.0.0-rc1
git tag v1.0.0-dev
git tag v1.0.0-pre

# Push the tag to trigger the workflow
git push origin v1.0.0-alpha
```

Pre-release builds will:
- ✅ Build successfully without code signing secrets
- ⚠️  Show warnings that code signing is not configured
- ⚠️  Generate unsigned binaries (not suitable for distribution)
- ✅ Still run all other validation checks (SBOM, tests, etc.)

## Production Releases

Production releases MUST have valid code signing secrets configured. Use semantic version tags without pre-release suffixes:

```bash
# These tags require code signing:
git tag v1.0.0
git tag v2.1.0

# Will FAIL without secrets
```

The workflow will exit with an error if code signing secrets are not configured for production releases.

## Validation

To verify secrets are properly configured:

1. Navigate to: https://github.com/FourMIK/AetherCore/settings/secrets/actions
2. Confirm the following secrets exist:
   - WINDOWS_CERTIFICATE
   - WINDOWS_CERTIFICATE_PASSWORD
   - APPLE_CERTIFICATE
   - APPLE_CERTIFICATE_PASSWORD
   - APPLE_SIGNING_IDENTITY

3. Test with a pre-release build first:
   ```bash
   git tag v1.0.0-alpha
   git push origin v1.0.0-alpha
   ```

4. Once verified, create production release:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

## Security Considerations

### Certificate Management
- **Never** commit certificates or passwords to source control
- Store certificates in a secure password manager or HSM
- Rotate certificates before expiration
- Use separate certificates for testing and production
- Restrict GitHub secret access to required workflows only

### Code Signing Best Practices
- Verify certificate chain before provisioning
- Test code signing process in pre-release builds first
- Monitor certificate expiration dates
- Document certificate renewal procedures
- Maintain audit trail of who has access to signing credentials

### TPM Integration (Future)
Per AetherCore architectural invariants, production deployments should eventually migrate to TPM-backed Ed25519 keys (CodeRalphie). Current certificate-based signing is a transitional approach for desktop releases.

## Troubleshooting

### "Code signing not configured" Error
**Symptom**: Workflow fails with "❌ RELEASE BLOCKED: Code signing not configured"

**Solution**:
1. Check if this is intended as a production release
2. If testing, use a pre-release tag (e.g., v1.0.0-alpha)
3. If production, verify secrets are provisioned correctly
4. Ensure secret names match exactly (case-sensitive)

### Base64 Encoding Issues
**Symptom**: Certificate import fails in workflow

**Solution**:
1. Verify base64 encoding is correct:
   ```bash
   # Decode and verify
   base64 -d certificate_base64.txt > test.pfx
   # Should match original file size
   ```
2. Ensure no line breaks in base64 string (use -w 0 on Linux)
3. Check for trailing whitespace or newlines

### Wrong Certificate Identity
**Symptom**: macOS signing fails with identity mismatch

**Solution**:
1. List available identities:
   ```bash
   security find-identity -v -p codesigning
   ```
2. Copy exact identity string (including "Developer ID Application:")
3. Update APPLE_SIGNING_IDENTITY secret

## References

- [GitHub Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Tauri Code Signing](https://tauri.app/v1/guides/distribution/sign-windows)
- [Apple Developer ID Signing](https://developer.apple.com/developer-id/)
- [Windows Code Signing](https://learn.microsoft.com/en-us/windows/win32/seccrypto/cryptography-tools)
