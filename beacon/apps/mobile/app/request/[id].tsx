import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Check, ChevronDown, ChevronUp, Clock, Radio, HeartHandshake, MapPin } from "lucide-react-native";
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
      style={({ pressed }) => [s.disclosure, pressed && s.pressed]}
    >
      <Text style={s.disclosureTitle}>{title}</Text>
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
  const chatNodeId = r.status === "accepted" && accepted
    ? r.mine ? accepted.nodeId : accepted.nodeId === b.nodeId ? r.originNodeId : undefined
    : undefined;
  const chatPerson = chatNodeId
    ? b.people.find((person) => person.nodeId === chatNodeId && person.scope === b.activeGroupId && person.scope === (r.groupId ?? null))
    : undefined;
  const chatName = chatPerson?.name || (r.mine ? accepted?.name : r.name) || "this person";
  const canOffer = !r.mine && r.status === "active" && !myOffer && !r.acceptedOfferId;
  const hasCoordinates = r.location.latitude != null && r.location.longitude != null;
  const audience = r.groupId
    ? b.groups.find((group) => group.id === r.groupId)?.name || "Private group"
    : "Everyone nearby";
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
        : r.mine && r.transport === "received"
          ? "A participant saved the request. This is not a promise of help."
          : myOffer
            ? "Your offer is saved."
            : undefined;
  const savedLocally = r.mine && r.status === "active" && !accepted && !["forwarded", "received"].includes(r.transport);
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
      <View style={s.pageHeading}>
        <Heading size={34}>{r.mine ? "Your SOS" : "Help request"}</Heading>
        <Body muted>{r.mine ? `To: ${audience}` : `${r.name || "Participant"} · To: ${audience}`}</Body>
      </View>
      <View style={s.summary}>
        <View style={s.statusRow}>
          <View style={s.statusIcon}>
            {r.status === "completed" ? <Check size={27} color={c.text} /> : accepted ? <HeartHandshake size={27} color={c.text} /> : savedLocally ? <Clock size={27} color={c.text} /> : <Radio size={27} color={c.text} />}
          </View>
          <View style={s.flexDetails}>
            <Text style={s.statusTitle} accessibilityLiveRegion="polite">{savedLocally ? "Saved on this phone" : status}</Text>
            {savedLocally ? <Text style={styles.caption}>Waiting for another phone to connect. Keep Beacon open.</Text> : statusDetail ? <Text style={styles.caption}>{statusDetail}</Text> : null}
          </View>
        </View>
        {!r.mine && <Text style={styles.caption}>{categoryNames[r.category]} · Created {formatTime(r.createdAt)}</Text>}
        {!!r.note && <Body>{r.note}</Body>}
        {r.pendingUpdate && <Text style={styles.caption}>Update waiting to be shared. Others may still see the old request.</Text>}
      </View>

      {r.mine && !closed && (
        <View style={s.section}>
          <Heading size={22}>Help offers{r.status === "active" && r.offers.length > 0 ? ` · ${r.offers.length}` : ""}</Heading>
          {!accepted && r.status === "active" && r.offers.length === 0 && (
            <View style={s.offerDetails}>
              <Text style={styles.smallTitle}>No offers yet.</Text>
              <Text style={styles.caption}>Offers will appear here.</Text>
            </View>
          )}
          {r.status === "active" && !r.acceptedOfferId && r.offers.map((offer) => (
            <View key={offer.id} style={s.offer}>
              <View style={s.offerDetails}>
                <Text style={styles.smallTitle}>{offer.name || "Participant"}</Text>
                <Text style={styles.caption}>{formatTime(offer.createdAt)}</Text>
              </View>
              {!!offer.note && <Body>{offer.note}</Body>}
              <Button secondary icon={false} busy={action.busy} onPress={() => action.run(() => b.acceptOffer(r.id, offer.id))}>
                Accept {offer.name || "help"}
              </Button>
            </View>
          ))}
          {accepted && (
            <View style={s.offer}>
              <Text style={styles.smallTitle}>{accepted.name || "Volunteer"}</Text>
              <Text style={styles.caption}>{accepted.assignmentReceived ? "Volunteer confirmed" : "Offer accepted · waiting for confirmation"}</Text>
              {!!accepted.note && <Body>{accepted.note}</Body>}
            </View>
          )}
          {r.status === "accepted" && !accepted && <Body muted>Offer accepted. Waiting for offer details on this phone.</Body>}
        </View>
      )}

      {!r.mine && !closed && (accepted || myOffer) && (
        <View style={s.section}>
          <Heading size={22}>{accepted?.nodeId === b.nodeId || (!accepted && myOffer) ? "Your offer" : "Accepted offer"}</Heading>
          <View style={s.offer}>
            <Text style={styles.smallTitle}>{accepted?.name || myOffer?.name || "Volunteer"}</Text>
            <Text style={styles.caption}>{accepted ? accepted.assignmentReceived ? "Volunteer confirmed" : "Offer accepted · waiting for confirmation" : "Offer saved · awaiting acceptance"}</Text>
            {!!(accepted?.note || myOffer?.note) && <Body>{accepted?.note || myOffer?.note}</Body>}
          </View>
        </View>
      )}

      {canOffer && (
        <View style={s.section}>
          <Heading size={22}>Offer help</Heading>
          <Button
            secondary
            icon={false}
            busy={action.busy}
            onPress={() =>
              action.run(() => b.offerHelp(r.id, note.trim() || undefined))
            }
          >
            Offer help
          </Button>
          <Disclosure title={note ? "Offer note" : "Add a note"} open={showNote} onPress={() => setShowNote((shown) => !shown)} />
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

      {chatNodeId && (
        <View style={s.section}>
          {chatPerson ? (
            <>
              <Button secondary icon={false} onPress={() => router.push(`/chat/${chatPerson.nodeId}`)}>
                Message {chatName}
              </Button>
              {!chatPerson.connected && <Text style={styles.caption}>Messages stay queued until you reconnect nearby.</Text>}
            </>
          ) : <Text style={styles.caption}>Connect with {chatName} nearby to start a chat.</Text>}
        </View>
      )}

      <View style={s.section}>
        <Heading size={22}>Reported location</Heading>
        <View style={s.locationSummary}>
          <MapPin size={20} color={c.secondary} />
          <View style={s.flexDetails}>
            <Text selectable style={styles.smallTitle}>{r.location.place || (hasCoordinates ? `${r.location.latitude!.toFixed(5)}, ${r.location.longitude!.toFixed(5)}` : "No location was shared.")}</Text>
            {(hasCoordinates || r.location.capturedAt != null) && <Text style={styles.caption}>{formatReportTime(r.location.capturedAt)} · Not live{r.location.accuracy != null ? ` · ±${Math.round(r.location.accuracy)} m` : ""}</Text>}
          </View>
        </View>
      </View>

      {(hasCoordinates || r.mine) && (
        <View style={s.disclosures}>
          {hasCoordinates && (
            <View style={s.disclosureSection}>
              <Disclosure title="Location map" open={showMap} onPress={() => setShowMap((shown) => !shown)} />
              {showMap && <View style={s.disclosureContent}><LocationCard location={r.location} map={b.map} /></View>}
            </View>
          )}
          {r.mine && (
            <View style={s.disclosureSection}>
              <Disclosure title="Delivery details" open={showDelivery} onPress={() => setShowDelivery((shown) => !shown)} />
              {showDelivery && (
                <View style={s.delivery}>
                  <StatusLine complete title="Saved on this phone" detail={`Created ${formatTime(r.createdAt)} · Updated ${formatTime(r.updatedAt)}`} />
                  <StatusLine complete={r.transport === "forwarded" || r.transport === "received"} title={r.transport === "received" ? "Participant receipt received" : r.transport === "forwarded" ? "Passed to a relay" : "Waiting for a connection"} detail={r.transport === "received" ? "A participant saved the request. This is not a promise of help." : r.transport === "forwarded" ? "No participant receipt yet." : "Ready to share when another phone connects."} />
                  <StatusLine complete={r.seenCount > 0} title={r.seenCount > 0 ? `Seen by ${r.seenCount}` : "No view confirmation yet"} />
                </View>
              )}
            </View>
          )}
        </View>
      )}
      <ErrorNotice message={action.error || receiptError} />
      {r.mine && !closed && (
        <View style={s.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="I no longer need help" accessibilityState={{ disabled: action.busy, busy: action.busy }} disabled={action.busy} onPress={completeRequest} style={({ pressed }) => [s.completeButton, (pressed || action.busy) && s.pressed]}>
            <Text style={s.completeLabel}>I no longer need help</Text>
            {action.busy && <ActivityIndicator color={c.text} />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel request"
            accessibilityState={{ disabled: action.busy }}
            disabled={action.busy}
            style={({ pressed }) => [s.cancelButton, (pressed || action.busy) && s.pressed]}
            onPress={() => {
              if (action.busy) return;
              Alert.alert(
                "Cancel request?",
                "The cancellation will be shared when phones connect. Others may still see the request until then.",
                [
                  { text: "Keep request", style: "cancel" },
                  { text: "Cancel request", style: "destructive", onPress: () => action.run(() => b.cancelRequest(r.id)) },
                ],
              );
            }}
          >
            <Text style={s.cancelLabel}>Cancel request</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  pageHeading: { gap: 8 },
  summary: { gap: 14, paddingBottom: 24, borderBottomWidth: 1, borderColor: c.border },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  statusIcon: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  flexDetails: { flex: 1, gap: 5 },
  statusTitle: { fontFamily: fonts.medium, fontSize: 20, lineHeight: 27, color: c.text },
  section: { gap: 16 },
  offer: { gap: 12, paddingBottom: 16, borderBottomWidth: 1, borderColor: c.border },
  offerDetails: { gap: 5 },
  locationSummary: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  disclosures: { borderBottomWidth: 1, borderColor: c.border },
  disclosureSection: { borderTopWidth: 1, borderColor: c.border },
  disclosure: { minHeight: 56, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  disclosureTitle: { fontFamily: fonts.medium, color: c.text, fontSize: 16, lineHeight: 23, flex: 1 },
  disclosureContent: { paddingBottom: 16 },
  delivery: { paddingTop: 6, paddingBottom: 20, gap: 18 },
  actions: { gap: 6 },
  completeButton: { minHeight: 56, paddingHorizontal: 18, paddingVertical: 15, borderWidth: 1, borderColor: c.text, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  completeLabel: { fontFamily: fonts.medium, color: c.text, fontSize: 16, lineHeight: 23, textAlign: "center", flexShrink: 1 },
  cancelButton: { minHeight: 48, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  cancelLabel: { fontFamily: fonts.medium, color: c.red, fontSize: 15, lineHeight: 22, textAlign: "center" },
  pressed: { opacity: 0.6 },
});
