# Real local Timescale validation

On October 17, 2026 at 8:28 PM Pacific (October 18 at 03:28 UTC), Beacon passed its complete workspace checks and HTTP smoke against **PostgreSQL 18.6 (Homebrew) with TimescaleDB 2.30.2** on this Apple Silicon Mac. Node was 24.19.0. This was a real Timescale extension, hypertable, continuous aggregate, refresh policy, and explicit historical refresh—not a PostgreSQL-only substitute or mocked repository.

No accounts, cloud resources, paid services, or spending were involved. The fixtures were generated synthetic identities, signatures, device tokens, and incident observations. The isolated database listened only on loopback port 55432 and was stopped after testing. Its private data directory was removed. No persistent Homebrew database service was started.

## Recorded evidence

| Check | Result |
| --- | --- |
| Migrate fresh database, then repeat migration | Both passed |
| Complete workspace checks | **48 tests passed, 0 failed, 0 skipped**; TypeScript and ESLint passed |
| Real database integration test | Concurrent duplicate ingestion, transactional rollback, conflicting content, replay, and historical aggregate refresh passed |
| HTTP health / readiness | 200 / 200 |
| Signed SOS + endpoint receipt upload | 2 accepted; retry returned 2 duplicates |
| Observer identity spoof | Rejected |
| Missing authorization / wrong incident / revoked token | 401 / 403 / 401 |
| Authenticated replay and summary | 2 events; 1 request; 1 request with a verified endpoint receipt |
| 30-day-old events, outside rolling refresh window | Explicit refresh materialized 2 observations; queue cleared |
| Cleanup | Private daemon stopped; data directory removed; no port 55432 listener remained |

Evidence files: [full workspace output](evidence/local-timescale-workspace-check.txt), [HTTP counts and statuses](evidence/local-timescale-http.json), and [harness step results and shutdown](evidence/local-timescale-run.json). No bearer tokens or database passwords are recorded in those evidence files.

This establishes the local SQL/API path. It does **not** establish Tiger Cloud network connectivity, Vultr deployment, Docker image behavior, public HTTPS, physical Bluetooth delivery, multi-device clock accuracy, or emergency-service suitability. The HTTP receipt is a genuine signed fixture exercising application semantics; it was not transported over hardware radios.

## Local installation used

The official [Tiger Data installation guide](https://www.tigerdata.com/docs/get-started/choose-your-path/install-timescaledb) describes macOS installation through the [Timescale Homebrew tap](https://github.com/timescale/homebrew-tap). At validation time, the tap's TimescaleDB 2.30.2 formula depended on PostgreSQL 18, while the guide's example still mentioned PostgreSQL 17. Use the formula's matching PostgreSQL version; do not mix extension binaries between major PostgreSQL versions.

The installation used the following commands. They install local tools; they do not create a cloud service. Inspect the current formula and free disk space before repeating because Homebrew formula versions change.

```sh
brew tap timescale/tap
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 \
HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 HOMEBREW_NO_INSTALL_UPGRADE=1 \
HOMEBREW_MAKE_JOBS=2 \
brew install --skip-post-install timescale/tap/timescaledb --without-timescaledb-tools
/opt/homebrew/opt/timescaledb/bin/timescaledb_move.sh
```

The official extension-copy script was inspected before execution. No `timescaledb-tune`, `brew services start`, `sudo`, shell-profile modification, or security-policy change was used. The installation added PostgreSQL, Timescale, and their free local build/runtime dependencies, well below the 2 GiB task budget. Homebrew also upgraded readline and xz as dependencies, retaining their previous versions. Although the top-level post-install was skipped, PostgreSQL's dependency installation initialized an unused default cluster at `/opt/homebrew/var/postgresql@18`; it was never started or used for these checks. The validation cluster was separate. Existing personal databases were not modified. Free disk space after validation was approximately 5.5 GiB.

## Reproduce and stop

With workspace npm dependencies already installed, PostgreSQL/Timescale installed, and Node 24 available:

```sh
python3 scripts/check-local-timescale.py --node /absolute/path/to/node24
```

For this host, the Node executable used was `/Users/darshanrengarajan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`. Override `--pg-bin` for another installation location or `--port` if 55432 is occupied. The harness refuses Node versions other than 24 and the default PostgreSQL port 5432.

The [harness](../scripts/check-local-timescale.py) creates a fresh private `tmp/test-timescale/run-*` directory and a short private Unix-socket directory, initializes synthetic credentials, and binds PostgreSQL to `127.0.0.1`. Host connections use SCRAM authentication. Local socket trust is restricted by its private directory. Timescale telemetry is disabled. The password file is removed immediately after initialization, and credentials are passed only through the child process environment.

It runs migrations twice, sets both `DATABASE_URL` and the integration test's actual opt-in variable `BEACON_TEST_DATABASE_URL`, runs `scripts/check-workspace.sh`, and executes the [HTTP smoke](../scripts/local-timescale-smoke.ts). The smoke checks its destination is a loopback database named `beacon_validation` on a nondefault port before inserting synthetic data. It is intended for the fresh database created by the harness.

The harness always attempts to stop its own cluster in a `finally` block, checks that the daemon is stopped, and then removes the cluster. Per-step logs remain under its run directory; sanitized evidence is written to `docs/evidence/`. If the harness itself is forcibly killed, inspect that run's `data/postmaster.pid` and stop only its private cluster manually:

```sh
/opt/homebrew/opt/postgresql@18/bin/pg_ctl \
  -D '/absolute/path/to/beacon/tmp/test-timescale/run-IDENTIFIER/data' -m fast -w stop
```

Do not substitute a personal database directory. A normal successful run needs no manual shutdown and does not install an automatic startup service.
