import { useState } from "react";
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
  const [seenRequestId, setSeenRequestId] = useState<string>();
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
              r.transport === "received"
                ? `${r.recipientCount} ${r.recipientCount === 1 ? "participant" : "participants"} confirmed saving the request.`
                : r.transport === "forwarded"
                  ? "Forwarded; no recipient receipt recorded."
                  : closed
                    ? "Saved on this phone; no recipient receipt recorded."
                    : "Saved on this phone."
            }
          />
          {r.seenCount > 0 && (
            <Text style={styles.caption}>
              Seen by {r.seenCount}{" "}
              {r.seenCount === 1 ? "participant" : "participants"}.
            </Text>
          )}
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
                      : "Offer accepted · awaiting volunteer receipt"
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
                    : "Awaiting requester acceptance."}
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

      {!r.mine && !closed ? (
        seenRequestId === r.id ? (
          <Text style={styles.caption}>Seen acknowledgment saved.</Text>
        ) : (
          <TextButton
            onPress={() =>
              action.run(async () => {
                await b.markSeen(r.id);
                setSeenRequestId(r.id);
              })
            }
          >
            Mark as seen
          </TextButton>
        )
      ) : null}
      {r.pendingUpdate && (
        <Text style={styles.caption}>
          Latest update saved here; other phones may still show an earlier
          state.
        </Text>
      )}
      <ErrorNotice message={action.error} />
      <LocationCard location={r.location} map={b.map} />
      <View style={{ gap: 2 }}>
        <Text style={styles.caption}>
          Updated {formatTime(r.updatedAt)} · {r.id.slice(0, 8).toUpperCase()}
        </Text>
        <TextButton onPress={() => router.push("/history")}>
          Recorded history
        </TextButton>
      </View>
    </Screen>
  );
}
