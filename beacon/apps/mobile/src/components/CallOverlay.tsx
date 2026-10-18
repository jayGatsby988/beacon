import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react-native";
import { useBeacon } from "../services/BeaconContext";
import type { BeaconState, CallView } from "../ui/types";
import { colors as c, fonts } from "../theme/tokens";
import { Body, ErrorNotice, Heading, useAction } from "./ui";

type CallControls = Pick<
  BeaconState,
  | "acceptCall"
  | "declineCall"
  | "endCall"
  | "setCallMuted"
  | "setCallSpeaker"
  | "dismissCall"
>;

/** The service owns call state; this clock never implies a connected call. */
function ElapsedClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return (
    <Text
      accessibilityLabel={`Call duration, ${minutes} minutes ${seconds} seconds`}
      style={s.clock}
    >
      {`${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`}
    </Text>
  );
}

function CallSession({
  call,
  controls,
}: {
  call: CallView;
  controls: CallControls;
}) {
  const answerAction = useAction();
  const controlAction = useAction();
  const endAction = useAction();
  const dismissAction = useAction();
  const terminal = call.status === "ended" || call.status === "failed";
  // Ending audio is immediate; sending the remote end signal may still be
  // pending. That cleanup must not prevent leaving an already ended call.
  const closeAction = terminal ? dismissAction : endAction;
  const incoming = call.status === "ringing" && call.direction === "incoming";
  const active = call.status === "active";
  const status =
    call.status === "failed"
      ? "Call failed"
      : call.status === "ended"
        ? "Call ended"
        : active
          ? "Connected"
          : call.status === "connecting"
            ? "Connecting…"
            : incoming
              ? "Incoming call"
              : "Calling…";
  return (
    <Modal
      visible
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        if (terminal) void dismissAction.run(() => controls.dismissCall(call.id));
      }}
    >
      <SafeAreaView style={s.page} edges={["top", "bottom", "left", "right"]}>
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.identity}>
            <View
              style={s.avatar}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {terminal ? (
                <PhoneOff color={c.secondary} size={32} />
              ) : (
                <Phone color={c.text} size={32} />
              )}
            </View>
            <Heading size={30}>{call.peerName || "Nearby participant"}</Heading>
            <Text style={s.subtitle}>Bluetooth call</Text>
            <Text accessibilityLiveRegion="polite" style={s.status}>
              {status}
            </Text>
            {active &&
              call.startedAt != null &&
              Number.isFinite(call.startedAt) && (
                <ElapsedClock startedAt={call.startedAt} />
              )}
            {!!call.reason && (
              <Body muted style={s.reason}>
                {call.reason}
              </Body>
            )}
          </View>
          <View style={s.actions}>
            {active && (
              <View style={s.controlRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    call.muted ? "Unmute microphone" : "Mute microphone"
                  }
                  accessibilityState={{
                    selected: call.muted,
                    disabled: controlAction.busy,
                  }}
                  disabled={controlAction.busy}
                  onPress={() =>
                    void controlAction.run(() =>
                      controls.setCallMuted(call.id, !call.muted),
                    )
                  }
                  style={({ pressed }) => [
                    s.toggle,
                    call.muted && s.selectedToggle,
                    pressed && s.pressed,
                  ]}
                >
                  {call.muted ? (
                    <MicOff size={24} color={c.background} />
                  ) : (
                    <Mic size={24} color={c.text} />
                  )}
                  <Text style={[s.toggleText, call.muted && s.selectedText]}>
                    {call.muted ? "Unmute" : "Mute"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    call.speaker ? "Turn speaker off" : "Turn speaker on"
                  }
                  accessibilityState={{
                    selected: call.speaker,
                    disabled: controlAction.busy,
                  }}
                  disabled={controlAction.busy}
                  onPress={() =>
                    void controlAction.run(() =>
                      controls.setCallSpeaker(call.id, !call.speaker),
                    )
                  }
                  style={({ pressed }) => [
                    s.toggle,
                    call.speaker && s.selectedToggle,
                    pressed && s.pressed,
                  ]}
                >
                  <Volume2
                    size={24}
                    color={call.speaker ? c.background : c.text}
                  />
                  <Text style={[s.toggleText, call.speaker && s.selectedText]}>
                    Speaker
                  </Text>
                </Pressable>
              </View>
            )}
            <ErrorNotice
              message={
                dismissAction.error ||
                endAction.error ||
                answerAction.error ||
                controlAction.error
              }
            />
            {incoming && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Accept Bluetooth call"
                accessibilityState={{
                  disabled: answerAction.busy || endAction.busy,
                  busy: answerAction.busy,
                }}
                disabled={answerAction.busy || endAction.busy}
                onPress={() =>
                  void answerAction.run(() => controls.acceptCall(call.id))
                }
                style={({ pressed }) => [
                  s.action,
                  s.accept,
                  pressed && s.pressed,
                ]}
              >
                <Phone color={c.background} size={23} />
                <Text style={[s.actionText, s.selectedText]}>
                  {answerAction.busy ? "Accepting…" : "Accept"}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                terminal
                  ? "Dismiss call"
                  : incoming
                    ? "Decline Bluetooth call"
                    : "End Bluetooth call"
              }
              accessibilityState={{
                disabled: closeAction.busy,
                busy: closeAction.busy,
              }}
              disabled={closeAction.busy}
              onPress={() =>
                void closeAction.run(() =>
                  terminal
                    ? controls.dismissCall(call.id)
                    : incoming
                      ? controls.declineCall(call.id)
                      : controls.endCall(call.id),
                )
              }
              style={({ pressed }) => [
                s.action,
                terminal ? s.dismiss : s.end,
                closeAction.busy && { opacity: 0.6 },
                pressed && s.pressed,
              ]}
            >
              {!terminal && <PhoneOff color={c.onAction} size={23} />}
              <Text
                style={[
                  s.actionText,
                  { color: terminal ? c.text : c.onAction },
                ]}
              >
                {closeAction.busy
                  ? terminal
                    ? "Closing…"
                    : "Ending…"
                  : terminal
                    ? "Done"
                    : incoming
                      ? "Decline"
                      : "End call"}
              </Text>
            </Pressable>
            {call.status === "ringing" && (
              <Text style={s.footnote}>Keep Beacon open.</Text>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** Mount once inside BeaconProvider, alongside the root navigator. */
export default function CallOverlay() {
  const b = useBeacon();
  return b.call ? (
    <CallSession key={b.call.id} call={b.call} controls={b} />
  ) : null;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.background },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 24,
    gap: 48,
    justifyContent: "space-between",
  },
  identity: { alignItems: "center", gap: 14 },
  avatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: c.secondary,
  },
  status: {
    fontFamily: fonts.medium,
    fontSize: 20,
    lineHeight: 28,
    color: c.text,
    textAlign: "center",
    marginTop: 8,
  },
  clock: {
    fontFamily: fonts.body,
    fontSize: 28,
    lineHeight: 36,
    fontVariant: ["tabular-nums"],
    color: c.text,
  },
  reason: { textAlign: "center", fontSize: 15, lineHeight: 23 },
  actions: { gap: 14 },
  controlRow: { flexDirection: "row", gap: 14 },
  toggle: {
    flex: 1,
    minHeight: 88,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  selectedToggle: { backgroundColor: c.text, borderColor: c.text },
  toggleText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 23,
    color: c.text,
    textAlign: "center",
  },
  selectedText: { color: c.background },
  action: {
    minHeight: 60,
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  actionText: {
    fontFamily: fonts.medium,
    fontSize: 18,
    lineHeight: 26,
    color: c.text,
    flexShrink: 1,
    textAlign: "center",
  },
  accept: { backgroundColor: c.text },
  end: { backgroundColor: c.red },
  dismiss: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  footnote: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
    textAlign: "center",
    marginTop: 4,
  },
  pressed: { opacity: 0.7 },
});
