import MapLibre from "@maplibre/maplibre-react-native";
import * as FileSystem from "expo-file-system/legacy";
import type { Repository } from "../storage/Repository";
import type { LocationReport, MapState } from "../ui/types";
import campus from "../../assets/maps/uw-campus.json";
import { campusStyle } from "../components/campusMapStyle";

export const CAMPUS_BOUNDS: [number, number, number, number] = [
  -122.313, 47.65, -122.299, 47.66,
];
export const CAMPUS_MAP: MapState = {
  status: "ready",
  progress: 1,
  name: "UW campus · bundled geometry",
  bytes: JSON.stringify(campus).length,
  updatedAt: Date.parse("2026-10-17T20:02:22-07:00"),
  bundled: true,
  bounds: CAMPUS_BOUNDS,
};
const PACK = "beacon-local-region";
const OVERPASS = "https://overpass.private.coffee/api/interpreter";
const MAX_BYTES = 8_000_000;
type SavedMap = MapState & { format?: "geometry" };
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
    this.state = state;
    this.changed(state);
    // Preserve callback order even if storage writes settle out of order.
    const generation = this.generation;
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        if (!this.disposed && generation === this.generation)
          await this.repo.setSetting("offlineMap", state);
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
    const info = stored.styleUrl
      ? await FileSystem.getInfoAsync(stored.styleUrl)
      : undefined;
    if (!current()) return;
    if (!info?.exists || !stored.bounds) {
      await this.set({
        status: "error",
        progress: 0,
        error: "Saved map files are missing. Save your area again when online.",
      });
      return;
    }
    if (stored.format === "geometry") {
      try {
        if (info.size > MAX_BYTES) throw new Error("Invalid map size");
        const style = JSON.parse(
          await FileSystem.readAsStringAsync(stored.styleUrl!),
        );
        if (
          style.metadata?.beaconFormat !== "geometry" ||
          style.version !== 8 ||
          !Array.isArray(style.sources?.campus?.data?.features) ||
          style.sources.campus.data.features.length === 0
        )
          throw new Error("Invalid saved map");
        if (current())
          await this.set({
            ...stored,
            status: "ready",
            progress: 1,
            savedAvailable: undefined,
            error: undefined,
          });
      } catch {
        if (current())
          await this.set({
            status: "error",
            progress: 0,
            error:
              "Saved map could not be read. Save your area again when online.",
          });
      }
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
      ...stored,
      status: complete(status) ? "ready" : "error",
      progress: progress(status),
      bytes: status.completedResourceSize,
      error: complete(status)
        ? undefined
        : "Download was interrupted. Save the map again when online.",
    });
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
    const query = `[out:json][timeout:25][maxsize:8388608];(way[highway](${box});way[building](${box});way[leisure~"^(park|garden|pitch)$"](${box});way[natural=water](${box}););out geom;`;
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 30_000);
    let text: string;
    try {
      const response = await fetch(OVERPASS, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Beacon/0.1 (+https://github.com/jayGatsby988/beacon; explicit offline area save)",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
        redirect: "error",
      });
      if (!current()) return;
      if (!response.ok)
        throw new Error(
          "Map provider unavailable. Try saving your area later while online.",
        );
      if (Number(response.headers.get("content-length")) > MAX_BYTES)
        throw new Error("This area has too much map detail to save.");
      text = await response.text();
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = undefined;
    }
    if (!current()) return;
    if (text.length > MAX_BYTES)
      throw new Error("This area has too much map detail to save.");
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
