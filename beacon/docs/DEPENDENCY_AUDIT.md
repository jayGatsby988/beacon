# Dependency audit — October 17, 2026

Read-only npm audit and registry/advisory inspection were performed against the installed Expo SDK 54 / React Native 0.81.5 workspace. No package install, lockfile update, or dependency override was performed by this audit. Keep SDK 54 and React Native 0.81.5 for the available Xcode 26.0.1 toolchain; npm's suggested Expo 44 / React Native 0.75 or Expo Router 58 replacements are not a compatible remediation plan.

## Observed results

| Command | Result |
| --- | --- |
| `npm audit --json` | 44 affected package entries: 23 high, 21 moderate, 0 critical |
| `npm audit --workspace @beacon/api --omit=dev --json` | 0 reported vulnerabilities |
| API TypeScript check | Passed |
| API tests after replay-size fix | 6 passed; 1 Timescale integration test explicitly skipped |

The 44 entries are seven vulnerable leaf packages plus dependent packages marked affected. They are not 44 distinct exploitable API defects. `npm --omit=dev` is also not a mobile bundle reachability analysis: Expo lists development/build dependencies inside its package dependencies. The API-only result is useful evidence, but not a comprehensive security guarantee. The shared protocol uses Noble Ed25519, not node-forge RSA.

## Reachability and compatible action

| Leaf package | Installed / advisory | Beacon exposure | Recommended action |
| --- | --- | --- | --- |
| `decode-uri-component` | 0.2.2; affected ≤0.4.2 | **Mobile runtime** through `expo-router@6.0.24 → query-string@7.1.3`. Malformed URL percent-encoding can cause CPU exhaustion. | Fixed 0.5.0 changes to ESM. The installed query-string calls a CommonJS function directly, so a blanket override is unsafe. A native-intent guard now accepts only known Beacon routes and 64-hex request IDs, caps input at 256 characters, and rejects percent-encoding, queries, fragments, control characters and unknown schemes before Router route parsing. Focused tests cover cold/warm links and oversized hostile input; actual OS link dispatch still needs device validation. A full package fix requires a tested CJS-compatible backport or compatible Router upgrade. |
| `postcss` | 8.4.49; affected through 8.5.22 across reported source-map issues | **Build tooling** under `@expo/metro-config@54.0.17`. Untrusted CSS/source maps are the relevant input. Not used by Beacon API. | Candidate exact scoped override **8.5.30** preserves CommonJS/ESM exports and stays within major 8, though outside the parent's `~8.4.32` range. Coordinate one install after active builds finish, then rerun export/native bundling and audit. |
| `image-size` | 1.2.1; affected through 2.0.2 | **Build tooling**, Metro asset parsing. Malicious image files can hang a build. | Fixed 2.0.4 is published, but Metro 0.83.3 calls its dependency as a default function; version 2 changes the export API. **Do not override blindly.** Keep bundled assets trusted and reviewed; a compatible adapter/backport needs explicit tests. |
| `uuid` | 7.0.3; affected <11.1.1 | **Native project generation**, `xcode@3.0.1`. Its only inspected call is `uuid.v4()`; the advisory concerns v3/v5/v6 supplied-buffer bounds. | No implicated call found in this path. Exact **11.1.1** retains a Node CommonJS `v4` export, but is a major-version jump; do not force it during the SDK-constrained build. A future xcode-scoped override needs prebuild/project parsing tests. |
| `braces` | 3.0.3; affected ≤3.0.3 | **Build/test tooling**, micromatch/Metro/Jest glob processing | Registry latest remains 3.0.3; no patched release found. Avoid attacker-supplied glob patterns or untrusted project configurations. Track upstream; changing Expo versions does not produce a demonstrated fix. |
| `node-forge` | 1.4.0; affected ≤1.4.0 | **Expo CLI/certificate tooling**. RSA verification issue; not Beacon mesh signatures or Node TLS. | Registry latest remains 1.4.0; advisory lists no patched version. Do not accept untrusted signing certificates in build workflows. Track upstream. |
| `sprintf-js` | 1.0.3; affected ≤1.1.3 | **Coverage/config tooling**, `@istanbuljs/load-nyc-config → js-yaml@3 → argparse` | Registry latest remains 1.1.3; no patched release found. Avoid attacker-controlled format/precision strings. Beacon runs Node's test runner, not an exposed formatting service. |

The classification above is based on dependency-parent and call-site inspection, not an exported-bundle inventory or exploit demonstration. Development-client builds include development surfaces; keep the Metro server local/trusted, and distinguish them from release artifacts.

## Narrow candidate for the next coordinated install

Only the same-major PostCSS candidate is recommended for immediate dependency remediation; this is **proposed, not applied**:

```json
{
  "overrides": {
    "@expo/metro-config": {
      "postcss": "8.5.30"
    }
  }
}
```

Root must merge it with any existing overrides, install once when no builds rely on the current `node_modules`, preserve the lockfile, run TypeScript/tests and a Metro export, and compare a fresh audit. Do not use `npm audit fix --force`; it proposes incompatible stack changes and cannot resolve packages with no published patched version.

## Cloud contract audit

`BeaconService.syncNow()` sends batches of 50 with the API's exact observer, sequence, event, optional envelope/request, and peer fields. The local SQLite `AUTOINCREMENT` sequence survives eligible-history clearing. Tokens are read from SecureStore; only server-confirmed accepted/duplicate IDs leave the outbox. Rejected and interrupted uploads remain saved. Pagination follows `nextCursor` for up to ten pages.

One integration defect was fixed: the API formerly limited replay by 2,000 events alone, while mobile rejects responses over 5 MB. Valid maximum-length Unicode envelopes can exceed that size. The API now uses both the 2,000-event limit and a **4,000,000-byte event payload budget**, and advances the cursor from the last included row. A regression test exercises maximum-length valid Unicode payloads. No DB or deployed HTTPS verification was possible; the SQL integration test remains skipped.

The service now fetches and validates the authenticated summary endpoint after replay. History displays verified recipient-receipt counts, requester-confirmed completion counts, ingestion freshness, incomplete/truncated-data labels, and actual hourly observation buckets. Displayed round trips use only this phone’s persisted SOS and validated receipt observations for requests originated here; cross-device signed timestamp differences are not labeled as round trips. Changing the cloud URL, incident or token clears old combined events, summary, freshness and error state while preserving the local upload count. Connection changes are rejected during active synchronization to prevent an old response from repopulating a new connection’s view.

## Sources

- [decode-uri-component advisory and fixed 0.5.0](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
- [PostCSS source-map advisory](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)
- [image-size ICNS parser advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
- [uuid bounds-check advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
- [braces nested-pattern advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- [node-forge RSA advisory; no patched version listed](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
- [sprintf-js precision advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)

Published versions and export metadata were verified directly through the npm registry on the audit date. Relevant local sources: `node_modules/query-string/index.js`, `node_modules/metro/src/Assets.js`, `node_modules/xcode/lib/pbxProject.js`, and `package-lock.json`.

## Native-link and connection-state verification

`npm --workspace @beacon/mobile run typecheck` passed. Seven focused service tests passed, including supported cold/warm native links, malformed and oversized input, invalid request IDs and schemes, HTTPS destination validation, and cloud snapshot invalidation. This guard is native-only; Expo documents that `+native-intent` is not a web routing interceptor. The underlying vulnerable package remains installed, so npm audit will continue to report it. No dependency override or SDK upgrade was made. [Expo native-intent documentation](https://docs.expo.dev/router/advanced/native-intent/)
