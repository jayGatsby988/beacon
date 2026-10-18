import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Check, ChevronDown, ChevronUp } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  Body,
  Button,
  ErrorNotice,
  Field,
  formatTime,
  Heading,
  Screen,
  TextButton,
  useAction,
  styles,
} from "../../src/components/ui";
import { categoryNames, requestStatus } from "../../src/components/RequestCard";
import { LocationCard } from "../../src/components/LocationCard";
import { colors as c } from "../../src/theme/tokens";

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
  const [showOptions, setShowOptions] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string>();
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
  const canOffer = !r.mine && !closed && !myOffer && !accepted;
  const selectedOffer =
    r.offers.find((offer) => offer.id === selectedOfferId) ?? r.offers[0];
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
      <View style={{ gap: 8 }}>
        <Heading>{categoryNames[r.category]}</Heading>
        <Text style={styles.caption}>
          {r.mine ? "You" : r.name || "Participant"} · {formatTime(r.createdAt)}
        </Text>
        <Text style={styles.smallTitle} accessibilityLiveRegion="polite">
          {status}
        </Text>
        {statusDetail && <Text style={styles.caption}>{statusDetail}</Text>}
        {r.pendingUpdate && (
          <Text style={styles.caption}>
            Update waiting to be shared. Others may still see the old request.
          </Text>
        )}
        {!!r.note && <Body>{r.note}</Body>}
      </View>

      {canOffer && (
        <View style={{ gap: 4 }}>
          <Button
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

      {!closed && r.mine && !accepted && r.offers.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={styles.smallTitle}>Offers · {r.offers.length}</Text>
          {r.offers.map((offer) => {
            const selected = selectedOffer?.id === offer.id;
            return (
              <Pressable
                key={offer.id}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: selected,
                  disabled: action.busy,
                }}
                accessibilityLabel={`${offer.name || "Participant"}${offer.note ? `. ${offer.note}` : ""}`}
                disabled={action.busy}
                onPress={() => setSelectedOfferId(offer.id)}
                style={[
                  styles.card,
                  {
                    padding: 14,
                    minHeight: 48,
                    gap: 6,
                    borderColor: selected ? c.text : c.border,
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <Text style={[styles.smallTitle, { flex: 1 }]}>
                    {offer.name || "Participant"}
                  </Text>
                  {selected && <Check size={20} color={c.text} />}
                </View>
                {!!offer.note && <Body>{offer.note}</Body>}
                <Text style={styles.caption}>
                  {formatTime(offer.createdAt)}
                </Text>
              </Pressable>
            );
          })}
          <Button
            busy={action.busy}
            onPress={() =>
              selectedOffer &&
              action.run(() => b.acceptOffer(r.id, selectedOffer.id))
            }
          >
            Accept offer
          </Button>
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
          <Disclosure
            title="Request options"
            open={showOptions}
            onPress={() => setShowOptions((shown) => !shown)}
          />
          {showOptions && (
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
          )}
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
            <Text style={styles.caption}>
              {r.transport === "received"
                ? "A participant saved this request. This is not a promise of help."
                : r.transport === "forwarded"
                  ? "Passed to a relay. No participant receipt yet."
                  : "Saved on this phone. Waiting for another phone to connect."}
              {r.seenCount > 0 ? ` Seen by ${r.seenCount}.` : ""}
            </Text>
          )}
        </View>
      )}
      <ErrorNotice message={action.error || receiptError} />
      <LocationCard location={r.location} map={b.map} />
    </Screen>
  );
}
