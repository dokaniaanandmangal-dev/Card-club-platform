# Build Provenance Policy

Every certifiable runtime artifact must be cryptographically bound to its GitHub Actions build context.

The certification workflow builds the runtime image, exports that exact image as an artifact, and generates a SLSA provenance attestation with GitHub's OIDC-backed `actions/attest` flow. The workflow immediately verifies the signed attestation against:

- this repository,
- the exact certification workflow path, and
- the source commit digest for the workflow run.

The attestation action is pinned to an immutable commit SHA, and elevated permissions (`id-token`, `attestations`, and artifact metadata) are scoped only to the provenance job. Other certification jobs retain read-only repository permissions.

Because this repository is public, GitHub's artifact-attestation flow uses Sigstore's public-good signing infrastructure. A future production registry release should additionally attest the pushed OCI digest and enforce attestation verification at admission/deployment time.
