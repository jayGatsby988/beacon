import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ArrowLeft, ArrowRight, Check, Clock3 } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../src/services/BeaconContext";
import {
  Body,
  Button,
  Card,
  Divider,
  ErrorNotice,
  Heading,
  Label,
  Pill,
  Screen,
  formatTime,
  useAction,
  styles,
} from "../src/components/ui";
import { colors as c, fonts } from "../src/theme/tokens";
export default function History() {
  const b = useBeacon();
  const [source, setSource] = useState<"local" | "combined">("local");
  const [step, setStep] = useState<number | null>(null);
  const action = useAction();
  const summary = source === "combined" ? b.sync.summary : undefined;
  const totals = new Map<string, number>();
  for (const row of summary?.activityBuckets ?? []) {
    totals.set(row.bucket, (totals.get(row.bucket) ?? 0) + row.event_count);
  }
  const activity = [...totals]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .slice(-12);
  const peak = Math.max(1, ...activity.map(([, count]) => count));
  const duration = (milliseconds: number | null) =>
    milliseconds === null
      ? "—"
      : milliseconds < 1000
        ? `${Math.round(milliseconds)} ms`
        : milliseconds < 60000
          ? `${(milliseconds / 1000).toFixed(1)} s`
          : milliseconds < 3600000
            ? `${(milliseconds / 60000).toFixed(1)} min`
            : `${(milliseconds / 3600000).toFixed(1)} h`;
  const events = [
    ...(source === "local" ? b.events : b.sync.combinedEvents || []),
  ].sort((a, b) => a.createdAt - b.createdAt);
  const shown =
    step === null ? events : events.slice(0, Math.min(step + 1, events.length));
  const selected =
    step === null ? undefined : events[Math.min(step, events.length - 1)];
  return (
    <Screen back title="History & replay">
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pill
          selected={source === "local"}
          onPress={() => {
            setSource("local");
            setStep(null);
          }}
        >
          On this phone
        </Pill>
        <Pill
          selected={source === "combined"}
          onPress={() => {
            setSource("combined");
            setStep(null);
          }}
        >
          Combined
        </Pill>
      </View>
      <Card>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <Label>
            {source === "local" ? "Local record" : "Combined record"}
          </Label>
          <Label>{events.length} events</Label>
        </View>
        <Body muted>
          {source === "local"
            ? "Saved on this phone; available offline."
            : b.sync.status === "disabled"
              ? "Connect an incident to load its shared history."
              : "Last synced events. Late uploads may change this history."}
        </Body>
        <Divider />
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <Body muted>{b.sync.pendingCount} pending upload</Body>
          <Text style={styles.caption}>
            {b.sync.lastSyncedAt
              ? `Synced ${formatTime(b.sync.lastSyncedAt)}`
              : "Never synced"}
          </Text>
        </View>
        {b.sync.status === "disabled" ? (
          <Button secondary onPress={() => router.push("/incident")}>
            Connect an incident
          </Button>
        ) : (
          <Button
            secondary
            busy={action.busy || b.sync.status === "syncing"}
            onPress={() => action.run(b.syncNow)}
          >
            Sync recorded events
          </Button>
        )}
      </Card>
      <ErrorNotice message={action.error || b.sync.error} />
      {summary && (
        <Card style={{ gap: 18 }}>
          <Label>Incident {summary.incidentId} · incomplete record</Label>
          <Heading size={22}>{summary.requestCount} recorded requests</Heading>
          <Body muted>
            {summary.requestsWithRecipientReceipt} with a verified recipient
            receipt · {summary.completedRequests} completed by the requester
          </Body>
          <Body muted>
            Receipts confirm a saved request, not that someone read it or help
            arrived.
          </Body>
          <Text style={styles.caption}>
            Server updated {new Date(summary.updatedAt).toLocaleString()}.
            Phones that have not synced are excluded.
          </Text>
          {summary.requestStatisticsTruncated && (
            <Body muted>
              Partial totals: the server’s record limit was reached.
            </Body>
          )}
          <Divider />
          <Label>Local receipt round trips</Label>
          {summary.localReceiptRoundTripMs.sampleCount > 0 ? (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 24 }}>
                <View style={{ gap: 6 }}>
                  <Text style={styles.smallTitle}>
                    {duration(summary.localReceiptRoundTripMs.p50)}
                  </Text>
                  <Text style={styles.caption}>Median</Text>
                </View>
                <View style={{ gap: 6 }}>
                  <Text style={styles.smallTitle}>
                    {duration(summary.localReceiptRoundTripMs.p95)}
                  </Text>
                  <Text style={styles.caption}>95th percentile</Text>
                </View>
              </View>
              <Text style={styles.caption}>
                {summary.localReceiptRoundTripMs.sampleCount} local
                SOS-to-receipt samples. Uses this phone’s clock; clock changes
                affect timing.
              </Text>
            </>
          ) : (
            <Body muted>No local SOS-to-receipt samples yet.</Body>
          )}
          {activity.length > 0 && (
            <>
              <Divider />
              <Label>Uploaded observations by hour</Label>
              <View
                style={{
                  flexDirection: "row",
                  gap: 6,
                  height: 64,
                  alignItems: "flex-end",
                }}
              >
                {activity.map(([bucket, count]) => (
                  <View
                    key={bucket}
                    accessible
                    accessibilityLabel={`${new Date(bucket).toLocaleString()}: ${count} observations`}
                    style={{
                      flex: 1,
                      height: Math.max(3, (64 * count) / peak),
                      backgroundColor: c.secondary,
                      borderRadius: 2,
                    }}
                  />
                ))}
              </View>
              <Text style={styles.caption}>
                {new Date(activity[0][0]).toLocaleString()} to{" "}
                {new Date(activity[activity.length - 1][0]).toLocaleString()}.
                Last 12 returned hours; missing hours omitted. Multiple phones
                may record one message.
              </Text>
            </>
          )}
          <Text style={styles.caption}>
            {summary.aggregateRefreshPending
              ? "Hourly totals are refreshing; late uploads may not appear yet."
              : activity.length
                ? "Counts reflect uploaded observations."
                : "No hourly aggregate data is available yet."}
          </Text>
        </Card>
      )}

      {events.length > 0 ? (
        <>
          <Card style={{ gap: 20 }}>
            <Label>Incident replay</Label>
            <Text
              style={{
                fontFamily: fonts.headline,
                fontSize: 24,
                lineHeight: 30,
                color: c.text,
              }}
            >
              {selected ? formatTime(selected.createdAt) : "All events"}
            </Text>
            <Body muted>
              {selected ? selected.title : "Step through saved events."}
            </Body>
            <View
              style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
            >
              {events.slice(0, 40).map((e, i) => (
                <View
                  key={e.id}
                  style={{
                    height: 32,
                    flex: 1,
                    backgroundColor:
                      step === i
                        ? c.red
                        : step === null || i <= step
                          ? c.text
                          : c.border,
                    borderRadius: 2,
                  }}
                />
              ))}
            </View>
            {events.length > 40 && (
              <Text style={styles.caption}>
                First 40 event markers shown. Controls replay every event.
              </Text>
            )}
            <View
              style={{ flexDirection: "row", gap: 12, alignItems: "center" }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous recorded event"
                disabled={step === 0}
                onPress={() =>
                  setStep(step === null ? 0 : Math.max(0, step - 1))
                }
                style={[
                  styles.iconButton,
                  {
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 12,
                    opacity: step === 0 ? 0.4 : 1,
                  },
                ]}
              >
                <ArrowLeft color={c.text} size={20} />
              </Pressable>
              <Text style={[styles.caption, { flex: 1, textAlign: "center" }]}>
                {step === null
                  ? "All recorded events"
                  : `${Math.min(step + 1, events.length)} of ${events.length}`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next recorded event"
                disabled={step === events.length - 1}
                onPress={() =>
                  setStep(
                    step === null ? 0 : Math.min(events.length - 1, step + 1),
                  )
                }
                style={[
                  styles.iconButton,
                  {
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 12,
                    opacity: step === events.length - 1 ? 0.4 : 1,
                  },
                ]}
              >
                <ArrowRight color={c.text} size={20} />
              </Pressable>
            </View>
            {step !== null && (
              <Button secondary icon={false} onPress={() => setStep(null)}>
                Show all events
              </Button>
            )}
          </Card>
          <Label>
            {step === null
              ? "Most recent first"
              : "Record through selected event"}
          </Label>
          {[...shown].reverse().map((e, i) => (
            <View
              key={e.id}
              style={{ flexDirection: "row", gap: 16, paddingBottom: 20 }}
            >
              <View style={{ alignItems: "center", gap: 10, width: 22 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: c.text,
                    marginTop: 5,
                  }}
                />
                {i < shown.length - 1 && (
                  <View
                    style={{
                      flex: 1,
                      width: 1,
                      minHeight: 36,
                      backgroundColor: c.border,
                    }}
                  />
                )}
              </View>
              <View style={{ flex: 1, gap: 7 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                >
                  <Label>{formatTime(e.createdAt)}</Label>
                  {e.uploaded && (
                    <Check
                      size={15}
                      color={c.secondary}
                      accessibilityLabel="Uploaded to cloud"
                    />
                  )}
                </View>
                <Text style={styles.smallTitle}>{e.title}</Text>
                {!!e.detail && (
                  <Body muted style={{ fontSize: 14, lineHeight: 21 }}>
                    {e.detail}
                  </Body>
                )}
                {(e.fromNodeId || e.toNodeId) && (
                  <Text style={styles.caption}>
                    {e.toNodeId
                      ? `Recorded hop: ${e.fromNodeId?.slice(0, 6) || "unknown"} → ${e.toNodeId.slice(0, 6)}`
                      : `Observed by ${e.fromNodeId?.slice(0, 6) || "unknown"}`}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </>
      ) : (
        <Card style={{ paddingVertical: 32, gap: 20 }}>
          <Clock3 color={c.secondary} size={32} />
          <Heading size={22}>
            {source === "local"
              ? "No local events yet"
              : "No shared events yet"}
          </Heading>
          <Body muted>
            {source === "local"
              ? "Requests and assistance updates will appear here."
              : "Sync an incident to load shared events."}
          </Body>
        </Card>
      )}
    </Screen>
  );
}
