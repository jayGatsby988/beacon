#!/usr/bin/env python3
"""Run real, free local Timescale validation; never provision cloud resources or use brew services."""
from pathlib import Path
import argparse
import json
import os
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile

def cleanup_cluster(pg, cluster, sock, pwfile, results):
    """Delete private data only after pg_ctl explicitly confirms no running server."""
    control = [str(pg / 'pg_ctl'), '-D', str(cluster)]
    problems = []

    def status():
        try:
            check = subprocess.run(control + ['status'], capture_output=True, timeout=15)
            return check.returncode
        except (OSError, subprocess.TimeoutExpired) as error:
            problems.append(f'Could not check private database status: {error}')
            return None

    initial_status = status()
    results['stop'] = None
    if initial_status == 0:
        try:
            stopped = subprocess.run(control + ['-m', 'fast', '-w', 'stop'],
                                     text=True, capture_output=True, timeout=60)
            print('stop:', stopped.returncode, stopped.stdout, stopped.stderr, flush=True)
            results['stop'] = stopped.returncode
            if stopped.returncode:
                problems.append(f'Private database stop returned {stopped.returncode}')
        except (OSError, subprocess.TimeoutExpired) as error:
            problems.append(f'Could not stop private database: {error}')
    elif initial_status == 3:
        results['stop'] = 0
    else:
        problems.append(f'Ambiguous private database status: {initial_status}')

    final_status = status()
    results['finalDatabaseStatus'] = final_status
    # pg_ctl status: 0 = running, 3 = not running; other codes are errors.
    results['daemonStopped'] = final_status == 3
    pwfile.unlink(missing_ok=True)
    if results['daemonStopped']:
        shutil.rmtree(sock, ignore_errors=True)
        shutil.rmtree(cluster, ignore_errors=True)
    else:
        recovery = shlex.join(control + ['-m', 'fast', '-w', 'stop'])
        results['recoveryCommand'] = recovery
        problems.append(f'Private database shutdown is unconfirmed. Preserved {cluster} '
                        f'and {sock}. Inspect the private cluster, then run: {recovery}')
    if problems:
        results['cleanupErrors'] = problems
        results.setdefault('failure', 'Private database cleanup needs review')
        print('\n'.join(problems), file=sys.stderr, flush=True)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--node', default=shutil.which('node'), help='Node.js 24 executable')
parser.add_argument('--pg-bin', default='/opt/homebrew/opt/postgresql@18/bin', help='PostgreSQL bin directory with installed Timescale extension')
parser.add_argument('--port', type=int, default=55432)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
pg = Path(args.pg_bin)
node = Path(args.node or '')
if not node.is_file() or not (pg / 'initdb').is_file():
    parser.error('Install PostgreSQL/Timescale and provide --node pointing to Node 24 first')
if args.port == 5432 or not 1024 <= args.port <= 65535:
    parser.error('Use an unprivileged, nondefault port')
version = subprocess.check_output([str(node), '--version'], text=True).strip()
if not version.startswith('v24.'):
    parser.error('Node 24 is required')
base = root / 'tmp/test-timescale'
base.mkdir(parents=True, exist_ok=True)
area = Path(tempfile.mkdtemp(prefix='run-', dir=base))
cluster = area / 'data'
sock = Path(tempfile.mkdtemp(prefix='beacon-timescale-socket-', dir='/tmp'))
password = secrets.token_urlsafe(24)
pwfile = area / 'password'
pwfile.write_text(password + '\n')
pwfile.chmod(0o600)
env = os.environ.copy()
env.update({'PATH': str(node.parent) + os.pathsep + env.get('PATH', ''),
            'PGPASSWORD': password, 'PGHOST': '127.0.0.1', 'PGPORT': str(args.port),
            'PGUSER': 'beacon_test', 'PGDATABASE': 'beacon_validation', 'DB_SSL': 'disable'})
env['DATABASE_URL'] = f'postgresql://beacon_test:{password}@127.0.0.1:{args.port}/beacon_validation'
env['BEACON_TEST_DATABASE_URL'] = env['DATABASE_URL']
results = {'nodeVersion': version, 'port': args.port, 'scope': 'isolated local Timescale; synthetic data only'}
evidence = root / 'docs/evidence'
evidence.mkdir(parents=True, exist_ok=True)


def run(command, label, timeout=180):
    result = subprocess.run([str(arg) for arg in command], env=env, cwd=root,
                            text=True, capture_output=True, timeout=timeout)
    (area / f'{label}.stdout.log').write_text(result.stdout)
    (area / f'{label}.stderr.log').write_text(result.stderr)
    print(f'{label}: exit {result.returncode}', flush=True)
    if result.stdout:
        print(result.stdout[-18000:], flush=True)
    if result.stderr:
        print(result.stderr[-6000:], flush=True)
    results[label] = result.returncode
    if result.returncode:
        raise RuntimeError(f'{label} failed; inspect {area}')
    return result


try:
    run([pg / 'initdb', '-D', cluster, '--username=beacon_test', '--pwfile=' + str(pwfile),
         '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C'], 'initdb')
    pwfile.unlink()
    options = (f'-h 127.0.0.1 -p {args.port} -k {sock} '
               '-c shared_preload_libraries=timescaledb -c timescaledb.telemetry_level=off '
               '-c shared_buffers=32MB -c max_connections=20 -c max_worker_processes=16 '
               '-c timescaledb.max_background_workers=4')
    run([pg / 'pg_ctl', '-D', cluster, '-l', area / 'postgres.log', '-o', options, '-w', 'start'], 'start')
    run([pg / 'createdb', 'beacon_validation'], 'create-database')
    run([node, '--import', 'tsx', 'apps/api/src/admin.ts', 'migrate'], 'migration')
    run([node, '--import', 'tsx', 'apps/api/src/admin.ts', 'migrate'], 'migration-idempotent')
    checks = run(['bash', 'scripts/check-workspace.sh'], 'workspace-check', timeout=300)
    (evidence / 'local-timescale-workspace-check.txt').write_text(checks.stdout)
    smoke = run([node, '--import', 'tsx', 'scripts/local-timescale-smoke.ts'], 'http-smoke')
    (evidence / 'local-timescale-http.json').write_text(smoke.stdout)
except Exception as error:
    print(str(error), file=sys.stderr, flush=True)
    results['failure'] = str(error)
finally:
    cleanup_cluster(pg, cluster, sock, pwfile, results)
    (area / 'results.json').write_text(json.dumps(results, indent=2))
    (evidence / 'local-timescale-run.json').write_text(json.dumps(results, indent=2))
    if 'failure' in results:
        sys.exit(1)
