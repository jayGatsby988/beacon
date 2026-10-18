import MapLibre from "@maplibre/maplibre-react-native";
import * as FileSystem from "expo-file-system/legacy";
import type { Repository } from "../storage/Repository";
import type { LocationReport, MapState } from "../ui/types";
import campus from "../../assets/maps/uw-campus.json";

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
export class MapService {
  private state: MapState = { status: "missing", progress: 0 };
  private operation = false;
  private generation = 0;
  private disposed = false;
  private setup?: Promise<void>;
  private controller?: AbortController;
  constructor(
    private repo: Repository,
    private location: () => LocationReport,
    private changed: (state: MapState) => void,
  ) {}
  private async set(state: MapState) {
    if (this.disposed) return;
    this.state = state;
    this.changed(state);
    await this.repo.setSetting("offlineMap", state);
  }
  async initialize() {
    const stored = await this.repo.getSetting<MapState>(
      "offlineMap",
      CAMPUS_MAP,
    );
    this.state = stored;
    if (stored.bundled || stored.status === "missing") {
      this.changed(stored);
      return;
    }
    const pack = (await MapLibre.offlineManager.getPacks()).find(
      (p) => p.name === PACK,
    );
    if (!pack) {
      await this.set({ status: "missing", progress: 0 });
      return;
    }
    const status = await pack.status();
    await this.set({
      ...stored,
      status: status.percentage >= 100 ? "ready" : "error",
      progress: status.percentage / 100,
      bytes: status.completedResourceSize,
      error:
        status.percentage >= 100
          ? undefined
          : "Download was interrupted. Update the map when connected.",
    });
  }
  download(): Promise<void> {
    return (this.setup ??= this.performDownload().finally(() => {
      this.setup = undefined;
    }));
  }
  private async performDownload() {
    if (this.operation || this.disposed) return;
    this.operation = true;
    const generation = ++this.generation;
    try {
      const styleUrl = await this.repo.getSetting("mapStyleUrl", "");
      if (generation !== this.generation || this.disposed) return;
      if (!styleUrl) {
        this.operation = false;
        await this.set(CAMPUS_MAP);
        return;
      }
      const loc = this.location();
      if (loc.latitude == null || loc.longitude == null)
        throw new Error(
          "Refresh your location before downloading a custom region. The bundled UW campus map is already available.",
        );
      const url = new URL(styleUrl);
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
      for (const layer of style.layers) {
        layer.paint ??= {};
        for (const key of Object.keys(layer.paint))
          if (key.endsWith("-color"))
            layer.paint[key] =
              key === "text-color"
                ? "#F5F5F4"
                : key === "text-halo-color"
                  ? "#111317"
                  : layer.type === "background"
                    ? "#111317"
                    : layer.type === "line"
                      ? "#4D535D"
                      : "#292E36";
      }
      if (!FileSystem.documentDirectory)
        throw new Error("Map storage unavailable.");
      const local = FileSystem.documentDirectory + "beacon-map-style.json";
      await FileSystem.writeAsStringAsync(local, JSON.stringify(style));
      if (generation !== this.generation || this.disposed) return;
      const old = (await MapLibre.offlineManager.getPacks()).find(
        (p) => p.name === PACK,
      );
      if (old) await MapLibre.offlineManager.deletePack(PACK);
      const bounds: [number, number, number, number] = [
        Math.max(-180, loc.longitude - 0.012),
        Math.max(-85, loc.latitude - 0.009),
        Math.min(180, loc.longitude + 0.012),
        Math.min(85, loc.latitude + 0.009),
      ];
      if (bounds[1] >= bounds[3])
        throw new Error("This location is outside supported map coverage.");
      if (generation !== this.generation || this.disposed) return;
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
          if (status.percentage >= 100) this.operation = false;
          void this.set({
            status: status.percentage >= 100 ? "ready" : "downloading",
            progress: status.percentage / 100,
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
            ...this.state,
            status: "error",
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
        ...this.state,
        status: "error",
        error: e instanceof Error ? e.message : "Map download failed.",
      });
      throw e;
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
  }
  async remove() {
    this.generation++;
    this.controller?.abort();
    // Let an in-flight native pack creation settle before deleting it.
    await this.setup;
    this.operation = false;
    const old = (await MapLibre.offlineManager.getPacks()).find(
      (p) => p.name === PACK,
    );
    if (old) await MapLibre.offlineManager.deletePack(PACK);
    await this.set({ status: "missing", progress: 0 });
  }
}
