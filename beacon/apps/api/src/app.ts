import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createHash, randomUUID } from "node:crypto";
import {
  BatchSchema,
  EventSchema,
  IncidentId,
  type Principal,
  type Repository,
  type UploadEvent,
} from "./contracts.js";
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function createApp(
  repository: Repository,
  options: {
    now?: () => number;
    log?: (entry: Record<string, unknown>) => void;
  } = {},
) {
  const app = express();
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const started = now();
    const id = randomUUID();
    res.setHeader("X-Request-Id", id);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.on("finish", () =>
      log({
        requestId: id,
        method: req.method,
        status: res.statusCode,
        durationMs: now() - started,
      }),
    );
    next();
  });
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/readyz", async (_req, res) => {
    try {
      await repository.ready();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  // Bounded per-process token limiter. Caddy provides a single public ingress; no trust in spoofable forwarding headers.
  const windows = new Map<string, { at: number; count: number }>();
  app.use("/v1", async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.get("authorization");
    if (!auth || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(auth)) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const digest = tokenHash(auth.slice(7));
    const principal = await repository.authenticate(digest);
    if (!principal) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    if (windows.size > 10_000)
      for (const [key, value] of windows)
        if (now() - value.at >= 60_000) windows.delete(key);
    let window = windows.get(digest);
    if (!window || now() - window.at >= 60_000) {
      window = { at: now(), count: 0 };
      windows.set(digest, window);
    }
    if (++window.count > 120) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }
    res.locals.principal = principal;
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  async function membership(
    res: Response,
    incidentId: string,
  ): Promise<boolean> {
    const p = res.locals.principal as Principal;
    if (!(await repository.isMember(p.deviceId, incidentId))) {
      res.status(403).json({ error: "Incident access denied" });
      return false;
    }
    return true;
  }
  app.post("/v1/events/batch", async (req, res) => {
    const batch = BatchSchema.safeParse(req.body);
    if (!batch.success) {
      res.status(400).json({ error: "Invalid batch; maximum 100 events" });
      return;
    }
    if (!(await membership(res, batch.data.incidentId))) return;
    const deviceId = (res.locals.principal as Principal).deviceId;
    const valid: UploadEvent[] = [];
    const rejected: { id: string; reason: string }[] = [];
    for (const raw of batch.data.events) {
      const parsed = EventSchema.safeParse(raw);
      const candidate = raw as { id?: unknown } | null;
      const id =
        typeof candidate?.id === "string"
          ? candidate.id.slice(0, 160)
          : "unknown";
      if (!parsed.success) {
        rejected.push({ id, reason: "Invalid event or signature" });
        continue;
      }
      if (parsed.data.deviceId !== deviceId) {
        rejected.push({ id, reason: "Device does not match credentials" });
        continue;
      }
      if (
        parsed.data.recordedAt > now() + 300_000 ||
        (parsed.data.message?.createdAt ?? 0) > now() + 300_000
      ) {
        rejected.push({ id, reason: "Timestamp too far in future" });
        continue;
      }
      valid.push(parsed.data);
    }
    const result = await repository.ingest(
      batch.data.incidentId,
      deviceId,
      valid,
    );
    result.rejected.push(...rejected);
    res.json(result);
  });
  app.get("/v1/incidents/:id/events", async (req, res) => {
    const id = IncidentId.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Invalid incident" });
      return;
    }
    if (!(await membership(res, id.data))) return;
    const cursor = req.query.cursor;
    if (
      cursor !== undefined &&
      (typeof cursor !== "string" || cursor.length > 512)
    ) {
      res.status(400).json({ error: "Invalid cursor" });
      return;
    }
    try {
      res.json(await repository.replay(id.data, cursor));
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid cursor") {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  });
  app.get("/v1/incidents/:id/summary", async (req, res) => {
    const id = IncidentId.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Invalid incident" });
      return;
    }
    if (await membership(res, id.data))
      res.json(await repository.summary(id.data));
  });
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(
    (
      error: Error & { status?: number },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      const status =
        error.status === 413 ? 413 : error instanceof SyntaxError ? 400 : 503;
      res
        .status(status)
        .json({
          error:
            status === 413
              ? "Batch too large"
              : status === 400
                ? "Invalid JSON"
                : "Service unavailable; retry safely",
        });
    },
  );
  return app;
}
