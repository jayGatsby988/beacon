import type { RequestView } from "../ui/types";

export type AlertKind = "sos" | "offer" | "accepted" | "confirmed";
export interface HelpAlert {
  key: string;
  requestId: string;
  groupId: string | null;
  kind: AlertKind;
  title: string;
  body: string;
}

/** Input must be the protocol's verified, reduced request views, never raw BLE packets. */
export function helpAlerts(requests: readonly RequestView[], nodeId: string, groupId: string | null): HelpAlert[] {
  const alerts: HelpAlert[] = [];
  for (const r of requests) {
    if ((r.groupId ?? null) !== groupId || !["active", "accepted"].includes(r.status)) continue;
    const add = (kind: AlertKind, suffix: string, title: string, body: string) => alerts.push({
      key: `${r.id}:${kind}:${suffix}`, requestId: r.id, groupId, kind, title, body,
    });
    // Generic lock-screen text deliberately excludes names, medical notes and locations.
    if (!r.mine && r.status === "active") {
      add("sos", "", "New help request", "An SOS reached your phone. Open Beacon to view it.");
    }
    if (r.mine && r.status === "active" && !r.acceptedOfferId) {
      for (const offer of r.offers) {
        if (offer.nodeId !== nodeId) add("offer", offer.id, "Someone offered to help", "Open Beacon to review the offer.");
      }
    }
    const accepted = r.offers.find(o => o.id === r.acceptedOfferId);
    if (r.status !== "accepted" || !accepted) continue;
    if (!r.mine && accepted.nodeId === nodeId) {
      add("accepted", accepted.id, "Your offer was accepted", "Open Beacon to view the request and coordinate.");
    }
    if (r.mine && accepted.assignmentReceived) {
      add("confirmed", accepted.id, "Volunteer confirmed", "Your volunteer confirmed receiving the assignment. Open Beacon for details.");
    }
  }
  return alerts;
}

export interface AlertStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export type AlertPermission = "granted" | "denied" | "undetermined" | "unavailable";
export interface AlertPort {
  permission(request: boolean): Promise<AlertPermission>;
  present(alert: HelpAlert): Promise<void>;
}
const ENABLED = "beacon.help-alerts.enabled.v1";
const RETENTION = 48 * 60 * 60 * 1000;
const MAX_SEEN = 2048;

/** Independent from routing: notification/permission failures cannot fail SOS persistence. */
export class HelpAlertCoordinator {
  enabled = false;
  permission: AlertPermission = "undetermined";
  private disposed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private initialized?: Promise<void>;
  private primed = new Set<string>();
  private sentAt: number[] = [];
  constructor(private readonly storage: AlertStorage, private readonly port: AlertPort,
    private readonly clock = Date.now) {}

  initialize(): Promise<void> {
    return this.initialized ??= (async () => {
      this.enabled = await this.storage.getItem(ENABLED) === "true";
      await this.checkPermission();
    })();
  }
  async checkPermission() { this.permission = await this.port.permission(false); }
  async setEnabled(enabled: boolean) {
    await this.initialize();
    if (enabled) this.permission = await this.port.permission(true);
    if (this.disposed) return;
    this.enabled = enabled && this.permission === "granted";
    await this.storage.setItem(ENABLED, JSON.stringify(this.enabled));
  }
  dispose() { this.disposed = true; }
  settle() { return this.tail; }

  observe(requests: readonly RequestView[], nodeId: string, groupId: string | null,
    isCurrent: () => boolean = () => true): Promise<void> {
    const job = this.tail.then(async () => {
      await this.initialize();
      if (this.disposed || !isCurrent()) return;
      const key = `beacon.help-alerts.seen.v1:${nodeId}:${groupId ?? "public"}`;
      const now = this.clock();
      let raw: unknown;
      try { raw = JSON.parse(await this.storage.getItem(key) ?? "{}"); } catch { raw = {}; }
      const seen: Record<string, number> = Object.fromEntries(
        Object.entries(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {})
          .filter(([id, time]) => id.length < 240 && typeof time === "number" && Number.isFinite(time) && time > now - RETENTION)
          .sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, MAX_SEEN),
      );
      const candidates = helpAlerts(requests, nodeId, groupId);
      const first = !this.primed.has(key);
      const save = async () => {
        const bounded = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN));
        await this.storage.setItem(key, JSON.stringify(bounded));
      };
      if (!first && this.enabled) await this.checkPermission();
      for (const alert of candidates) {
        if (this.disposed || !isCurrent()) return;
        if (seen[alert.key] !== undefined) continue;
        seen[alert.key] = now;
        // Baseline restored history and disabled periods without replaying old alerts.
        if (first || !this.enabled || this.permission !== "granted") continue;
        this.sentAt = this.sentAt.filter(time => time > now - 60_000);
        if (this.sentAt.length >= 6) continue;
        await save(); // Persist before presentation to prevent reconnect/restart alert storms.
        if (this.disposed || !isCurrent() || !this.enabled) return;
        try {
          await this.port.present(alert);
          this.sentAt.push(now);
        } catch (error) {
          delete seen[alert.key];
          await save(); // A transient native failure may retry on the next state refresh.
          throw error;
        }
      }
      await save();
      this.primed.add(key);
    });
    this.tail = job.catch(() => {});
    return job;
  }
}

/** Only app-owned request IDs can become routes; notification payloads are never arbitrary URLs. */
export function parseHelpAlertData(data: unknown): { requestId: string; groupId: string | null } | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  const id = /^[a-f0-9]{64}$/;
  if (value.beaconAlert !== 1 || typeof value.requestId !== "string" || !id.test(value.requestId)) return null;
  if (value.groupId !== null && (typeof value.groupId !== "string" || !id.test(value.groupId))) return null;
  return { requestId: value.requestId, groupId: value.groupId as string | null };
}
