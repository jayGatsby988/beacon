import { useCallback, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { ArrowUp, ChevronDown, ChevronUp, MessageCircle, Phone } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  ErrorNotice,
  TopBar,
  age,
  formatTime,
  styles as shared,
  useAction,
} from "../../src/components/ui";
import { colors as c, fonts } from "../../src/theme/tokens";
import { deliveryLabel, initials } from "../../src/ui/inbox";
import type { BeaconState, DirectMessageView } from "../../src/ui/types";

export default function Chat() {
  const b = useBeacon();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  // A scope/peer change discards UI state and isolates pending send/read results.
  return <Conversation key={JSON.stringify([b.activeGroupId, id])} b={b} id={id} />;
}

function Conversation({ b, id }: { b: BeaconState; id: string | undefined }) {
  const person = b.people.find(
    (p) => p.nodeId === id && p.scope === b.activeGroupId,
  );
  const messages = (person ? b.messages : [])
    .filter((m) => m.peerId === id)
    .sort((a, z) => a.createdAt - z.createdAt || a.id.localeCompare(z.id));
  const [draft, setDraft] = useState("");
  const [readError, setReadError] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const action = useAction();
  const callAction = useAction();
  const list = useRef<FlatList<DirectMessageView>>(null);
  const insets = useSafeAreaInsets();
  const unread = person?.unreadCount ?? 0;
  const markRead = b.markChatRead;
  const currentScopePerson = !!person;
  useFocusEffect(
    useCallback(() => {
      if (!id || !currentScopePerson) return;
      let active = true;
      void markRead(id)
        .then(() => {
          if (active) setReadError(undefined);
        })
        .catch((error: unknown) => {
          if (active)
            setReadError(
              error instanceof Error
                ? error.message
                : "Could not update this chat.",
            );
        });
      return () => {
        active = false;
      };
    }, [id, unread, markRead, currentScopePerson]),
  );
  const send = () => {
    const text = draft.trim();
    if (!id || !person || !text || action.busy) return;
    void action.run(async () => {
      await b.sendText(id, text);
      setDraft("");
    });
  };
  const name = person?.name || "Conversation";
  const canCall =
    !!person?.connected && b.callSupported && !b.call && !callAction.busy;
  const callHint = !b.callSupported
    ? b.callSupportReason || "Calls require a supported iPhone build."
    : !person?.connected
      ? "Connect to this person nearby to call."
      : b.call
        ? "Finish the current call first."
        : "Bluetooth call";
  return (
    <SafeAreaView style={s.page} edges={["top", "left", "right"]}>
      <TopBar back title={name} />
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={s.header}>
          <View style={s.personRow}>
            <View style={s.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={s.initials}>{person ? initials(name) : "?"}</Text>
            </View>
            <View style={s.personName}>
              <Text style={s.connection}>
                {person ? person.connected ? "Connected nearby" : `Last seen ${age(person.lastSeenAt)}` : "Not in your current group"}
              </Text>
              <Text style={s.callHint}>
                {person ? person.connected ? "Direct Bluetooth messages" : "Messages queue until you reconnect." : "Return to Messages to find a conversation."}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Conversation options"
            accessibilityState={{ expanded: detailsOpen }}
            onPress={() => setDetailsOpen((open) => !open)}
            style={({ pressed }) => [s.detailsToggle, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.detailsLabel}>Conversation options</Text>
            {detailsOpen ? <ChevronUp size={16} color={c.muted} /> : <ChevronDown size={16} color={c.muted} />}
          </Pressable>
          {detailsOpen && <View style={s.details}>
            <Text style={s.callHint}>Queued messages are saved on this device. Received means the recipient’s device acknowledged the message. Expired messages are no longer sent.</Text>
            <View style={s.personRow}>
              <View style={s.personName}>
                <Text style={s.connection}>Experimental voice call</Text>
                <Text style={s.callHint}>{b.callSupported ? "iPhone only · Audio may not work reliably." : callHint}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call ${name}`}
                accessibilityHint={callHint}
                accessibilityState={{ disabled: !canCall, busy: callAction.busy }}
                disabled={!canCall}
                onPress={() => {
                  if (id && canCall) void callAction.run(() => b.startCall(id));
                }}
                style={({ pressed }) => [s.call, !canCall && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
              >
                <Phone color={c.secondary} size={18} /><Text style={s.callLabel}>Call</Text>
              </Pressable>
            </View>
            {b.callSupported && (!person?.connected || b.call) && <Text style={s.callHint}>{callHint}</Text>}
          </View>}
        </View>
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(message) => message.id}
          style={s.flex}
          contentContainerStyle={s.messages}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() =>
            list.current?.scrollToEnd({ animated: false })
          }
          onLayout={() => list.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><MessageCircle size={25} color={c.muted} /></View>
              <Text style={s.emptyTitle}>{person ? "Start a conversation" : "Conversation unavailable"}</Text>
              <Text style={s.emptyDetail}>{person ? "Keep in touch with a short message. Text sends directly when you’re connected nearby." : "This person is not in your current group."}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={[s.message, item.mine ? s.mine : s.theirs]}
              accessible
              accessibilityLabel={`${item.mine ? "You" : name}: ${item.text}. ${formatTime(item.createdAt)}${item.mine ? `. ${deliveryLabel(item.status)}` : ""}`}
            >
              <Text selectable style={s.messageText}>
                {item.text}
              </Text>
              <Text style={s.messageMeta}>
                {formatTime(item.createdAt)}
                {item.mine
                  ? ` · ${deliveryLabel(item.status)}`
                  : ""}
              </Text>
            </View>
          )}
        />
        <View
          style={[
            s.composerArea,
            { paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <ErrorNotice
            message={callAction.error || action.error || readError}
          />
          <View style={s.composer}>
            <TextInput
              accessibilityLabel="Message"
              placeholder={person ? `Message ${name}` : "Conversation unavailable"}
              placeholderTextColor={c.muted}
              value={draft}
              onChangeText={setDraft}
              editable={!action.busy && !!person}
              multiline
              maxLength={500}
              textAlignVertical="top"
              selectionColor={c.redLabel}
              style={s.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                action.busy ? "Saving message" : "Send message"
              }
              accessibilityState={{
                disabled: action.busy || !draft.trim() || !person,
                busy: action.busy,
              }}
              disabled={action.busy || !draft.trim() || !person}
              onPress={send}
              style={({ pressed }) => [
                s.send,
                (action.busy || !draft.trim() || !person) && { opacity: 0.4 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <ArrowUp color={c.onAction} size={25} />
            </Pressable>
          </View>
          {draft.length >= 450 && (
            <Text style={[shared.caption, { textAlign: "right" }]}>
              {draft.length}/500
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.background },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 12,
    gap: 4,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  personRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  personName: { flex: 1, gap: 3 },
  avatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: fonts.medium, fontSize: 15, color: c.secondary },
  connection: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: c.secondary },
  detailsToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  detailsLabel: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: c.muted },
  details: { gap: 16, backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.border },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 36 },
  emptyIcon: { width: 56, height: 56, backgroundColor: c.card, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: fonts.medium, color: c.text, fontSize: 17, textAlign: "center" },
  emptyDetail: { fontFamily: fonts.body, color: c.muted, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 300 },
  call: {
    minWidth: 88,
    minHeight: 44,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  callLabel: { fontFamily: fonts.medium, fontSize: 14, color: c.text },
  callHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: c.secondary,
  },
  messages: {
    flexGrow: 1,
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 18,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  message: {
    maxWidth: "88%",
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 16,
    gap: 8,
  },
  mine: {
    alignSelf: "flex-end",
    backgroundColor: c.raised,
    borderBottomRightRadius: 5,
  },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: c.card,
    borderColor: c.border,
    borderWidth: 1,
    borderBottomLeftRadius: 5,
  },
  messageText: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: c.text,
  },
  messageMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: c.secondary,
    textAlign: "right",
  },
  composerArea: {
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  input: {
    flex: 1,
    minHeight: 52,
    maxHeight: 140,
    paddingHorizontal: 15,
    paddingTop: 14,
    paddingBottom: 14,
    color: c.text,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 16,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 22,
  },
  send: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: c.raised,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
});
