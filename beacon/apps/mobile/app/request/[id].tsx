import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Check, ChevronDown, ChevronUp, Radio, HeartHandshake, MapPin } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  Body,
  Button,
  ErrorNotice,
  Field,
  formatTime,
  formatReportTime,
  Heading,
  Screen,
  TextButton,
  useAction,
  styles,
  StatusLine,
} from "../../src/components/ui";
import { categoryNames, requestStatus } from "../../src/components/RequestCard";
import { LocationCard } from "../../src/components/LocationCard";
import { colors as c, fonts } from "../../src/theme/tokens";

function Disclosure({
  title,
  open,
  onPress,
}: {
  title: string;
  open: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <Text style={styles.textButtonText}>{title}</Text>
      {open ? (
        <ChevronUp color={c.secondary} size={20} />
      ) : (
        <ChevronDown color={c.secondary} size={20} />
      )}
    </Pressable>
  );
}

export default function RequestDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RequestContent key={id} id={id} />;
}

function RequestContent({ id }: { id: string }) {
  const b = useBeacon();
  const r = b.requests.find((request) => request.id === id);
  const action = useAction();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showDelivery, setShowDelivery] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [receiptError, setReceiptError] = useState<string>();
  const markedRequests = useRef(new Set<string>());
  const markSeen = b.markSeen;
  const openedRequestId =
    r && !r.mine && (r.status === "active" || r.status === "accepted")
      ? r.id
      : undefined;
  useEffect(() => {
    setReceiptError(undefined);
    if (!openedRequestId || markedRequests.current.has(openedRequestId)) return;
    markedRequests.current.add(openedRequestId);
    let current = true;
    void markSeen(openedRequestId).catch((error: unknown) => {
      if (current)
        setReceiptError(
          error instanceof Error ? error.message : "Could not confirm receipt.",
        );
    });
    return () => {
      current = false;
    };
  }, [openedRequestId, markSeen]);
  if (!r)
    return (
      <Screen back title="Request">
        <Heading>Request unavailable</Heading>
        <Body muted>Not stored on this phone.</Body>
        <Button secondary onPress={() => router.replace("/(tabs)")}>
          Back to Help
        </Button>
      </Screen>
    );
  const closed = ["completed", "canceled", "expired"].includes(r.status);
  const myOffer = r.offers.find((offer) => offer.nodeId === b.nodeId);
  const accepted = r.offers.find((offer) => offer.id === r.acceptedOfferId);
  const canOffer = !r.mine && r.status === "active" && !myOffer && !r.acceptedOfferId;
  const hasCoordinates = r.location.latitude != null && r.location.longitude != null;
  const status =
    !closed && !accepted && myOffer
      ? "Waiting for acceptance"
      : requestStatus(r);
  const statusDetail = closed
    ? undefined
    : accepted
      ? `${accepted.nodeId === b.nodeId ? "Your offer" : accepted.name || "Volunteer"}${accepted.assignmentReceived ? "" : " · waiting for confirmation"}`
      : r.mine && r.transport !== "received"
        ? r.transport === "forwarded"
          ? "Participant receipt pending."
          : "Saved on this phone."
        : myOffer
          ? "Your offer is saved."
          : undefined;
  const completeRequest = () =>
    Alert.alert(
      "Complete request?",
      "Confirm that you no longer need help. The update will be shared when phones connect.",
      [
        { text: "Keep open", style: "cancel" },
        {
          text: "Mark completed",
          onPress: () => action.run(() => b.completeRequest(r.id)),
        },
      ],
    );
  return (
    <Screen back title="Request">
      <View style={[s.summary, r.status === "completed" && s.completed]}>
        <View style={s.summaryTop}>
          <Text style={[s.eyebrow, r.status === "completed" && s.darkText]}>{r.status === "completed" ? "REQUEST COMPLETED" : r.mine ? "YOUR SOS" : "HELP REQUEST"}</Text>
          {r.status === "completed" ? <Check size={24} color={c.background} /> : <Radio size={24} color={r.mine ? c.redLabel : c.secondary} />}
        </View>
        <Text accessibilityRole="header" style={[s.requestTitle, r.status === "completed" && s.darkText]}>{categoryNames[r.category]}</Text>
        <Text style={[styles.caption, r.status === "completed" && s.darkText]}>
          {r.mine ? "You" : r.name || "Participant"} · Created {formatTime(r.createdAt)}
        </Text>
        <View style={[s.statusBox, r.status === "completed" && { borderTopColor: "#CAD1D6" }]}>
          <Text style={[s.statusTitle, r.status === "completed" && s.darkText]} accessibilityLiveRegion="polite">{status}</Text>
          {statusDetail && <Text style={styles.caption}>{statusDetail}</Text>}
          {r.pendingUpdate && <Text style={[styles.caption, r.status === "completed" && s.darkText]}>Update waiting to be shared. Others may still see the old request.</Text>}
        </View>
      </View>
      {(r.note || r.location.place || hasCoordinates) && (
        <View style={s.noteCard}>
          {!!r.note && <Body>{r.note}</Body>}
          {(r.location.place || hasCoordinates) && (
            <View style={s.locationSummary}>
              <MapPin size={19} color={c.secondary} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text selectable style={styles.smallTitle}>{r.location.place || `${r.location.latitude!.toFixed(5)}, ${r.location.longitude!.toFixed(5)}`}</Text>
                {hasCoordinates && <Text style={styles.caption}>{formatReportTime(r.location.capturedAt)} · Not live{r.location.accuracy != null ? ` · ±${Math.round(r.location.accuracy)} m` : ""}</Text>}
              </View>
            </View>
          )}
        </View>
      )}
      {r.mine && !closed && !accepted && r.offers.length === 0 && (
        <View style={s.waitingCard}>
          <HeartHandshake size={25} color={c.secondary} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={styles.smallTitle}>Waiting for offers</Text>
            <Text style={styles.caption}>You’ll see them here when they arrive.</Text>
          </View>
        </View>
      )}

      {canOffer && (
        <View style={{ gap: 4 }}>
          <Button
            secondary
            busy={action.busy}
            onPress={() =>
              action.run(() => b.offerHelp(r.id, note.trim() || undefined))
            }
          >
            Offer help
          </Button>
          <Disclosure
            title={note ? "Offer note" : "Add a note"}
            open={showNote}
            onPress={() => setShowNote((shown) => !shown)}
          />
          {showNote && (
            <Field
              label="Optional note"
              value={note}
              onChangeText={setNote}
              maxLength={140}
              multiline
              style={{ minHeight: 80 }}
            />
          )}
        </View>
      )}

      {r.status === "active" && r.mine && !r.acceptedOfferId && r.offers.length > 0 && (
        <View style={{ gap: 12 }}>
          <Heading size={20}>Offers · {r.offers.length}</Heading>
          {r.offers.map((offer) => (
            <View key={offer.id} style={styles.card}>
              <View style={{ gap: 4 }}>
                <Text style={styles.smallTitle}>{offer.name || "Participant"}</Text>
                <Text style={styles.caption}>{formatTime(offer.createdAt)}</Text>
              </View>
              {!!offer.note && <Body>{offer.note}</Body>}
              <Button secondary busy={action.busy} onPress={() => action.run(() => b.acceptOffer(r.id, offer.id))}>
                Accept {offer.name || "help"}
              </Button>
            </View>
          ))}
        </View>
      )}

      {!closed && !!(accepted?.note || myOffer?.note) && (
        <Body>{accepted?.note || myOffer?.note}</Body>
      )}

      {r.mine && !closed && (
        <View style={{ gap: 2 }}>
          <Button secondary busy={action.busy} onPress={completeRequest}>
            I no longer need help
          </Button>
          <TextButton
            onPress={() => {
              if (action.busy) return;
              Alert.alert(
                "Cancel request?",
                "The cancellation will be shared when phones connect. Others may still see the request until then.",
                [
                  { text: "Keep request", style: "cancel" },
                  {
                    text: "Cancel request",
                    style: "destructive",
                    onPress: () => action.run(() => b.cancelRequest(r.id)),
                  },
                ],
              );
            }}
          >
            Cancel request
          </TextButton>
        </View>
      )}

      {r.mine && (
        <View style={{ gap: 2 }}>
          <Disclosure
            title="Delivery details"
            open={showDelivery}
            onPress={() => setShowDelivery((shown) => !shown)}
          />
          {showDelivery && (
            <View style={s.delivery}>
              <StatusLine complete title="Saved on this phone" detail={`Created ${formatTime(r.createdAt)} · Updated ${formatTime(r.updatedAt)}`} />
              <StatusLine complete={r.transport === "forwarded" || r.transport === "received"} title={r.transport === "received" ? "Participant receipt received" : r.transport === "forwarded" ? "Passed to a relay" : "Waiting for a connection"} detail={r.transport === "received" ? "A participant saved the request. This is not a promise of help." : r.transport === "forwarded" ? "No participant receipt yet." : "Ready to share when another phone connects."} />
              <StatusLine complete={r.seenCount > 0} title={r.seenCount > 0 ? `Seen by ${r.seenCount}` : "No view confirmation yet"} />
            </View>
          )}
        </View>
      )}
      <ErrorNotice message={action.error || receiptError} />
      {hasCoordinates && (
        <View style={{ gap: 4 }}>
          <Disclosure title="Location map" open={showMap} onPress={() => setShowMap((shown) => !shown)} />
          {showMap && <LocationCard location={r.location} map={b.map} />}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  summary: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 20, gap: 10 },
  summaryTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  eyebrow: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 17, letterSpacing: 1.8, color: c.secondary, flexShrink: 1 },
  requestTitle: { fontFamily: fonts.medium, fontSize: 28, lineHeight: 35, letterSpacing: -0.7, color: c.text },
  statusBox: { marginTop: 6, paddingTop: 16, borderTopWidth: 1, borderTopColor: c.border, gap: 7 },
  statusTitle: { fontFamily: fonts.medium, fontSize: 18, lineHeight: 25, color: c.text },
  completed: { backgroundColor: c.text, borderColor: c.text },
  darkText: { color: c.background },
  noteCard: { gap: 16 },
  locationSummary: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  waitingCard: { flexDirection: "row", gap: 14, padding: 18, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 16, alignItems: "center" },
  delivery: { paddingVertical: 12, gap: 18 },
});
