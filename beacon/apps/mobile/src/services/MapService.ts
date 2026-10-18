import MapLibre from "@maplibre/maplibre-react-native";
import * as FileSystem from "expo-file-system/legacy";
import type { Repository } from "../storage/Repository";
import type { LocationReport, MapState } from "../ui/types";
import campus from "../../assets/maps/uw-campus.json";
import { CAMPUS_BOUNDS, campusStyle } from "../components/campusMapStyle";

export { CAMPUS_BOUNDS } from "../components/campusMapStyle";
export const CAMPUS_MAP: MapState = {
  status: "ready",
  progress: 1,
  name: "UW campus · bundled geometry",
  bytes: JSON.stringify(campus).length,
  updatedAt: Date.parse(campus.metadata.retrievedAt),
  bundled: true,
  bounds: CAMPUS_BOUNDS,
};
const PACK = "beacon-local-region";
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
] as const;
// Overpass working RAM is independent of the response/file limit below.
const QUERY_MEMORY_BYTES = 64 * 1024 * 1024;
class MapFetchError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly diagnostic = "response rejected",
  ) {
    super(message);
  }
}
const MAX_BYTES = 8_000_000;
type SavedMap = MapState & { format?: "geometry"; styleFile?: string };
const GEOMETRY_FILE = /^beacon-area-\d+-\d+\.json$/;
function ownedFilename(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  // Legacy file URLs are migrated by basename, never by trusting a persisted container path.
  let filename = value;
  if (value.startsWith("file://")) {
    try {
      filename = new URL(value).pathname.split("/").pop() ?? "";
    } catch {
      return;
    }
  }
  if (GEOMETRY_FILE.test(filename) || filename === "beacon-map-style.json")
    return filename;
}
function validBounds(
  value: unknown,
): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(Number.isFinite) &&
    value[0] >= -180 &&
    value[2] <= 180 &&
    value[1] >= -85 &&
    value[3] <= 85 &&
    value[0] < value[2] &&
    value[1] < value[3]
  );
}
function validGeometryFeatures(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20_000)
    return false;
  let points = 0;
  const line = (coordinates: unknown, closed: boolean): boolean => {
    if (!Array.isArray(coordinates) || coordinates.length < (closed ? 4 : 2))
      return false;
    points += coordinates.length;
    if (
      points > 100_000 ||
      !coordinates.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          p.every(Number.isFinite) &&
          Math.abs(p[0]) <= 180 &&
          Math.abs(p[1]) <= 90,
      )
    )
      return false;
    return (
      !closed ||
      (coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
        coordinates[0][1] === coordinates[coordinates.length - 1][1])
    );
  };
  return value.every((feature) => {
    if (feature?.type !== "Feature") return false;
    const geometry = feature.geometry;
    if (geometry?.type === "LineString")
      return line(geometry.coordinates, false);
    return (
      geometry?.type === "Polygon" &&
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length > 0 &&
      geometry.coordinates.every((ring: unknown) => line(ring, true))
    );
  });
}
type PackStatus = {
  state: number;
  percentage: number;
  completedResourceCount: number;
  requiredResourceCount: number;
  completedResourceSize: number;
};
function complete(status: PackStatus) {
  // iOS rounds the percentage UP: 99.1% can report 100 while resources are missing.
  return (
    status.state === MapLibre.OfflinePackDownloadState.Complete &&
    status.completedResourceCount > 0 &&
    status.requiredResourceCount > 0 &&
    status.completedResourceCount >= status.requiredResourceCount
  );
}
function progress(status: PackStatus) {
  return complete(status)
    ? 1
    : Math.max(0, Math.min(0.99, (status.percentage || 0) / 100));
}
function areaBounds(loc: LocationReport): [number, number, number, number] {
  const now = Date.now();
  if (
    loc.source !== "device" ||
    !Number.isFinite(loc.latitude) ||
    !Number.isFinite(loc.longitude) ||
    Math.abs(loc.latitude!) > 85 ||
    Math.abs(loc.longitude!) > 180 ||
    !Number.isFinite(loc.capturedAt) ||
    now - loc.capturedAt! >= 120_000 ||
    loc.capturedAt! > now + 5000
  )
    throw new Error(
      "Get a current GPS location before saving your area. Allow location in phone Settings if needed.",
    );
  const latitude = loc.latitude!,
    longitude = loc.longitude!;
  const span = 0.009 / Math.cos((latitude * Math.PI) / 180);
  return [
    Math.max(-180, longitude - span),
    Math.max(-85, latitude - 0.009),
    Math.min(180, longitude + span),
    Math.min(85, latitude + 0.009),
  ];
}
export function createOfflineAreaStyle(payload: unknown, bounds: number[]) {
  const data = payload as {
    elements?: {
      type?: string;
      id?: number;
      tags?: Record<string, string>;
      geometry?: { lat: number; lon: number }[];
    }[];
    remark?: string;
  };
  if (
    !data ||
    !Array.isArray(data.elements) ||
    data.remark ||
    data.elements.length > 20_000
  )
    throw new Error(
      "The map provider could not finish this area. Try again later.",
    );
  let points = 0;
  const features = [];
  for (const way of data.elements) {
    if (way.type !== "way" || !way.tags || !Array.isArray(way.geometry))
      continue;
    points += way.geometry.length;
    if (points > 100_000)
      throw new Error("This area has too much map detail to save.");
    const coordinates = way.geometry.map((p) => {
      if (
        !p ||
        !Number.isFinite(p.lon) ||
        !Number.isFinite(p.lat) ||
        Math.abs(p.lon) > 180 ||
        Math.abs(p.lat) > 90
      )
        throw new Error("The map provider returned invalid coordinates.");
      return [p.lon, p.lat];
    });
    if (coordinates.length < 2) continue;
    const tags = way.tags;
    const kind = tags.highway
      ? "road"
      : tags.building
        ? "building"
        : tags.natural === "water"
          ? "water"
          : "park";
    const first = coordinates[0],
      last = coordinates[coordinates.length - 1];
    const polygon =
      kind !== "road" &&
      coordinates.length >= 4 &&
      first[0] === last[0] &&
      first[1] === last[1];
    if (kind !== "road" && !polygon) continue;
    features.push({
      type: "Feature",
      properties: { kind },
      geometry: {
        type: polygon ? "Polygon" : "LineString",
        coordinates: polygon ? [coordinates] : coordinates,
      },
    });
  }
  if (!features.length)
    throw new Error(
      "No roads or buildings were returned for this area. The bundled map is still available.",
    );
  return {
    ...campusStyle,
    metadata: { beaconFormat: "geometry", bounds, savedAt: Date.now() },
    sources: {
      campus: {
        ...campusStyle.sources.campus,
        data: { type: "FeatureCollection", features },
      },
    },
  };
}
export class MapService {
  private state: SavedMap = { status: "missing", progress: 0 };
  private operation = false;
  private generation = 0;
  private disposed = false;
  private setup?: Promise<void>;
  private controller?: AbortController;
  private lastAreaRequest = 0;
  private writes: Promise<void> = Promise.resolve();
  private previousMap?: SavedMap;
  private previousIntact = true;
  private createdPack = false;
  private cleanup?: Promise<void>;
  constructor(
    private repo: Repository,
    private location: () => LocationReport,
    private changed: (state: MapState) => void,
  ) {}
  private async set(state: SavedMap) {
    if (this.disposed) return;
    const styleFile =
      ownedFilename(state.styleFile) ?? ownedFilename(state.styleUrl);
    this.state = { ...state, styleFile };
    this.changed(this.state);
    // Persist a portable filename: iOS can relocate Documents during an app update.
    const persisted = { ...this.state, styleUrl: undefined };
    // Preserve callback order even if storage writes settle out of order.
    const generation = this.generation;
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        if (!this.disposed && generation === this.generation)
          await this.repo.setSetting("offlineMap", persisted);
      });
    await this.writes;
  }
  async initialize() {
    const generation = this.generation;
    const current = () => !this.disposed && generation === this.generation;
    const stored = await this.repo.getSetting<SavedMap>(
      "offlineMap",
      CAMPUS_MAP,
    );
    if (!current()) return;
    if (stored.bundled) {
      // A save interrupted before any local file was committed still has the bundled map.
      await this.set(CAMPUS_MAP);
      return;
    }
    if (stored.status === "missing") {
      this.state = stored;
      this.changed(stored);
      return;
    }
    const styleFile =
      ownedFilename(stored.styleFile) ?? ownedFilename(stored.styleUrl);
    const local =
      styleFile && FileSystem.documentDirectory
        ? FileSystem.documentDirectory + styleFile
        : undefined;
    const restored = { ...stored, styleFile, styleUrl: local };
    const info = local
      ? await FileSystem.getInfoAsync(local).catch(() => undefined)
      : undefined;
    if (!current()) return;
    if (styleFile && GEOMETRY_FILE.test(styleFile)) {
      const geometry = await this.readGeometry(styleFile);
      if (!current()) return;
      if (geometry) {
        await this.set(geometry);
        return;
      }
    }
    if (
      !info?.exists ||
      !validBounds(stored.bounds) ||
      stored.format === "geometry"
    ) {
      // Older versions erased the filename on a missing-path error. Recover only a bounded
      // number of app-owned, validated, self-contained geometry files; never fetch a map here.
      const recovered = await this.recoverGeometry(current, styleFile);
      if (!current()) return;
      await this.set(
        recovered ?? {
          ...restored,
          status: "error",
          progress: 0,
          savedAvailable: undefined,
          error:
            "Saved map files are missing or unreadable. Save your area again when online.",
        },
      );
      return;
    }
    const pack = (await MapLibre.offlineManager.getPacks()).find(
      (p) => p.name === PACK,
    );
    if (!current()) return;
    if (!pack) {
      await this.set({ status: "missing", progress: 0 });
      return;
    }
    const status = await pack.status();
    if (!current()) return;
    if (!complete(status)) await pack.pause();
    if (!current()) return;
    await this.set({
      ...restored,
      status: complete(status) ? "ready" : "error",
      progress: progress(status),
      bytes: status.completedResourceSize,
      error: complete(status)
        ? undefined
        : "Download was interrupted. Save the map again when online.",
    });
  }
  private async readGeometry(styleFile: string): Promise<SavedMap | undefined> {
    if (!FileSystem.documentDirectory || !GEOMETRY_FILE.test(styleFile)) return;
    const local = FileSystem.documentDirectory + styleFile;
    try {
      const info = await FileSystem.getInfoAsync(local);
      if (
        !info.exists ||
        info.isDirectory ||
        info.size <= 0 ||
        info.size > MAX_BYTES
      )
        return;
      const text = await FileSystem.readAsStringAsync(local);
      if (text.length > MAX_BYTES) return;
      const style = JSON.parse(text);
      const source = style.sources?.campus;
      // Recovered files must be self-contained. Do not resurrect external tile/font downloads.
      if (
        style.version !== 8 ||
        style.metadata?.beaconFormat !== "geometry" ||
        !validBounds(style.metadata.bounds) ||
        !Number.isFinite(style.metadata.savedAt) ||
        style.glyphs ||
        style.sprite ||
        !style.sources ||
        Object.keys(style.sources).length !== 1 ||
        source?.type !== "geojson" ||
        source.data?.type !== "FeatureCollection" ||
        !validGeometryFeatures(source.data.features) ||
        source.url ||
        source.tiles ||
        !Array.isArray(style.layers) ||
        style.layers.length === 0 ||
        style.layers.length > 20 ||
        !style.layers.every(
          (layer: { type?: string; source?: string }) =>
            layer.type === "background" ||
            ((layer.type === "fill" || layer.type === "line") &&
              layer.source === "campus"),
        )
      )
        return;
      return {
        status: "ready",
        progress: 1,
        format: "geometry",
        styleFile,
        styleUrl: local,
        name: "Saved roads & buildings",
        bounds: style.metadata.bounds,
        bundled: false,
        bytes: info.size,
        updatedAt: style.metadata.savedAt,
      };
    } catch {
      return;
    }
  }
  private async recoverGeometry(
    current: () => boolean,
    alreadyChecked?: string,
  ): Promise<SavedMap | undefined> {
    if (!FileSystem.documentDirectory) return;
    const files = await FileSystem.readDirectoryAsync(
      FileSystem.documentDirectory,
    ).catch(() => [] as string[]);
    if (!current()) return;
    const candidates = files
      .filter((file) => GEOMETRY_FILE.test(file) && file !== alreadyChecked)
      .sort((a, b) => Number(b.split("-")[2]) - Number(a.split("-")[2]))
      .slice(0, 5);
    for (const file of candidates) {
      if (!current()) return;
      const recovered = await this.readGeometry(file);
      if (recovered && current()) return recovered;
    }
  }
  download(
    refreshLocation?: () => Promise<void>,
    customStyleUrl = "",
  ): Promise<void> {
    if (this.cleanup) return this.cleanup;
    return (this.setup ??= this.performDownload(
      refreshLocation,
      customStyleUrl,
    ).finally(() => {
      this.setup = undefined;
    }));
  }
  private async performDownload(
    refreshLocation?: () => Promise<void>,
    styleUrl = "",
  ) {
    if (this.operation || this.disposed) return;
    this.operation = true;
    const generation = ++this.generation;
    const previous = this.state.status === "ready" ? this.state : undefined;
    this.previousMap = previous;
    this.previousIntact = true;
    this.createdPack = false;
    try {
      await this.set({
        ...previous,
        status: "downloading",
        progress: 0,
        name: "Your area",
        savedAvailable: !!previous?.styleUrl && !previous.bundled,
        error: undefined,
      });
      await refreshLocation?.();
      if (generation !== this.generation || this.disposed) return;
      const bounds = areaBounds(this.location());
      // Save my area always uses self-contained geometry. Legacy custom packs require an explicit caller.
      if (!styleUrl) {
        await this.downloadGeometry(bounds, generation);
        this.operation = false;
        return;
      }
      const url = new URL(styleUrl);
      if (
        url.hostname === "openfreemap.org" ||
        url.hostname.endsWith(".openfreemap.org")
      )
        throw new Error(
          "Clear the custom map URL to save an offline area. This provider's download limits are not supported by this SDK.",
        );
      if (url.protocol !== "https:")
        throw new Error("Use an HTTPS map style URL.");
      await this.set({
        status: "downloading",
        progress: 0,
        name: "Local region",
      });
      const controller = new AbortController();
      this.controller = controller;
      const timer = setTimeout(() => controller.abort(), 15_000);
      let style: Record<string, any>;
      try {
        const response = await fetch(styleUrl, {
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok) throw new Error("Map style could not be downloaded.");
        const text = await response.text();
        if (text.length > 1_000_000) throw new Error("Map style is too large.");
        style = JSON.parse(text);
      } finally {
        clearTimeout(timer);
        if (this.controller === controller) this.controller = undefined;
      }
      if (generation !== this.generation || this.disposed) return;
      if (
        style.version !== 8 ||
        !Array.isArray(style.layers) ||
        !style.sources ||
        typeof style.sources !== "object"
      )
        throw new Error("The provider did not return a MapLibre style.");
      const resolve = (value: string) => {
        const u = new URL(value, styleUrl);
        if (u.protocol !== "https:")
          throw new Error("All map resources must use HTTPS.");
        return u.toString();
      };
      for (const source of Object.values(style.sources) as Record<
        string,
        any
      >[]) {
        if (source.url) source.url = resolve(source.url);
        if (source.tiles) source.tiles = source.tiles.map(resolve);
        if (typeof source.data === "string") source.data = resolve(source.data);
      }
      if (style.glyphs) style.glyphs = resolve(style.glyphs);
      if (typeof style.sprite === "string")
        style.sprite = resolve(style.sprite);
      if (!FileSystem.documentDirectory)
        throw new Error("Map storage unavailable.");
      const local = FileSystem.documentDirectory + "beacon-map-style.json";
      if (previous?.styleUrl === local) {
        this.previousIntact = false;
        await this.set({ ...this.state, savedAvailable: false });
      }
      await FileSystem.writeAsStringAsync(local, JSON.stringify(style));
      if (generation !== this.generation || this.disposed) return;
      const old = (await MapLibre.offlineManager.getPacks()).find(
        (p) => p.name === PACK,
      );
      if (old) {
        if (previous?.format !== "geometry") this.previousIntact = false;
        await MapLibre.offlineManager.deletePack(PACK);
      }
      if (generation !== this.generation || this.disposed) return;
      this.createdPack = true;
      await MapLibre.offlineManager.createPack(
        {
          name: PACK,
          styleURL: local,
          minZoom: 12,
          maxZoom: 16,
          bounds: [
            [bounds[2], bounds[3]],
            [bounds[0], bounds[1]],
          ],
        },
        (_pack, status) => {
          if (generation !== this.generation || this.disposed) return;
          if (complete(status)) this.operation = false;
          void this.set({
            status: complete(status) ? "ready" : "downloading",
            progress: progress(status),
            name: "Downloaded local region",
            bytes: status.completedResourceSize,
            updatedAt: Date.now(),
            styleUrl: local,
            bounds,
            bundled: false,
          }).catch(() =>
            this.changed({
              ...this.state,
              status: "error",
              error: "Could not save map status.",
            }),
          );
        },
        (_pack, error) => {
          if (generation !== this.generation || this.disposed) return;
          this.operation = false;
          void this.set({
            ...(previous && this.previousIntact ? previous : this.state),
            status: previous && this.previousIntact ? "ready" : "error",
            error: error.message,
          }).catch(() =>
            this.changed({
              ...this.state,
              status: "error",
              error: "Could not save map error status.",
            }),
          );
        },
      );
    } catch (e) {
      if (generation !== this.generation || this.disposed) return;
      this.operation = false;
      await this.set({
        ...(previous && this.previousIntact ? previous : this.state),
        status: previous && this.previousIntact ? "ready" : "error",
        error: e instanceof Error ? e.message : "Map download failed.",
      });
      throw e;
    }
  }
  private async downloadGeometry(
    bounds: [number, number, number, number],
    generation: number,
  ) {
    if (!FileSystem.documentDirectory)
      throw new Error("Map storage unavailable.");
    if (Date.now() - this.lastAreaRequest < 60_000)
      throw new Error("Wait a minute before saving another area.");
    this.lastAreaRequest = Date.now();
    const current = () => !this.disposed && generation === this.generation;
    const box = [bounds[1], bounds[0], bounds[3], bounds[2]]
      .map((n) => n.toFixed(6))
      .join(",");
    const query = `[out:json][timeout:25][maxsize:${QUERY_MEMORY_BYTES}];(way[highway](${box});way[building](${box});way[leisure~"^(park|garden|pitch)$"](${box});way[natural=water](${box}););out geom;`;
    const text = await this.requestGeometry(query, current);
    if (!current() || text === undefined) return;
    const style = JSON.stringify(
      createOfflineAreaStyle(JSON.parse(text), bounds),
    );
    if (style.length > MAX_BYTES)
      throw new Error("This area has too much map detail to save.");
    const local = `${FileSystem.documentDirectory}beacon-area-${Date.now()}-${generation}.json`;
    await FileSystem.writeAsStringAsync(local, style);
    if (!current()) {
      await FileSystem.deleteAsync(local, { idempotent: true });
      return;
    }
    this.operation = false;
    await this.set({
      status: "ready",
      progress: 1,
      name: "Saved roads & buildings",
      format: "geometry",
      styleUrl: local,
      bounds,
      bundled: false,
      bytes: style.length,
      updatedAt: Date.now(),
    });
    // Only discard previous files after the new self-contained style and metadata are durable.
    if (current()) await this.clearGeometryFiles(local).catch(() => {});
  }
  private async requestGeometry(
    query: string,
    current: () => boolean,
  ): Promise<string | undefined> {
    // At most one attempt per documented provider, and only while this explicit save is current.
    // Bad/oversized/partial map data never triggers an automatic retry or becomes ready.
    const failures: string[] = [];
    for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
      if (!current()) return;
      const controller = new AbortController();
      this.controller = controller;
      let rejectStopped!: (reason: Error) => void;
      const stopped = new Promise<never>((_resolve, reject) => {
        rejectStopped = reject;
      });
      const onAbort = () => rejectStopped(new MapFetchError(
        "Map download was stopped.",
        false,
        "cancelled",
      ));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        // Native fetch/body reads can remain pending after abort. Settle the public
        // operation ourselves, then stop the underlying request when supported.
        rejectStopped(new MapFetchError(
          "The map provider took too long to respond. Your existing offline map is still available. Try again later.",
          true,
          "network TimeoutError",
        ));
        controller.abort();
      }, 30_000);
      try {
        // Private.coffee's POST CGI currently fails while its documented GET API works.
        // Use standard form encoding for either transport, without logging the area URL.
        const data = `data=${encodeURIComponent(query)
          .replace(
            /[!'()*]/g,
            (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
          )
          .replace(/%20/g, "+")}`;
        const useGet = attempt === 0;
        const response = await Promise.race([fetch(
          useGet
            ? `${OVERPASS_ENDPOINTS[attempt]}?${data}`
            : OVERPASS_ENDPOINTS[attempt],
          {
            method: useGet ? "GET" : "POST",
            headers: {
              ...(useGet
                ? {}
                : { "Content-Type": "application/x-www-form-urlencoded" }),
              "User-Agent":
                "Beacon/0.1 (+https://github.com/jayGatsby988/beacon; explicit offline area save)",
            },
            ...(useGet ? {} : { body: data }),
            signal: controller.signal,
            redirect: "error",
          },
        ), stopped]);
        if (!current()) return;
        if (!response.ok)
          throw new MapFetchError(
            `Map provider unavailable (HTTP ${response.status}). Try saving your area later while online.`,
            response.status === 429 || response.status >= 500,
            `HTTP ${response.status}`,
          );
        if (Number(response.headers.get("content-length")) > MAX_BYTES)
          throw new MapFetchError(
            "This area has too much map detail to save.",
            false,
          );
        const text = await Promise.race([response.text(), stopped]);
        if (!current()) return;
        if (text.length > MAX_BYTES)
          throw new MapFetchError(
            "This area has too much map detail to save.",
            false,
          );
        return text;
      } catch (error) {
        if (!current()) return;
        const name =
          error && typeof error === "object" && "name" in error
            ? error.name
            : undefined;
        const networkKind =
          name === "TypeError" ||
          name === "AbortError" ||
          name === "TimeoutError"
            ? name
            : "Error";
        const failure =
          error instanceof MapFetchError
            ? error
            : new MapFetchError(
                "Could not reach the map provider. Try again while online.",
                true,
                `network ${networkKind}`,
              );
        failures.push(`${attempt + 1}: ${failure.diagnostic}`);
        if (!failure.retryable || attempt === OVERPASS_ENDPOINTS.length - 1)
          throw new Error(
            `${failure.message} Attempts ${failures.join("; ")}.`,
          );
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        if (this.controller === controller) this.controller = undefined;
      }
    }
  }
  private async clearGeometryFiles(keep?: string) {
    if (!FileSystem.documentDirectory) return;
    const files = await FileSystem.readDirectoryAsync(
      FileSystem.documentDirectory,
    );
    for (const file of files) {
      const path = FileSystem.documentDirectory + file;
      if (/^beacon-area-\d+-\d+\.json$/.test(file) && path !== keep)
        await FileSystem.deleteAsync(path, { idempotent: true });
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
  }
  cancel(): Promise<void> {
    return (this.cleanup ??= this.stopDownload(false).finally(() => {
      this.cleanup = undefined;
    }));
  }
  remove(): Promise<void> {
    if (this.cleanup) return this.cleanup.then(() => this.remove());
    return (this.cleanup = this.stopDownload(true).finally(() => {
      this.cleanup = undefined;
    }));
  }
  private async stopDownload(remove: boolean) {
    if (
      !remove &&
      !this.operation &&
      (!this.setup || this.state.status === "ready")
    )
      return;
    const previous = this.previousMap;
    this.generation++;
    this.controller?.abort();
    // An in-flight native creation must settle before its pack can be deleted.
    await this.setup;
    this.operation = false;
    if (remove || this.createdPack) {
      const old = (await MapLibre.offlineManager.getPacks()).find(
        (p) => p.name === PACK,
      );
      if (old) await MapLibre.offlineManager.deletePack(PACK);
    }
    if (remove) {
      await this.clearGeometryFiles();
      await this.set({ status: "missing", progress: 0 });
    } else {
      const restored = previous && this.previousIntact ? previous : CAMPUS_MAP;
      await this.clearGeometryFiles(restored.styleUrl);
      await this.set({ ...restored, savedAvailable: undefined });
    }
  }
}
