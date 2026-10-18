import { useCallback, useEffect, useRef, useState } from "react";
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
import { ArrowUp, Phone } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  ErrorNotice,
  Heading,
  TopBar,
  age,
  formatTime,
  styles as shared,
  useAction,
} from "../../src/components/ui";
import { colors as c, fonts } from "../../src/theme/tokens";
import type { DirectMessageView } from "../../src/ui/types";

export default function Chat() {
  const b = useBeacon();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const person = b.people.find(
    (p) => p.nodeId === id && p.scope === b.activeGroupId,
  );
  const messages = b.messages
    .filter((m) => m.peerId === id)
    .sort((a, z) => a.createdAt - z.createdAt || a.id.localeCompare(z.id));
  const [draft, setDraft] = useState("");
  const [readError, setReadError] = useState<string>();
  const action = useAction();
  const callAction = useAction();
  const list = useRef<FlatList<DirectMessageView>>(null);
  const insets = useSafeAreaInsets();
  const unread = person?.unreadCount ?? 0;
  const markRead = b.markChatRead;
  const currentScopePerson = !!person;
  useEffect(() => {
    setDraft("");
    setReadError(undefined);
  }, [id, b.activeGroupId]);
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
      <TopBar back title="Message" />
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={s.header}>
          <View style={s.personRow}>
            <View style={s.personName}>
              <Heading>{name}</Heading>
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
              style={({ pressed }) => [
                s.call,
                !canCall && { opacity: 0.4 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Phone color={c.text} size={23} />
            </Pressable>
          </View>
          <Text style={shared.caption}>
            {person
              ? person.connected
                ? "Connected"
                : `Last seen ${age(person.lastSeenAt)}`
              : "This person is not in your current group."}
          </Text>
          {(!b.callSupported || !person?.connected) && (
            <Text style={s.callHint}>{callHint}</Text>
          )}
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
            <Text
              style={[
                shared.caption,
                { textAlign: "center", paddingVertical: 30 },
              ]}
            >
              Start a conversation.
            </Text>
          }
          renderItem={({ item }) => (
            <View
              style={[s.message, item.mine ? s.mine : s.theirs]}
              accessible
              accessibilityLabel={`${item.mine ? "You" : name}: ${item.text}. ${formatTime(item.createdAt)}${item.mine ? `. ${item.status === "received" ? "Received" : item.status === "expired" ? "Expired" : "Queued"}` : ""}`}
            >
              <Text selectable style={s.messageText}>
                {item.text}
              </Text>
              <Text style={s.messageMeta}>
                {formatTime(item.createdAt)}
                {item.mine
                  ? ` · ${item.status === "received" ? "Received" : item.status === "expired" ? "Expired" : "Queued"}`
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
              placeholder="Message"
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
    paddingTop: 8,
    paddingBottom: 18,
    gap: 6,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  personRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  personName: { flex: 1 },
  call: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
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
    borderRadius: 18,
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
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  input: {
    flex: 1,
    minHeight: 50,
    maxHeight: 140,
    paddingHorizontal: 15,
    paddingTop: 14,
    paddingBottom: 14,
    color: c.text,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 18,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 22,
  },
  send: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: c.red,
    alignItems: "center",
    justifyContent: "center",
  },
});
