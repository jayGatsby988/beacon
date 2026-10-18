import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  Body,
  Button,
  Card,
  ErrorNotice,
  Field,
  formatTime,
  Heading,
  Label,
  Screen,
  StatusLine,
  TextButton,
  useAction,
  styles,
} from "../../src/components/ui";
import { categoryNames, statusNames } from "../../src/components/RequestCard";
import { LocationCard } from "../../src/components/LocationCard";
import { colors as c } from "../../src/theme/tokens";

export default function RequestDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const b = useBeacon();
  const r = b.requests.find((request) => request.id === id);
  const action = useAction();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
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
        <Button secondary onPress={() => router.replace("/(tabs)/nearby")}>
          Back to requests
        </Button>
      </Screen>
    );
  const closed = ["completed", "canceled", "expired"].includes(r.status);
  const myOffer = r.offers.find((offer) => offer.nodeId === b.nodeId);
  const accepted = r.offers.find((offer) => offer.id === r.acceptedOfferId);
  const canOffer = !r.mine && !closed && !myOffer && !accepted;
  const offers = [...r.offers].sort(
    (a, b) => Number(b.accepted) - Number(a.accepted),
  );
  return (
    <Screen back title={r.mine ? "Your request" : "Request"}>
      <View style={{ gap: 6 }}>
        <Heading>{categoryNames[r.category]}</Heading>
        <Text style={styles.caption}>
          {r.mine ? "You" : r.name || "Participant"} · {formatTime(r.createdAt)}
        </Text>
        {!r.mine && closed && (
          <Text style={styles.smallTitle}>{statusNames[r.status]}</Text>
        )}
        {!!r.note && <Body>{r.note}</Body>}
      </View>

      {r.mine && (
        <Card style={{ padding: 16, gap: 10 }}>
          <StatusLine
            complete={
              r.status === "completed" ||
              r.status === "canceled" ||
              r.transport === "received"
            }
            title={
              closed
                ? statusNames[r.status]
                : r.transport === "received"
                  ? "Received by a participant"
                  : r.transport === "forwarded"
                    ? "Passed to a relay"
                    : "Waiting for a connection"
            }
            detail={
              closed || r.transport === "received"
                ? undefined
                : r.transport === "forwarded"
                  ? "Not yet received by a participant."
                  : "Saved on this phone."
            }
          />
        </Card>
      )}

      {canOffer && (
        <View style={{ gap: 6 }}>
          <Button
            busy={action.busy}
            onPress={() =>
              action.run(() => b.offerHelp(r.id, note.trim() || undefined))
            }
          >
            Offer help
          </Button>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showNote }}
            onPress={() => setShowNote((shown) => !shown)}
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Text style={styles.textButtonText}>
              {showNote ? "Hide note" : note ? "Edit offer note" : "Add a note"}
            </Text>
            {showNote ? (
              <ChevronUp color={c.secondary} size={20} />
            ) : (
              <ChevronDown color={c.secondary} size={20} />
            )}
          </Pressable>
          {showNote && (
            <Field
              label="Offer note · optional"
              value={note}
              onChangeText={setNote}
              maxLength={140}
              multiline
              style={{ minHeight: 80 }}
            />
          )}
        </View>
      )}

      {!closed && (
        <View style={{ gap: 10 }}>
          {offers.length > 0 ? (
            <Label>Offers · {offers.length}</Label>
          ) : r.mine ? (
            <Body muted>No offers yet.</Body>
          ) : null}
          {offers.map((offer, index) => (
            <Card key={offer.id} style={{ gap: 10, padding: 16 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Text style={[styles.smallTitle, { flex: 1 }]}>
                  {offer.nodeId === b.nodeId ? "Your offer" : offer.name}
                </Text>
                <Text style={styles.caption}>
                  {formatTime(offer.createdAt)}
                </Text>
              </View>
              {!!offer.note && <Body>{offer.note}</Body>}
              {offer.accepted ? (
                <StatusLine
                  complete={offer.assignmentReceived}
                  title={
                    offer.assignmentReceived
                      ? "Volunteer confirmed"
                      : "Offer accepted"
                  }
                  detail={
                    offer.assignmentReceived
                      ? undefined
                      : "Waiting for volunteer confirmation."
                  }
                />
              ) : r.mine && !accepted ? (
                <Button
                  secondary={index !== 0}
                  busy={action.busy}
                  onPress={() =>
                    action.run(() => b.acceptOffer(r.id, offer.id))
                  }
                >
                  Accept offer
                </Button>
              ) : (
                <Text style={styles.caption}>
                  {accepted
                    ? "Another offer was selected."
                    : "Waiting for acceptance."}
                </Text>
              )}
            </Card>
          ))}
        </View>
      )}

      {r.mine && !closed && (
        <View style={{ gap: 2 }}>
          <Button
            secondary
            busy={action.busy}
            onPress={() =>
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
              )
            }
          >
            I no longer need help
          </Button>
          <TextButton
            onPress={() =>
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
              )
            }
          >
            Cancel request
          </TextButton>
        </View>
      )}

      {r.pendingUpdate && (
        <Text style={styles.caption}>
          Update waiting to be shared. Others may still see the old request.
        </Text>
      )}
      <ErrorNotice message={action.error || receiptError} />
      <LocationCard location={r.location} map={b.map} />
    </Screen>
  );
}
