import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { MapState } from '../../apps/mobile/src/ui/types.js';

// Exercise the actual MapService source. Only native MapLibre/FileSystem and HTTP are test doubles.
// These tests do not establish native map downloads, offline coverage, or physical-device behavior.
const source = readFileSync(new URL('../../apps/mobile/src/services/MapService.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const campus = JSON.parse(readFileSync(new URL('../../apps/mobile/assets/maps/uw-campus.json', import.meta.url), 'utf8'));
const PACK = 'beacon-local-region';
const styleResponse = () => new Response(JSON.stringify({ version: 8, sources: {}, layers: [] }), { status: 200 });
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Progress = { percentage: number; completedResourceSize: number };
type Callbacks = { progress: (pack: unknown, status: Progress) => void; error: (pack: unknown, error: Error) => void };
type Service = { download(): Promise<void>; remove(): Promise<void>; dispose(): void };
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(options: { fetchGate?: ReturnType<typeof deferred<Response>>; createGate?: ReturnType<typeof deferred<void>> } = {}) {
  const fetchStarted = deferred<void>(), createStarted = deferred<void>();
  const changed: MapState[] = [], persisted: MapState[] = [], callbacks: Callbacks[] = [];
  const calls: string[] = [], packs = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let signal: AbortSignal | undefined;
  const clone = (state: MapState): MapState => JSON.parse(JSON.stringify(state));
  const native = { offlineManager: {
    getPacks: async () => [...packs].map(name => ({ name })),
    deletePack: async (name: string) => { calls.push(`delete:${name}`); packs.delete(name); },
    createPack: async (config: { name: string }, progress: Callbacks['progress'], error: Callbacks['error']) => {
      calls.push('create:start'); callbacks.push({ progress, error }); createStarted.resolve();
      await options.createGate?.promise;
      packs.add(config.name); calls.push('create:resolved');
    },
  } };
  const fakeRequire = (id: string) => {
    if (id === '@maplibre/maplibre-react-native') return native;
    if (id === 'expo-file-system/legacy') return { documentDirectory: 'file:///test-only/', writeAsStringAsync: async () => { calls.push('write:style'); } };
    if (id === '../../assets/maps/uw-campus.json') return campus;
    throw new Error(`Unexpected MapService runtime dependency: ${id}`);
  };
  const module = { exports: {} as { MapService: new (...args: any[]) => Service } };
  runInNewContext(`(function(exports, require, module) { ${compiled}\n})`, {
    URL, AbortController, Date,
    fetch: async (_url: string, init: { signal: AbortSignal }) => {
      signal = init.signal; fetchStarted.resolve();
      // A late response can still settle after abort; generation checks must prevent native creation.
      return options.fetchGate ? options.fetchGate.promise : styleResponse();
    },
    setTimeout: (fn: () => void, delay: number) => { const timer = setTimeout(fn, delay); timers.add(timer); return timer; },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); clearTimeout(timer); },
  }, { filename: 'MapService.transpiled.test.cjs' })(module.exports, fakeRequire, module);
  const repo = {
    getSetting: async (key: string, fallback: unknown) => key === 'mapStyleUrl' ? 'https://maps.example.test/style.json' : fallback,
    setSetting: async (key: string, state: MapState) => { assert.equal(key, 'offlineMap'); persisted.push(clone(state)); },
  };
  const service = new module.exports.MapService(repo, () => ({ latitude: 47.655, longitude: -122.306, source: 'device' }), (state: MapState) => changed.push(clone(state)));
  return {
    service, fetchStarted, createStarted, changed, persisted, callbacks, calls, packs,
    signal: () => signal,
    cleanup: () => { service.dispose(); for (const timer of timers) clearTimeout(timer); },
  };
}

test('cancel during held style fetch aborts HTTP and prevents native pack creation even if a late response resolves', { timeout: 5000 }, async t => {
  const fetchGate = deferred<Response>(), h = fixture({ fetchGate }); t.after(h.cleanup);
  const downloading = h.service.download();
  await h.fetchStarted.promise;
  assert.equal(h.changed.at(-1)?.status, 'downloading');
  let removed = false;
  const removing = h.service.remove().then(() => { removed = true; });
  assert.equal(h.signal()?.aborted, true, 'remove must signal the in-flight fetch to abort');
  await turn();
  assert.equal(removed, false, 'remove waits for unresolved setup rather than allowing a zombie operation');
  fetchGate.resolve(styleResponse());
  await Promise.all([downloading, removing]);
  assert.equal(h.callbacks.length, 0, 'late style completion must not reach createPack');
  assert.equal(h.packs.size, 0);
  assert.deepEqual(h.calls, [], 'no native creation, deletion, or style write follows the canceled fetch');
  assert.deepEqual(h.changed.at(-1), { status: 'missing', progress: 0 });
  assert.deepEqual(h.persisted.at(-1), { status: 'missing', progress: 0 });
});

test('cancel during held native createPack waits for creation before deleting the resulting pack', { timeout: 5000 }, async t => {
  const createGate = deferred<void>(), h = fixture({ createGate }); t.after(h.cleanup);
  const downloading = h.service.download();
  await h.createStarted.promise;
  let removed = false;
  const removing = h.service.remove().then(() => { removed = true; });
  await turn();
  assert.equal(removed, false);
  assert.deepEqual(h.calls, ['write:style', 'create:start'], 'deleting before create settles could leave a pack behind');
  h.callbacks[0].progress(null, { percentage: 100, completedResourceSize: 2048 });
  await turn();
  assert.equal(h.changed.some(state => state.status === 'ready'), false, 'stale completion cannot report ready while cancellation waits');
  createGate.resolve();
  await Promise.all([downloading, removing]);
  assert.deepEqual(h.calls, ['write:style', 'create:start', 'create:resolved', `delete:${PACK}`]);
  assert.equal(h.packs.size, 0, 'the pack created after cancellation must still be removed');
  assert.deepEqual(h.persisted.at(-1), { status: 'missing', progress: 0 });
});

test('late progress and error callbacks cannot revive a removed pack or overwrite a subsequent download', { timeout: 5000 }, async t => {
  const h = fixture(); t.after(h.cleanup);
  await h.service.download();
  const stale = h.callbacks[0];
  await h.service.remove();
  const removedStateCount = h.changed.length, removedWrites = h.persisted.length;
  stale.progress(null, { percentage: 100, completedResourceSize: 4096 });
  stale.error(null, new Error('Late native error'));
  await turn();
  assert.equal(h.changed.length, removedStateCount);
  assert.equal(h.persisted.length, removedWrites, 'stale callbacks must not restore persisted ready/error state');
  assert.equal(h.packs.size, 0);

  await h.service.download();
  assert.equal(h.callbacks.length, 2, 'cancellation must release the operation so a new download can start');
  const current = h.callbacks[1];
  current.progress(null, { percentage: 35, completedResourceSize: 1024 });
  await turn();
  const writesBeforeStale = h.persisted.length;
  stale.progress(null, { percentage: 100, completedResourceSize: 999999 });
  stale.error(null, new Error('Older generation failed'));
  await turn();
  assert.equal(h.persisted.length, writesBeforeStale);
  assert.equal(h.changed.at(-1)?.status, 'downloading');
  assert.equal(h.changed.at(-1)?.progress, .35);
  current.progress(null, { percentage: 100, completedResourceSize: 8192 });
  await turn();
  assert.equal(h.changed.at(-1)?.status, 'ready', 'the current operation still accepts genuine progress');
  assert.equal(h.persisted.at(-1)?.bytes, 8192);
});
