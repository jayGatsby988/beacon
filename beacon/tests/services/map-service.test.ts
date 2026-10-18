import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { MapState } from "../../apps/mobile/src/ui/types.js";

// Exercise the actual MapService source. Only native MapLibre/FileSystem and HTTP are test doubles.
// These tests do not establish native map downloads, offline coverage, or physical-device behavior.
const source = readFileSync(
  new URL("../../apps/mobile/src/services/MapService.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const campus = JSON.parse(
  readFileSync(
    new URL("../../apps/mobile/assets/maps/uw-campus.json", import.meta.url),
    "utf8",
  ),
);
const PACK = "beacon-local-region";
const styleResponse = () =>
  new Response(JSON.stringify({ version: 8, sources: {}, layers: [] }), {
    status: 200,
  });
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Progress = {
  state?: number;
  percentage: number;
  completedResourceSize: number;
  completedResourceCount?: number;
  requiredResourceCount?: number;
};
type Callbacks = {
  progress: (pack: unknown, status: Progress) => void;
  error: (pack: unknown, error: Error) => void;
};
type Service = {
  initialize(): Promise<void>;
  cancel(): Promise<void>;
  download(
    refresh?: () => Promise<void>,
    customStyleUrl?: string,
  ): Promise<void>;
  remove(): Promise<void>;
  dispose(): void;
};
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(
  options: {
    fetchGate?: ReturnType<typeof deferred<Response>>;
    createGate?: ReturnType<typeof deferred<void>>;
    geometry?: boolean;
    legacyStyleUrl?: string;
    response?: () => Response;
    location?: unknown;
    stored?: MapState;
    files?: Map<string, string>;
    status?: Progress;
    restorePack?: boolean;
  } = {},
) {
  const fetchStarted = deferred<void>(),
    createStarted = deferred<void>();
  const changed: MapState[] = [],
    persisted: MapState[] = [],
    callbacks: Callbacks[] = [];
  const calls: string[] = [],
    packs = new Set<string>(options.restorePack ? [PACK] : []);
  const files = options.files ?? new Map<string, string>();
  const requests: { url: string; init: any }[] = [];
  const complete = {
    state: 3,
    percentage: 100,
    completedResourceSize: 8192,
    completedResourceCount: 100,
    requiredResourceCount: 100,
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let signal: AbortSignal | undefined;
  const clone = (state: MapState): MapState =>
    JSON.parse(JSON.stringify(state));
  const native = {
    OfflinePackDownloadState: { Complete: 3 },
    offlineManager: {
      getPacks: async () =>
        [...packs].map((name) => ({
          name,
          status: async () => options.status ?? complete,
          pause: async () => {
            calls.push("pause");
          },
        })),
      deletePack: async (name: string) => {
        calls.push(`delete:${name}`);
        packs.delete(name);
      },
      createPack: async (
        config: { name: string },
        progress: Callbacks["progress"],
        error: Callbacks["error"],
      ) => {
        calls.push("create:start");
        callbacks.push({ progress, error });
        createStarted.resolve();
        await options.createGate?.promise;
        packs.add(config.name);
        calls.push("create:resolved");
      },
    },
  };
  const fakeRequire = (id: string) => {
    if (id === "@maplibre/maplibre-react-native") return native;
    if (id === "expo-file-system/legacy")
      return {
        documentDirectory: "file:///test-only/",
        writeAsStringAsync: async (path: string, text: string) => {
          calls.push("write:style");
          files.set(path, text);
        },
        getInfoAsync: async (path: string) => ({
          exists: files.has(path),
          size: files.get(path)?.length ?? 0,
        }),
        readAsStringAsync: async (path: string) => {
          if (!files.has(path)) throw new Error("missing");
          return files.get(path);
        },
        readDirectoryAsync: async () =>
          [...files.keys()].map((path) =>
            path.replace("file:///test-only/", ""),
          ),
        deleteAsync: async (path: string) => {
          files.delete(path);
        },
      };
    if (id === "../components/campusMapStyle") {
      const styleSource = readFileSync(
        new URL(
          "../../apps/mobile/src/components/campusMapStyle.ts",
          import.meta.url,
        ),
        "utf8",
      );
      const styleModule = { exports: {} };
      const js = ts.transpileModule(styleSource, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      }).outputText;
      runInNewContext(`(function(exports, require, module) { ${js}\n})`)(
        styleModule.exports,
        fakeRequire,
        styleModule,
      );
      return styleModule.exports;
    }
    if (id === "../../assets/maps/uw-campus.json") return campus;
    throw new Error(`Unexpected MapService runtime dependency: ${id}`);
  };
  const module = {
    exports: {} as { MapService: new (...args: any[]) => Service },
  };
  runInNewContext(
    `(function(exports, require, module) { ${compiled}\n})`,
    {
      URL,
      AbortController,
      Date,
      fetch: async (url: string, init: { signal: AbortSignal }) => {
        requests.push({ url, init });
        signal = init.signal;
        fetchStarted.resolve();
        // A late response can still settle after abort; generation checks must prevent native creation.
        return options.fetchGate
          ? options.fetchGate.promise
          : (options.response ?? styleResponse)();
      },
      setTimeout: (fn: () => void, delay: number) => {
        const timer = setTimeout(fn, delay);
        timers.add(timer);
        return timer;
      },
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
        timers.delete(timer);
        clearTimeout(timer);
      },
    },
    { filename: "MapService.transpiled.test.cjs" },
  )(module.exports, fakeRequire, module);
  const repo = {
    getSetting: async (key: string, fallback: unknown) =>
      key === "mapStyleUrl"
        ? (options.legacyStyleUrl ??
          (options.geometry ? "" : "https://maps.example.test/style.json"))
        : (options.stored ?? fallback),
    setSetting: async (key: string, state: MapState) => {
      assert.equal(key, "offlineMap");
      persisted.push(clone(state));
    },
  };
  const service = new module.exports.MapService(
    repo,
    () =>
      options.location ?? {
        latitude: 47.655,
        longitude: -122.306,
        source: "device",
        capturedAt: Date.now(),
      },
    (state: MapState) => changed.push(clone(state)),
  );
  // Legacy native-pack cases opt in explicitly; default/UI download no longer reads old settings.
  const download = service.download.bind(service);
  service.download = (refresh) =>
    download(
      refresh,
      options.geometry ? undefined : "https://maps.example.test/style.json",
    );
  return {
    service,
    fetchStarted,
    createStarted,
    changed,
    persisted,
    callbacks,
    calls,
    packs,
    files,
    requests,
    complete,
    signal: () => signal,
    cleanup: () => {
      service.dispose();
      for (const timer of timers) clearTimeout(timer);
    },
  };
}

test(
  "cancel during held style fetch aborts HTTP and prevents native pack creation even if a late response resolves",
  { timeout: 5000 },
  async (t) => {
    const fetchGate = deferred<Response>(),
      h = fixture({ fetchGate });
    t.after(h.cleanup);
    const downloading = h.service.download();
    await h.fetchStarted.promise;
    assert.equal(h.changed.at(-1)?.status, "downloading");
    let removed = false;
    const removing = h.service.remove().then(() => {
      removed = true;
    });
    assert.equal(
      h.signal()?.aborted,
      true,
      "remove must signal the in-flight fetch to abort",
    );
    await turn();
    assert.equal(
      removed,
      false,
      "remove waits for unresolved setup rather than allowing a zombie operation",
    );
    fetchGate.resolve(styleResponse());
    await Promise.all([downloading, removing]);
    assert.equal(
      h.callbacks.length,
      0,
      "late style completion must not reach createPack",
    );
    assert.equal(h.packs.size, 0);
    assert.deepEqual(
      h.calls,
      [],
      "no native creation, deletion, or style write follows the canceled fetch",
    );
    assert.deepEqual(h.changed.at(-1), { status: "missing", progress: 0 });
    assert.deepEqual(h.persisted.at(-1), { status: "missing", progress: 0 });
  },
);

test(
  "cancel during held native createPack waits for creation before deleting the resulting pack",
  { timeout: 5000 },
  async (t) => {
    const createGate = deferred<void>(),
      h = fixture({ createGate });
    t.after(h.cleanup);
    const downloading = h.service.download();
    await h.createStarted.promise;
    let removed = false;
    const removing = h.service.remove().then(() => {
      removed = true;
    });
    await turn();
    assert.equal(removed, false);
    assert.deepEqual(
      h.calls,
      ["write:style", "create:start"],
      "deleting before create settles could leave a pack behind",
    );
    h.callbacks[0].progress(null, {
      percentage: 100,
      completedResourceSize: 2048,
    });
    await turn();
    assert.equal(
      h.changed.some((state) => state.status === "ready"),
      false,
      "stale completion cannot report ready while cancellation waits",
    );
    createGate.resolve();
    await Promise.all([downloading, removing]);
    assert.deepEqual(h.calls, [
      "write:style",
      "create:start",
      "create:resolved",
      `delete:${PACK}`,
    ]);
    assert.equal(
      h.packs.size,
      0,
      "the pack created after cancellation must still be removed",
    );
    assert.deepEqual(h.persisted.at(-1), { status: "missing", progress: 0 });
  },
);

test(
  "late progress and error callbacks cannot revive a removed pack or overwrite a subsequent download",
  { timeout: 5000 },
  async (t) => {
    const h = fixture();
    t.after(h.cleanup);
    await h.service.download();
    const stale = h.callbacks[0];
    await h.service.remove();
    const removedStateCount = h.changed.length,
      removedWrites = h.persisted.length;
    stale.progress(null, { percentage: 100, completedResourceSize: 4096 });
    stale.error(null, new Error("Late native error"));
    await turn();
    assert.equal(h.changed.length, removedStateCount);
    assert.equal(
      h.persisted.length,
      removedWrites,
      "stale callbacks must not restore persisted ready/error state",
    );
    assert.equal(h.packs.size, 0);

    await h.service.download();
    assert.equal(
      h.callbacks.length,
      2,
      "cancellation must release the operation so a new download can start",
    );
    const current = h.callbacks[1];
    current.progress(null, { percentage: 35, completedResourceSize: 1024 });
    await turn();
    const writesBeforeStale = h.persisted.length;
    stale.progress(null, { percentage: 100, completedResourceSize: 999999 });
    stale.error(null, new Error("Older generation failed"));
    await turn();
    assert.equal(h.persisted.length, writesBeforeStale);
    assert.equal(h.changed.at(-1)?.status, "downloading");
    assert.equal(h.changed.at(-1)?.progress, 0.35);
    current.progress(null, h.complete);
    await turn();
    assert.equal(
      h.changed.at(-1)?.status,
      "ready",
      "the current operation still accepts genuine progress",
    );
    assert.equal(h.persisted.at(-1)?.bytes, 8192);
  },
);

const geometryResponse = () =>
  new Response(
    JSON.stringify({
      elements: [
        {
          type: "way",
          id: 1,
          tags: { highway: "residential" },
          geometry: [
            { lat: 47.655, lon: -122.306 },
            { lat: 47.656, lon: -122.305 },
          ],
        },
        {
          type: "way",
          id: 2,
          tags: { building: "yes" },
          geometry: [
            { lat: 47.655, lon: -122.306 },
            { lat: 47.655, lon: -122.305 },
            { lat: 47.656, lon: -122.305 },
            { lat: 47.655, lon: -122.306 },
          ],
        },
      ],
    }),
    { status: 200 },
  );

test("default Save area makes one bounded request and persists a self-contained map that restores without HTTP/native pack", async (t) => {
  const h = fixture({ geometry: true, response: geometryResponse });
  t.after(h.cleanup);
  let refreshed = false;
  await h.service.download(async () => {
    refreshed = true;
  });
  assert.equal(refreshed, true);
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.url, "https://overpass.private.coffee/api/interpreter");
  assert.equal(request.init.method, "POST");
  const query = decodeURIComponent(request.init.body.slice(5));
  assert.match(query, /timeout:25/);
  assert.match(query, /maxsize:8388608/);
  assert.equal(
    h.callbacks.length,
    0,
    "default does not ask SDK to download tiles concurrently",
  );
  const saved = h.persisted.at(-1)!;
  assert.equal(saved.status, "ready");
  assert.equal(saved.bundled, false);
  assert.ok(saved.bounds![0] < -122.306 && saved.bounds![2] > -122.306);
  assert.ok(saved.bounds![2] - saved.bounds![0] < 0.03);
  const style = JSON.parse(h.files.get(saved.styleUrl!)!);
  assert.equal(style.sources.campus.data.features.length, 2);
  assert.equal(
    style.sources.campus.attribution,
    "© OpenStreetMap contributors · ODbL",
  );
  assert.equal(style.glyphs, undefined);
  assert.equal(style.sprite, undefined);
  assert.equal(
    Object.values(style.sources).every(
      (source: any) =>
        source.type === "geojson" && typeof source.data === "object",
    ),
    true,
  );
  assert.equal(
    style.layers.some((layer: any) => layer.type === "symbol"),
    false,
    "no hidden font download",
  );
  const restart = fixture({ stored: saved, files: h.files });
  t.after(restart.cleanup);
  await restart.service.initialize();
  assert.equal(restart.changed.at(-1)?.status, "ready");
  assert.equal(restart.requests.length, 0);
  assert.deepEqual(
    restart.calls,
    [],
    "self-contained file is validated without native tile packs",
  );
});

test("manual, stale, missing and invalid fixes never query or save a fabricated area", async (t) => {
  for (const location of [
    { source: "manual", latitude: 47, longitude: -122, capturedAt: Date.now() },
    {
      source: "device",
      latitude: 47,
      longitude: -122,
      capturedAt: Date.now() - 120001,
    },
    {
      source: "device",
      latitude: NaN,
      longitude: -122,
      capturedAt: Date.now(),
    },
    { source: "unavailable" },
  ]) {
    const h = fixture({ geometry: true, location });
    t.after(h.cleanup);
    await assert.rejects(h.service.download(), /current GPS location/);
    assert.equal(h.requests.length, 0);
    assert.equal(h.files.size, 0);
  }
});

test("cancel while GPS refresh is pending prevents a late fix from starting a map download", async (t) => {
  const h = fixture({ geometry: true, response: geometryResponse });
  t.after(h.cleanup);
  const gate = deferred<void>(),
    started = deferred<void>();
  const pending = h.service.download(async () => {
    started.resolve();
    await gate.promise;
  });
  await started.promise;
  const removing = h.service.remove();
  gate.resolve();
  await Promise.all([pending, removing]);
  assert.equal(h.requests.length, 0);
  assert.equal(h.changed.at(-1)?.status, "missing");
});

test("partial or oversized provider responses never become ready", async (t) => {
  for (const response of [
    () =>
      new Response(JSON.stringify({ remark: "runtime timeout", elements: [] })),
    () => new Response("{}", { headers: { "content-length": "8000001" } }),
    () => new Response(JSON.stringify({ elements: [] })),
  ]) {
    const h = fixture({ geometry: true, response });
    t.after(h.cleanup);
    await assert.rejects(h.service.download());
    assert.equal(
      h.changed.some((state) => state.status === "ready"),
      false,
    );
    assert.equal(h.files.size, 0);
  }
});

test("SDK rounded 100 percent is not ready until native Complete and all resources are present", async (t) => {
  const h = fixture();
  t.after(h.cleanup);
  await h.service.download();
  h.callbacks[0].progress(null, {
    ...h.complete,
    state: 2,
    completedResourceCount: 99,
  });
  await turn();
  assert.equal(h.changed.at(-1)?.status, "downloading");
  assert.equal(h.changed.at(-1)?.progress, 0.99);
  h.callbacks[0].progress(null, { ...h.complete, completedResourceCount: 99 });
  await turn();
  assert.equal(h.changed.at(-1)?.status, "downloading");
  h.callbacks[0].progress(null, h.complete);
  await turn();
  assert.equal(h.changed.at(-1)?.status, "ready");
});

test("restart checks real pack completion and missing files rather than trusting persisted ready", async (t) => {
  const stored: MapState = {
    status: "ready",
    progress: 1,
    styleUrl: "file:///test-only/style.json",
    bounds: [-123, 47, -122, 48],
  };
  const files = new Map([[stored.styleUrl!, "{}"]]);
  const h = fixture({
    stored,
    files,
    restorePack: true,
    status: {
      state: 2,
      percentage: 100,
      completedResourceCount: 99,
      requiredResourceCount: 100,
      completedResourceSize: 100,
    },
  });
  t.after(h.cleanup);
  await h.service.initialize();
  assert.equal(h.changed.at(-1)?.status, "error");
  assert.ok(
    h.calls.includes("pause"),
    "interrupted native download does not silently resume network activity",
  );
  const missing = fixture({ stored, restorePack: true });
  t.after(missing.cleanup);
  await missing.service.initialize();
  assert.equal(missing.changed.at(-1)?.status, "error");
});

test("failed refresh retains the previous saved file and it remains restorable offline", async (t) => {
  const saved = fixture({ geometry: true, response: geometryResponse });
  t.after(saved.cleanup);
  await saved.service.download();
  const previous = saved.persisted.at(-1)!;
  const replacement = fixture({
    geometry: true,
    stored: previous,
    files: saved.files,
    response: () => new Response("unavailable", { status: 503 }),
  });
  t.after(replacement.cleanup);
  await replacement.service.initialize();
  await assert.rejects(replacement.service.download(), /provider unavailable/);
  assert.equal(
    replacement.changed.some(
      (state) =>
        state.status === "downloading" &&
        state.savedAvailable === true &&
        state.styleUrl === previous.styleUrl,
    ),
    true,
  );
  assert.equal(replacement.changed.at(-1)?.status, "ready");
  assert.equal(replacement.changed.at(-1)?.styleUrl, previous.styleUrl);
  assert.equal(replacement.files.has(previous.styleUrl!), true);
  const restart = fixture({
    stored: replacement.persisted.at(-1),
    files: replacement.files,
  });
  t.after(restart.cleanup);
  await restart.service.initialize();
  assert.equal(restart.changed.at(-1)?.status, "ready");
  assert.equal(restart.requests.length, 0);
});

test("Cancel save aborts replacement but keeps previous area; explicit remove still deletes it", async (t) => {
  const saved = fixture({ geometry: true, response: geometryResponse });
  t.after(saved.cleanup);
  await saved.service.download();
  const previous = saved.persisted.at(-1)!;
  const gate = deferred<Response>();
  const replacement = fixture({
    geometry: true,
    stored: previous,
    files: saved.files,
    fetchGate: gate,
  });
  t.after(replacement.cleanup);
  await replacement.service.initialize();
  const pending = replacement.service.download();
  await replacement.fetchStarted.promise;
  const canceling = replacement.service.cancel();
  assert.equal(replacement.signal()?.aborted, true);
  gate.resolve(geometryResponse());
  await Promise.all([pending, canceling]);
  assert.equal(replacement.changed.at(-1)?.styleUrl, previous.styleUrl);
  assert.equal(replacement.changed.at(-1)?.status, "ready");
  assert.equal(
    replacement.files.size,
    1,
    "late response did not create or replace files",
  );
  await replacement.service.remove();
  assert.equal(replacement.files.size, 0);
  assert.equal(replacement.changed.at(-1)?.status, "missing");
});

test("restart after interrupted first save restores bundled ready state instead of a permanent spinner", async (t) => {
  const h = fixture({
    stored: {
      status: "downloading",
      progress: 0,
      bundled: true,
      name: "Your area",
      bounds: [-122.313, 47.65, -122.299, 47.66],
    },
  });
  t.after(h.cleanup);
  await h.service.initialize();
  assert.equal(h.changed.at(-1)?.status, "ready");
  assert.equal(h.changed.at(-1)?.bundled, true);
  assert.equal(h.persisted.at(-1)?.status, "ready");
  assert.equal(h.requests.length, 0);
});

test("Save my area ignores an inaccessible legacy custom-map setting", async (t) => {
  const h = fixture({
    geometry: true,
    legacyStyleUrl: "https://tiles.openfreemap.org/styles/positron",
    response: geometryResponse,
  });
  t.after(h.cleanup);
  await h.service.download();
  assert.equal(h.requests.length, 1);
  assert.equal(
    h.requests[0].url,
    "https://overpass.private.coffee/api/interpreter",
  );
  assert.match(
    h.requests[0].init.headers["User-Agent"],
    /https:\/\/github\.com\/jayGatsby988\/beacon/,
  );
  assert.equal(h.callbacks.length, 0);
  assert.equal(h.changed.at(-1)?.status, "ready");
});
