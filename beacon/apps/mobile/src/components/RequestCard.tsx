import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ChevronDown, ChevronUp, MapPin } from "lucide-react-native";
import { router } from "expo-router";
import type { RequestView } from "../ui/types";
import { formatReportTime, ErrorNotice, styles, useAction } from "./ui";
import { LocationCard } from "./LocationCard";
import { useBeacon } from "../services/BeaconContext";
import { colors as c, fonts } from "../theme/tokens";

export const categoryNames = {
  other: "Need help",
  injured: "Injured",
  trapped: "Trapped",
  stranded: "Stranded",
};
export const statusNames = {
  active: "Open request",
  accepted: "Help accepted",
  completed: "Completed",
  canceled: "Canceled",
  expired: "Expired",
};
export function requestStatus(request: RequestView): string {
  if (request.status === "accepted") {
    const accepted = request.offers.find(
      (offer) => offer.id === request.acceptedOfferId,
    );
    return accepted?.assignmentReceived
      ? "Volunteer confirmed"
      : "Offer accepted";
  }
  if (!request.mine || request.status !== "active")
    return statusNames[request.status];
  return request.transport === "received"
    ? "Received by a participant"
    : request.transport === "forwarded"
      ? "Passed to a relay"
      : "Waiting for a connection";
}
export function RequestCard({ request, showOffer = false }: { request: RequestView; showOffer?: boolean }) {
  const b = useBeacon();
  const action = useAction();
  const receiptAction = useAction();
  const seenRequests = useRef(new Set<string>());
  const [showLocation, setShowLocation] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 350 || fontScale >= 1.3;
  const closed = request.status === "completed" || request.status === "canceled" || request.status === "expired";
  const currentScope = (request.groupId ?? null) === b.activeGroupId;
  const myOffer = request.offers.find((offer) => offer.nodeId === b.nodeId);
  const accepted = request.offers.find((offer) => offer.id === request.acceptedOfferId);
  const canOffer = showOffer && currentScope && !request.mine && request.status === "active" && !request.acceptedOfferId && !myOffer;
  const canManage = request.mine && currentScope && !closed;
  const savedLocally = request.mine && request.status === "active" && !["forwarded", "received"].includes(request.transport);
  const status = myOffer && request.status === "active"
    ? "Offer saved · awaiting acceptance"
    : savedLocally ? "Saved on this phone" : requestStatus(request);
  const statusDetail = closed ? undefined
    : request.status === "accepted" && !accepted ? "Waiting for offer details."
    : request.status === "accepted" && accepted && !accepted.assignmentReceived ? "Waiting for confirmation."
    : request.mine && request.status === "active"
      ? request.transport === "received" ? "A receipt confirms it was saved, not that help is coming."
        : request.transport === "forwarded" ? "Waiting for a participant receipt."
        : "Waiting for a nearby connection. Keep Beacon open."
      : undefined;
  const name = request.name || "Participant";
  const chatNodeId = request.status === "accepted" && accepted
    ? request.mine ? accepted.nodeId : accepted.nodeId === b.nodeId ? request.originNodeId : undefined
    : undefined;
  const chatPerson = currentScope && chatNodeId
    ? b.people.find((person) => person.nodeId === chatNodeId && person.scope === b.activeGroupId)
    : undefined;
  const chatName = chatPerson?.name || (request.mine ? accepted?.name : name) || "this person";
  const hasLocation = !!request.location.place ||
    (Number.isFinite(request.location.latitude) && Number.isFinite(request.location.longitude));
  const markSeen = () => {
    if (request.mine || closed || !currentScope || receiptAction.busy || seenRequests.current.has(request.id)) return;
    seenRequests.current.add(request.id);
    void receiptAction.run(async () => {
      try {
        await b.markSeen(request.id);
      } catch (error) {
        seenRequests.current.delete(request.id);
        throw error;
      }
    });
  };
  const endSOS = () => {
    if (!canManage || action.busy) return;
    Alert.alert("End this SOS?", "The update will be shared when phones connect. Others may still see your SOS until then.", [
      { text: "I no longer need help", onPress: () => { void action.run(() => b.completeRequest(request.id)); } },
      { text: "Cancel request", style: "destructive", onPress: () => { void action.run(() => b.cancelRequest(request.id)); } },
      { text: "Keep open", style: "cancel" },
    ]);
  };
  return (
    <View style={s.card}>
      <View style={[s.row, canOffer && !stacked && s.sideBySide]}>
        <View style={s.details}>
          {!request.mine && <Text style={s.title}>{closed ? name : `${name} needs help`}</Text>}
          {(request.mine || myOffer || request.status !== "active") && <Text style={request.mine ? s.title : s.status} accessibilityLiveRegion="polite">{status}</Text>}
          {statusDetail && <Text style={styles.caption}>{statusDetail}</Text>}
          {request.category !== "other" && <Text style={styles.caption}>{categoryNames[request.category]}</Text>}
          {!!request.note && <Text style={s.note}>{request.note}</Text>}
          {closed && <Text style={styles.caption}>{formatReportTime(request.updatedAt)}</Text>}
        </View>
        {canOffer && <Pressable
          accessibilityRole="button" accessibilityLabel={`Offer help to ${name}`}
          accessibilityState={{ disabled: action.busy, busy: action.busy }} disabled={action.busy}
          onPress={() => { void action.run(async () => { await b.offerHelp(request.id); markSeen(); }); }}
          style={({ pressed }) => [s.action, !stacked && s.sideAction, (pressed || action.busy) && s.pressed]}
        ><Text style={s.actionText}>{action.busy ? "Saving offer…" : "Offer help"}</Text></Pressable>}
      </View>

      {canManage && request.status === "active" && !request.acceptedOfferId && (
        request.offers.length ? <View style={s.offers}>{request.offers.map((offer) => (
          <View key={offer.id} style={[s.offer, !stacked && s.sideBySide]}>
            <View style={s.details}>
              <Text style={s.offerName}>{offer.name || "Participant"}</Text>
              {!!offer.note && <Text style={s.note}>{offer.note}</Text>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Accept ${offer.name || "help"}`}
              accessibilityState={{ disabled: action.busy, busy: action.busy }} disabled={action.busy}
              onPress={() => { void action.run(() => b.acceptOffer(request.id, offer.id)); }}
              style={({ pressed }) => [s.action, !stacked && s.sideAction, (pressed || action.busy) && s.pressed]}
            ><Text style={s.actionText}>Accept {offer.name || "help"}</Text></Pressable>
          </View>
        ))}</View> : <Text style={styles.caption}>No offers yet.</Text>
      )}
      {!closed && accepted && <View style={s.details}>
        <Text style={s.offerName}>{accepted.nodeId === b.nodeId ? "Your offer" : accepted.name || "Volunteer"}</Text>
        {!!accepted.note && <Text style={s.note}>{accepted.note}</Text>}
      </View>}
      {chatNodeId && (chatPerson ? <View style={s.details}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Message ${chatName}`} onPress={() => { markSeen(); router.push(`/chat/${chatPerson.nodeId}`); }} style={({ pressed }) => [s.action, pressed && s.pressed]}>
          <Text style={s.actionText}>Message {chatName}</Text>
        </Pressable>
        {!chatPerson.connected && <Text style={styles.caption}>Messages stay queued until you reconnect nearby.</Text>}
      </View> : <Text style={styles.caption}>Connect with {chatName} nearby to message.</Text>)}
      {request.pendingUpdate && <Text style={styles.caption}>Update waiting to be shared. Others may still see the previous request.</Text>}
      {hasLocation && <View>
        <Pressable accessibilityRole="button" accessibilityLabel="Reported location" accessibilityState={{ expanded: showLocation }}
          onPress={() => { if (!showLocation) markSeen(); setShowLocation((shown) => !shown); }}
          style={({ pressed }) => [s.locationToggle, pressed && s.pressed]}>
          <MapPin color={c.secondary} size={17} />
          <Text style={s.locationLabel}>{request.location.place || "Reported location"}</Text>
          {showLocation ? <ChevronUp color={c.secondary} size={18} /> : <ChevronDown color={c.secondary} size={18} />}
        </Pressable>
        {showLocation && <LocationCard location={request.location} map={b.map} />}
      </View>}
      {canManage && <Pressable accessibilityRole="button" accessibilityLabel="End SOS"
        accessibilityState={{ disabled: action.busy, busy: action.busy }} disabled={action.busy}
        onPress={endSOS} style={({ pressed }) => [s.end, (pressed || action.busy) && s.pressed]}>
        <Text style={s.actionText}>End SOS</Text>
        {action.busy && <ActivityIndicator color={c.text} />}
      </Pressable>}
      <ErrorNotice message={action.error || receiptAction.error} />
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderBottomWidth: 1, borderColor: c.border, paddingVertical: 16, gap: 12 },
  row: { gap: 10 },
  sideBySide: { flexDirection: "row", alignItems: "center", gap: 16 },
  details: { flexShrink: 1, flexGrow: 1, minWidth: 0, gap: 5 },
  title: { fontFamily: fonts.medium, color: c.text, fontSize: 17, lineHeight: 24 },
  offerName: { fontFamily: fonts.medium, color: c.text, fontSize: 15, lineHeight: 22 },
  note: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.secondary },
  status: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: c.secondary },
  offers: { gap: 10 },
  offer: { gap: 8, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  action: { minHeight: 48, alignSelf: "flex-start", paddingVertical: 12, justifyContent: "center" },
  sideAction: { maxWidth: "45%", flexShrink: 1 },
  actionText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: c.text, flexShrink: 1 },
  locationToggle: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  locationLabel: { flex: 1, fontFamily: fonts.body, color: c.secondary, fontSize: 14, lineHeight: 21 },
  end: { minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  pressed: { opacity: 0.6 },
});
