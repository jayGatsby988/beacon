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
const endpoint = (request: { url: string }) => {
  const url = new URL(request.url);
  return url.origin + url.pathname;
};
const requestQuery = (request: { url: string; init: any }) =>
  new URL(request.url).searchParams.get("data") ??
  new URLSearchParams(request.init.body).get("data") ??
  "";
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
type SavedMap = MapState & { styleFile?: string; format?: "geometry" };
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

test("bundled map refreshes legacy coverage metadata from the expanded offline asset without HTTP", async (t) => {
  const h = fixture({
    stored: {
      status: "ready",
      progress: 1,
      bundled: true,
      bounds: [-122.313, 47.65, -122.299, 47.66],
      updatedAt: Date.parse("2026-10-17T20:02:22-07:00"),
    },
  });
  t.after(h.cleanup);
  await h.service.initialize();
  const restored = h.changed.at(-1)!;
  assert.deepEqual(restored.bounds, campus.metadata.coverageBounds);
  assert.equal(restored.updatedAt, Date.parse(campus.metadata.retrievedAt));
  assert.equal(restored.bundled, true);
  assert.equal(restored.status, "ready");
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.persisted.at(-1)?.bounds, campus.metadata.coverageBounds);
  for (const feature of campus.features) {
    const positions =
      feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates.flat()
        : feature.geometry.coordinates;
    for (const [longitude, latitude] of positions) {
      assert.ok(longitude >= campus.bbox[0] && longitude <= campus.bbox[2]);
      assert.ok(latitude >= campus.bbox[1] && latitude <= campus.bbox[3]);
    }
  }
  // Public northern-campus point formerly outside the shipped coverage rectangle.
  assert.ok(restored.bounds![1] < 47.663 && restored.bounds![3] > 47.663);
});

function fixture(
  options: {
    fetchGate?: ReturnType<typeof deferred<Response>>;
    createGate?: ReturnType<typeof deferred<void>>;
    geometry?: boolean;
    legacyStyleUrl?: string;
    response?: () => Response;
    location?: unknown;
    stored?: SavedMap;
    documentDirectory?: string;
    files?: Map<string, string>;
    status?: Progress;
    restorePack?: boolean;
  } = {},
) {
  const fetchStarted = deferred<void>(),
    createStarted = deferred<void>();
  const changed: SavedMap[] = [],
    persisted: SavedMap[] = [],
    callbacks: Callbacks[] = [];
  const calls: string[] = [],
    packs = new Set<string>(options.restorePack ? [PACK] : []);
  const files = options.files ?? new Map<string, string>();
  const documentDirectory = options.documentDirectory ?? "file:///test-only/";
  const fileReads: string[] = [];
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
        documentDirectory,
        writeAsStringAsync: async (path: string, text: string) => {
          calls.push("write:style");
          files.set(path, text);
        },
        getInfoAsync: async (path: string) => {
          fileReads.push(path);
          return {
            exists: files.has(path),
            size: files.get(path)?.length ?? 0,
          };
        },
        readAsStringAsync: async (path: string) => {
          if (!files.has(path)) throw new Error("missing");
          return files.get(path);
        },
        readDirectoryAsync: async () =>
          [...files.keys()].map((path) => path.replace(documentDirectory, "")),
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
    documentDirectory,
    fileReads,
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
  assert.equal(
    endpoint(request),
    "https://overpass.private.coffee/api/interpreter",
  );
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.body, undefined);
  assert.match(request.url, /\?data=%5Bout%3Ajson%5D/);
  assert.match(
    request.url,
    /%28park%7Cgarden%7Cpitch%29/,
    "query syntax is fully percent-encoded",
  );
  const query = requestQuery(request);
  assert.match(query, /timeout:25/);
  assert.match(query, /maxsize:67108864/);
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
  assert.equal(
    saved.styleUrl,
    undefined,
    "absolute container paths are never persisted",
  );
  assert.match(saved.styleFile!, /^beacon-area-\d+-\d+\.json$/);
  const style = JSON.parse(h.files.get(h.changed.at(-1)!.styleUrl!)!);
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
    styleUrl: "file:///test-only/beacon-map-style.json",
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
  const previous = saved.changed.at(-1)!;
  const replacement = fixture({
    geometry: true,
    stored: previous,
    files: saved.files,
    response: () => new Response("unavailable", { status: 503 }),
  });
  t.after(replacement.cleanup);
  await replacement.service.initialize();
  await assert.rejects(
    replacement.service.download(),
    /provider unavailable \(HTTP 503\)/,
  );
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
  const previous = saved.changed.at(-1)!;
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
    endpoint(h.requests[0]),
    "https://overpass.private.coffee/api/interpreter",
  );
  assert.match(
    h.requests[0].init.headers["User-Agent"],
    /https:\/\/github\.com\/jayGatsby988\/beacon/,
  );
  assert.equal(h.callbacks.length, 0);
  assert.equal(h.changed.at(-1)?.status, "ready");
});

test("portable saved metadata and legacy absolute paths restore from a relocated iOS Documents directory without HTTP", async (t) => {
  const original = fixture({
    geometry: true,
    response: geometryResponse,
    documentDirectory: "file:///old-container/Documents/",
  });
  t.after(original.cleanup);
  await original.service.download();
  const portable = original.persisted.at(-1)!;
  const legacy = { ...original.changed.at(-1)!, styleFile: undefined };
  assert.equal(portable.styleUrl, undefined);
  const newDirectory = "file:///new-container/Documents/";
  const moved = new Map([
    [
      newDirectory + portable.styleFile!,
      original.files.get(original.changed.at(-1)!.styleUrl!)!,
    ],
  ]);
  for (const stored of [portable, legacy]) {
    const restart = fixture({
      stored,
      files: moved,
      documentDirectory: newDirectory,
    });
    t.after(restart.cleanup);
    await restart.service.initialize();
    assert.equal(restart.changed.at(-1)?.status, "ready");
    assert.equal(
      restart.changed.at(-1)?.styleUrl,
      newDirectory + portable.styleFile,
    );
    assert.equal(restart.persisted.at(-1)?.styleFile, portable.styleFile);
    assert.equal(restart.persisted.at(-1)?.styleUrl, undefined);
    assert.ok(
      restart.fileReads.every((path) => path.startsWith(newDirectory)),
      "never tries the stale container path",
    );
    assert.equal(restart.requests.length, 0);
  }
});

test("missing file retains its portable reference so a later restart can recover it", async (t) => {
  const original = fixture({ geometry: true, response: geometryResponse });
  t.after(original.cleanup);
  await original.service.download();
  const stored = original.persisted.at(-1)!;
  const missing = fixture({ stored });
  t.after(missing.cleanup);
  await missing.service.initialize();
  assert.equal(missing.changed.at(-1)?.status, "error");
  assert.equal(missing.persisted.at(-1)?.styleFile, stored.styleFile);
  assert.deepEqual(missing.persisted.at(-1)?.bounds, stored.bounds);
  assert.equal(missing.persisted.at(-1)?.format, "geometry");
  const recovered = fixture({
    stored: missing.persisted.at(-1),
    files: original.files,
  });
  t.after(recovered.cleanup);
  await recovered.service.initialize();
  assert.equal(recovered.changed.at(-1)?.status, "ready");
  assert.equal(recovered.requests.length, 0);
});

test("old initialization error that erased all metadata recovers a validated owned geometry file", async (t) => {
  const original = fixture({ geometry: true, response: geometryResponse });
  t.after(original.cleanup);
  await original.service.download();
  const damaged = fixture({
    stored: {
      status: "error",
      progress: 0,
      error: "Saved map files are missing.",
    },
    files: original.files,
  });
  t.after(damaged.cleanup);
  await damaged.service.initialize();
  assert.equal(damaged.changed.at(-1)?.status, "ready");
  assert.equal(
    damaged.changed.at(-1)?.styleUrl,
    original.changed.at(-1)?.styleUrl,
  );
  assert.deepEqual(
    damaged.changed.at(-1)?.bounds,
    original.changed.at(-1)?.bounds,
  );
  assert.equal(
    damaged.persisted.at(-1)?.styleFile,
    original.persisted.at(-1)?.styleFile,
  );
  assert.equal(damaged.requests.length, 0);
});

test("restoration rejects traversal and unrelated filenames without reading arbitrary paths", async (t) => {
  for (const path of [
    "../beacon-area-1-1.json",
    "file:///old-container/Documents/secret.json",
    "https://example.test/beacon-area-1-1.json",
  ]) {
    const h = fixture({
      stored: {
        status: "ready",
        progress: 1,
        format: "geometry",
        styleFile: path,
        styleUrl: path,
        bounds: [-123, 47, -122, 48],
      },
    });
    t.after(h.cleanup);
    await h.service.initialize();
    assert.equal(h.changed.at(-1)?.status, "error");
    assert.equal(h.fileReads.length, 0);
    assert.equal(h.persisted.at(-1)?.styleUrl, undefined);
    assert.equal(h.persisted.at(-1)?.styleFile, undefined);
  }
});

test("orphan recovery is bounded and refuses styles with remote resources or invalid coordinates", async (t) => {
  const original = fixture({ geometry: true, response: geometryResponse });
  t.after(original.cleanup);
  await original.service.download();
  const valid = original.files.get(original.changed.at(-1)!.styleUrl!)!;
  const directory = "file:///test-only/";
  const files = new Map<string, string>();
  for (let i = 6; i > 1; i--) {
    const bad = JSON.parse(valid);
    if (i % 2)
      bad.glyphs = "https://example.test/fonts/{fontstack}/{range}.pbf";
    else bad.sources.campus.data.features[0].geometry.coordinates[0][0] = 999;
    files.set(`${directory}beacon-area-${i}-1.json`, JSON.stringify(bad));
  }
  files.set(`${directory}beacon-area-1-1.json`, valid);
  const h = fixture({ stored: { status: "error", progress: 0 }, files });
  t.after(h.cleanup);
  await h.service.initialize();
  assert.equal(h.changed.at(-1)?.status, "error");
  assert.equal(
    h.fileReads.length,
    5,
    "at most five app-owned files are inspected",
  );
  assert.equal(h.fileReads.includes(`${directory}beacon-area-1-1.json`), false);
  assert.equal(h.requests.length, 0);
});

test("cancelled replacement leaves portable saved metadata restorable after a subsequent container move", async (t) => {
  const original = fixture({ geometry: true, response: geometryResponse });
  t.after(original.cleanup);
  await original.service.download();
  const gate = deferred<Response>();
  const active = fixture({
    geometry: true,
    stored: original.persisted.at(-1),
    files: original.files,
    fetchGate: gate,
  });
  t.after(active.cleanup);
  await active.service.initialize();
  const downloading = active.service.download();
  await active.fetchStarted.promise;
  const canceling = active.service.cancel();
  gate.resolve(geometryResponse());
  await Promise.all([downloading, canceling]);
  const stored = active.persisted.at(-1)!;
  assert.equal(stored.styleUrl, undefined);
  assert.equal(stored.styleFile, original.persisted.at(-1)?.styleFile);
  const nextDirectory = "file:///another-container/Documents/";
  const moved = new Map([
    [
      nextDirectory + stored.styleFile!,
      original.files.get(original.changed.at(-1)!.styleUrl!)!,
    ],
  ]);
  const restart = fixture({
    stored,
    files: moved,
    documentDirectory: nextDirectory,
  });
  t.after(restart.cleanup);
  await restart.service.initialize();
  assert.equal(restart.changed.at(-1)?.status, "ready");
  assert.equal(
    restart.changed.at(-1)?.styleUrl,
    nextDirectory + stored.styleFile,
  );
});

test("temporary provider failure uses one documented fallback and keeps client size cap independent of query RAM", async (t) => {
  let requests = 0;
  const h = fixture({
    geometry: true,
    response: () =>
      ++requests === 1
        ? new Response("busy", { status: 500 })
        : geometryResponse(),
  });
  t.after(h.cleanup);
  await h.service.download();
  assert.deepEqual(h.requests.map(endpoint), [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ]);
  assert.equal(h.changed.at(-1)?.status, "ready");
  assert.equal(h.requests[0].init.method, "GET");
  assert.equal(h.requests[1].init.method, "POST");
  assert.equal(requestQuery(h.requests[0]), requestQuery(h.requests[1]));
  assert.ok(
    h.requests.every((request) =>
      requestQuery(request).includes("[maxsize:67108864]"),
    ),
  );
  const oversized = fixture({
    geometry: true,
    response: () =>
      new Response("{}", { headers: { "content-length": "8000001" } }),
  });
  t.after(oversized.cleanup);
  await assert.rejects(oversized.service.download(), /too much map detail/);
  assert.equal(
    oversized.requests.length,
    1,
    "oversized data is not retried against another provider",
  );
});

test("both providers failing never attempts a third request and retains the final HTTP status", async (t) => {
  let requests = 0;
  const h = fixture({
    geometry: true,
    response: () =>
      new Response("busy", { status: ++requests === 1 ? 500 : 502 }),
  });
  t.after(h.cleanup);
  await assert.rejects(h.service.download(), /HTTP 502/);
  assert.equal(h.requests.length, 2);
  assert.equal(h.changed.at(-1)?.status, "error");
  assert.match(h.changed.at(-1)?.error ?? "", /HTTP 502/);
  assert.equal(h.files.size, 0);
});

test("cancelled provider failure cannot start a fallback request or replace the saved map", async (t) => {
  const original = fixture({ geometry: true, response: geometryResponse });
  t.after(original.cleanup);
  await original.service.download();
  const gate = deferred<Response>();
  const active = fixture({
    geometry: true,
    stored: original.persisted.at(-1),
    files: original.files,
    fetchGate: gate,
  });
  t.after(active.cleanup);
  await active.service.initialize();
  const saving = active.service.download();
  await active.fetchStarted.promise;
  const canceling = active.service.cancel();
  gate.resolve(new Response("busy", { status: 500 }));
  await Promise.all([saving, canceling]);
  assert.equal(active.requests.length, 1);
  assert.equal(active.changed.at(-1)?.status, "ready");
  assert.equal(
    active.persisted.at(-1)?.styleFile,
    original.persisted.at(-1)?.styleFile,
  );
});

test("permanent HTTP rejection and partial provider results do not trigger fallback", async (t) => {
  for (const response of [
    () => new Response("invalid", { status: 400 }),
    () =>
      new Response(
        JSON.stringify({
          elements: [],
          remark: "runtime error: out of memory",
        }),
      ),
  ]) {
    const h = fixture({ geometry: true, response });
    t.after(h.cleanup);
    await assert.rejects(h.service.download());
    assert.equal(h.requests.length, 1);
    assert.equal(h.files.size, 0);
  }
});

test("failure context retains both HTTP statuses and only allowlisted network error names", async (t) => {
  let httpAttempt = 0;
  const h = fixture({
    geometry: true,
    response: () =>
      new Response("private upstream content", {
        status: ++httpAttempt === 1 ? 500 : 502,
      }),
  });
  t.after(h.cleanup);
  await assert.rejects(
    h.service.download(),
    /Attempts 1: HTTP 500; 2: HTTP 502/,
  );
  assert.doesNotMatch(
    h.changed.at(-1)?.error ?? "",
    /private upstream content/,
  );
  let mixedAttempt = 0;
  const mixed = fixture({
    geometry: true,
    response: () => {
      if (++mixedAttempt === 1)
        throw new TypeError("sensitive URL and coordinates must not appear");
      return new Response("unavailable", { status: 503 });
    },
  });
  t.after(mixed.cleanup);
  await assert.rejects(
    mixed.service.download(),
    /Attempts 1: network TypeError; 2: HTTP 503/,
  );
  assert.doesNotMatch(
    mixed.changed.at(-1)?.error ?? "",
    /sensitive|coordinates/,
  );
});
