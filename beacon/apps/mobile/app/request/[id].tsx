import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Check, ChevronDown, ChevronUp, Clock3, HeartHandshake, MapPin } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  Body,
  Button,
  ErrorNotice,
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
      style={({ pressed }) => [s.disclosure, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.textButtonText}>{title}</Text>
      {open ? <ChevronUp color={c.secondary} size={20} /> : <ChevronDown color={c.secondary} size={20} />}
    </Pressable>
  );
}

export default function RequestDetails() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <RequestContent key={id} id={id} />;
}

function RequestContent({ id }: { id: string | undefined }) {
  const b = useBeacon();
  const r = b.requests.find((request) => request.id === id);
  const action = useAction();
  const [showDelivery, setShowDelivery] = useState(false);
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
      markedRequests.current.delete(openedRequestId);
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
  const status = !closed && !accepted && myOffer ? "Waiting for acceptance" : requestStatus(r);
  const statusDetail = closed
    ? undefined
    : accepted
      ? `${accepted.nodeId === b.nodeId ? "Your offer" : accepted.name || "Volunteer"}${accepted.assignmentReceived ? "" : " · confirmation pending"}`
      : r.mine && r.transport !== "received"
        ? r.transport === "forwarded"
          ? "Waiting for a recipient to confirm receipt."
          : "Saved on this phone. Keep Beacon open."
        : myOffer
          ? "Your offer is saved."
          : undefined;
  const chatPeerId = r.mine ? accepted?.nodeId : r.originNodeId;
  const chatPerson = (r.groupId ?? null) === b.activeGroupId
    ? b.people.find((person) => person.nodeId === chatPeerId && person.scope === b.activeGroupId)
    : undefined;
  const completeRequest = () =>
    Alert.alert("No longer need help?", "Your request will be marked completed.", [
      { text: "Keep open", style: "cancel" },
      { text: "Mark completed", onPress: () => action.run(() => b.completeRequest(r.id)) },
    ]);

  return (
    <Screen back title="Help">
      <View style={[s.summary, r.status === "completed" && s.completed]}>
        <Text accessibilityRole="header" style={[s.requestTitle, r.status === "completed" && s.darkText]}>
          {r.mine ? closed ? "Your request" : "Your SOS" : closed ? `${r.name || "Participant"}’s request` : `${r.name || "Someone"} needs help`}
        </Text>
        {r.category !== "other" && <Text style={[s.category, r.status === "completed" && s.darkText]}>{categoryNames[r.category]}</Text>}
        <View style={s.statusRow}>
          <View style={s.statusIcon}>
            {r.status === "completed" ? <Check size={23} color={c.background} /> : accepted?.assignmentReceived ? <HeartHandshake size={23} color={c.text} /> : <Clock3 size={23} color={c.secondary} />}
          </View>
          <View style={s.statusCopy}>
            <Text style={[s.statusTitle, r.status === "completed" && s.darkText]} accessibilityLiveRegion="polite">{status}</Text>
            {statusDetail && <Text style={styles.caption}>{statusDetail}</Text>}
            {r.pendingUpdate && <Text style={[styles.caption, r.status === "completed" && s.darkText]}>Update saved here · waiting to share</Text>}
          </View>
        </View>
      </View>

      <View style={s.context}>
        {!!r.note && <Body>{r.note}</Body>}
        <View style={s.locationSummary}>
          <MapPin size={21} color={c.secondary} />
          <View style={s.statusCopy}>
            {r.location.place || hasCoordinates ? <>
              <Text selectable style={styles.smallTitle}>{r.location.place || `${r.location.latitude!.toFixed(5)}, ${r.location.longitude!.toFixed(5)}`}</Text>
              {hasCoordinates && <Text style={styles.caption}>{formatReportTime(r.location.capturedAt)} · Not live{r.location.accuracy != null ? ` · ±${Math.round(r.location.accuracy)} m` : ""}</Text>}
            </> : <Text style={styles.caption}>No location attached</Text>}
          </View>
        </View>
        {hasCoordinates && <TextButton onPress={() => router.push({ pathname: "/(tabs)/nearby", params: { view: "map", requestId: r.id } })}>View location on map</TextButton>}
      </View>

      {canOffer && <Button busy={action.busy} onPress={() => action.run(() => b.offerHelp(r.id))}>Offer help</Button>}

      {r.mine && !closed && !accepted && r.offers.length === 0 && (
        <View style={s.waitingRow}>
          <HeartHandshake size={22} color={c.secondary} />
          <Text style={styles.smallTitle}>No help offers yet</Text>
        </View>
      )}

      {r.status === "active" && r.mine && !r.acceptedOfferId && r.offers.length > 0 && (
        <View style={s.offers}>
          <Heading size={24}>Help offers</Heading>
          {r.offers.map((offer) => (
            <View key={offer.id} style={s.offer}>
              <Text style={s.offerName}>{offer.name || "Participant"}</Text>
              {!!offer.note && <Body>{offer.note}</Body>}
              <Button secondary busy={action.busy} onPress={() => action.run(() => b.acceptOffer(r.id, offer.id))}>
                Accept {offer.name || "help"}
              </Button>
            </View>
          ))}
        </View>
      )}

      {!closed && !!(accepted?.note || myOffer?.note) && <Body>{accepted?.note || myOffer?.note}</Body>}
      {!closed && chatPerson && (
        <Button secondary onPress={() => router.push(`/chat/${chatPerson.nodeId}`)}>
          Message {chatPerson.name || (r.mine ? "volunteer" : "requester")}
        </Button>
      )}
      <ErrorNotice message={action.error} />

      {r.mine && !closed && (
        <View style={s.closeActions}>
          <Button secondary busy={action.busy} icon={false} onPress={completeRequest}>I no longer need help</Button>
          <TextButton onPress={() => {
            if (action.busy) return;
            Alert.alert("Cancel request?", "The cancellation will be shared when phones reconnect.", [
              { text: "Keep request", style: "cancel" },
              { text: "Cancel request", style: "destructive", onPress: () => action.run(() => b.cancelRequest(r.id)) },
            ]);
          }}>Cancel request</TextButton>
        </View>
      )}

      <View style={s.metadata}>
        <Disclosure title="Request info" open={showDelivery} onPress={() => setShowDelivery((shown) => !shown)} />
        {showDelivery && (
          <View style={s.delivery}>
            <Text style={styles.caption}>Created {formatTime(r.createdAt)} · Updated {formatTime(r.updatedAt)}</Text>
            {r.mine && <>
              <StatusLine complete title="Saved on this phone" />
              <StatusLine complete={r.transport === "forwarded" || r.transport === "received"} title={r.transport === "received" ? "Participant receipt received" : r.transport === "forwarded" ? "Passed to a relay" : "Waiting for a connection"} detail={r.transport === "received" ? "Receipt confirms delivery, not an offer of help." : r.transport === "forwarded" ? "No participant receipt yet." : undefined} />
              <StatusLine complete={r.seenCount > 0} title={r.seenCount > 0 ? `Seen by ${r.seenCount}` : "Not yet confirmed as seen"} />
            </>}
            <ErrorNotice message={receiptError} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  summary: { gap: 14, paddingVertical: 8 },
  requestTitle: { fontFamily: fonts.headline, fontSize: 40, lineHeight: 44, letterSpacing: -1.2, color: c.text },
  category: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24, color: c.secondary },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingTop: 8 },
  statusIcon: { paddingTop: 2 },
  statusCopy: { flex: 1, gap: 5 },
  statusTitle: { fontFamily: fonts.medium, fontSize: 18, lineHeight: 25, color: c.text },
  completed: { backgroundColor: c.text, borderRadius: 18, padding: 20 },
  darkText: { color: c.background },
  context: { gap: 14, paddingTop: 4 },
  locationSummary: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  waitingRow: { flexDirection: "row", gap: 12, paddingVertical: 16, alignItems: "center" },
  offers: { gap: 16 },
  offer: { gap: 12, borderBottomWidth: 1, borderBottomColor: c.border, paddingBottom: 18 },
  offerName: { fontFamily: fonts.medium, fontSize: 19, lineHeight: 26, color: c.text },
  closeActions: { gap: 2, paddingTop: 8 },
  disclosure: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  metadata: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 4 },
  delivery: { paddingVertical: 12, gap: 18 },
});
