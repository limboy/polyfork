---
name: release
description: Publish, check, or retry Polyfork macOS releases through the project's GitHub Actions workflow, including version tags and signed, notarized DMG assets. Use for Polyfork release requests; iOS and App Store distribution use a different workflow.
---

# Release Polyfork

Ship the macOS desktop app using the existing GitHub Actions pipeline. For status or planning requests, perform read-only checks. When the user requests publication, carry out the authorized release through verification, reusing authorization already given in the conversation.

## Project contract

- Repository: `limboy/polyfork`; normal release branch: `main`.
- Version source: [mygo.config.ts](../../../mygo.config.ts). `package.json` has no application version to bump.
- Workflow: [build-macos.yml](../../../.github/workflows/build-macos.yml), named **Build macOS DMG**.
- A tag must be exactly `v` plus the configured version. A tag run builds a universal Apple Silicon/Intel app, signs and notarizes it, verifies the DMG, then publishes the Release and generated release notes. A prerelease version containing `-` produces a GitHub prerelease.
- The published asset is `polyfork-<version>.dmg`. The Actions artifact is named `Polyfork-macOS-universal`; uploading that artifact alone does not publish a Release.
- Signing uses the configured Actions secrets and a temporary CI keychain. Refer to [the credential setup instructions](../../../README.md#signing-and-notarization) when credential setup is part of the request.

## Prepare the release

1. Work from the repository root. Inspect the working tree, current branch, origin, recent commits, remote tags, and existing releases. Fetch `origin/main` and tags as needed. Preserve unrelated work and stage only the release changes authorized by the user.
2. Resolve the target version from the request, configuration, and release history. Ask for a version only when the intended version remains ambiguous. Update `version` in `mygo.config.ts` when a bump is needed; keep README examples that claim to show the current version consistent.
3. Read the evaluated version with Bun:

   ```sh
   bun -e 'import config from "./mygo.config.ts"; console.log(config.version)'
   ```

4. Check whether the intended tag exists remotely. If it already points to the intended commit, use its existing run or Release. A tag pointing to another commit requires resolving the version or source discrepancy; preserve published tags and assets.
5. Review and commit the selected release changes. Push the release commit and workflow to `origin/main` before tagging, unless the user specified another release source. An uncommitted local workflow cannot run on GitHub; manual dispatch also requires the workflow on the default branch.

Use CI for the full release checks and packaging. If local Go checks are needed, use `CGO_ENABLED=0 go test -short ./...`: the full Go tests download real models. Validate workflow changes with `actionlint` when available.

## Write release notes

Prepare a Markdown notes file from the commits and relevant diffs since the previous published release; for the first release, summarize the shipped features from the tagged source. List concrete user-visible additions, improvements, and fixes directly in the notes. Include relevant platform and installation details, and keep the full changelog link as supporting context.

GitHub's `--generate-notes` can produce only a changelog link when changes were committed without pull requests. Supply the prepared summary as part of completing the release. Preserve useful existing notes when updating a published Release, and distinguish source-only platform changes from features available in the attached DMG.

## Publish and verify

Once the source, version, and authorization are settled, tag the exact release commit and push only that tag. For example, with `version` resolved above and the intended release commit checked out:

```sh
version="$(bun -e 'import config from "./mygo.config.ts"; console.log(config.version)')"
tag="v$version"
release_commit="$(git rev-parse HEAD)"
git tag "$tag" "$release_commit"
git push origin "refs/tags/$tag"
```

Let the workflow publish the verified DMG. Follow an existing active tag run rather than starting a duplicate. To locate the run:

```sh
gh run list --repo limboy/polyfork --workflow build-macos.yml \
  --commit "$release_commit" \
  --json databaseId,event,headBranch,headSha,status,conclusion,url
```

Use the full commit SHA. Both the `main` push and tag push can have that SHA; select the run whose `headBranch` is the version tag. Allow a short delay for a newly pushed tag to appear.

Watch that run with `gh run watch RUN_ID --repo limboy/polyfork --exit-status`, keeping the user informed during long signing or notarization waits. Unless the user asked only to trigger the build, verify that **Publish GitHub Release** succeeded, apply the prepared notes, and inspect the published Release:

```sh
gh release edit "$tag" --repo limboy/polyfork --notes-file "$notes_file"
gh release view "$tag" --repo limboy/polyfork --json tagName,url,isDraft,body,assets
```

Confirm the expected tag, `isDraft: false`, the matching `polyfork-<version>.dmg` asset, and a readable change list in the body. Report the version, Release URL, and DMG download link. If the run is still pending or failed, report its actual state rather than calling the release complete.

## Recover a failed release

Inspect `gh run view RUN_ID --repo limboy/polyfork --log-failed` and identify whether the failure was in version checking, signing, notarization, packaging, or publication. Address causes within the authorized scope.

For a transient failure, retry the failed jobs with `gh run rerun RUN_ID --repo limboy/polyfork --failed`. Limit an unchanged retry to one attempt; if the same failure repeats, report the failing step and run link instead of looping. Reruns use the original tagged commit, so a source or workflow fix on `main` requires a new version/tag to take effect unless the user has explicitly authorized changing an unpublished tag.

When rebuilding an existing tag is appropriate, manually dispatch with `gh workflow run build-macos.yml --repo limboy/polyfork --ref "$tag"`. The publish job can upload a missing DMG or finish a draft; it preserves existing published assets. Keep these recovery actions within the requested release scope.
