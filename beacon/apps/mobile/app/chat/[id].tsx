import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { ArrowUp, Ellipsis, Phone, X } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  ErrorNotice,
  TopBar,
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
  const currentScopePerson = !!person;
  const messages = useMemo(
    () => (currentScopePerson ? b.messages : [])
      .filter((m) => m.peerId === id)
      .sort((a, z) => a.createdAt - z.createdAt || a.id.localeCompare(z.id)),
    [b.messages, id, currentScopePerson],
  );
  const [draft, setDraft] = useState("");
  const [readError, setReadError] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const action = useAction();
  const callAction = useAction();
  const list = useRef<FlatList<DirectMessageView>>(null);
  const followLatest = useRef(true);
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const horizontalPadding = width < 375 ? 20 : 24;
  const stacked = fontScale >= 1.5 || width < 350;
  const unread = person?.unreadCount ?? 0;
  const markRead = b.markChatRead;
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
      followLatest.current = true;
      list.current?.scrollToEnd({ animated: false });
    });
  };
  const name = person?.name || "Conversation";
  const renderMessage = useCallback(
    ({ item }: ListRenderItemInfo<DirectMessageView>) => <MessageBubble item={item} name={name} stacked={stacked} />,
    [name, stacked],
  );
  const scrollToLatest = useCallback(() => {
    if (followLatest.current) list.current?.scrollToEnd({ animated: false });
  }, []);
  const trackScroll = useCallback(({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    followLatest.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
  }, []);
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
        <View style={[s.header, { paddingHorizontal: horizontalPadding }]}>
          <View style={s.personRow}>
            <View style={s.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text maxFontSizeMultiplier={1.4} style={s.initials}>{person ? initials(name) : "?"}</Text>
            </View>
            <View style={s.personName}>
              <Text style={s.connection}>
                {person ? person.connected ? "Connected nearby" : "Not connected" : "Not in your current group"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={detailsOpen ? "Close conversation options" : "Conversation options"}
              accessibilityState={{ expanded: detailsOpen }}
              onPress={() => setDetailsOpen((open) => !open)}
              style={({ pressed }) => [s.detailsToggle, pressed && { opacity: 0.7 }]}
            >
              {detailsOpen ? <X size={21} color={c.secondary} /> : <Ellipsis size={22} color={c.secondary} />}
            </Pressable>
          </View>
          {detailsOpen && <View style={s.details}>
            <Text style={s.callHint}>Queued: saved here. Received: acknowledged by their phone. Expired: no longer sending.</Text>
            <View style={[s.personRow, stacked && s.stackedRow]}>
              <View style={[s.personName, stacked && { flex: 0 }]}>
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
          keyExtractor={messageKey}
          style={s.flex}
          contentContainerStyle={[s.messages, { paddingHorizontal: horizontalPadding }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={trackScroll}
          scrollEventThrottle={100}
          onContentSizeChange={scrollToLatest}
          onLayout={scrollToLatest}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyTitle}>{person ? "Send your first message" : "Conversation unavailable"}</Text>
              {!person && <Text style={s.emptyDetail}>This person is not in your current audience.</Text>}
            </View>
          }
          renderItem={renderMessage}
        />
        <View
          style={[
            s.composerArea,
            { paddingBottom: Math.max(insets.bottom, 12), paddingHorizontal: horizontalPadding },
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
              selectionColor={c.text}
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

function messageKey(message: DirectMessageView) {
  return message.id;
}

const MessageBubble = memo(function MessageBubble({ item, name, stacked }: { item: DirectMessageView; name: string; stacked: boolean }) {
  return (
    <View
      style={[s.message, stacked && s.wideMessage, item.mine ? s.mine : s.theirs]}
      accessible
      accessibilityLabel={`${item.mine ? "You" : name}: ${item.text}. ${formatTime(item.createdAt)}${item.mine ? `. ${deliveryLabel(item.status)}` : ""}`}
    >
      <Text selectable style={s.messageText}>{item.text}</Text>
      <Text style={s.messageMeta}>{formatTime(item.createdAt)}{item.mine ? ` · ${deliveryLabel(item.status)}` : ""}</Text>
    </View>
  );
});

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.background },
  flex: { flex: 1 },
  header: {
    paddingTop: 4,
    paddingBottom: 20,
    gap: 4,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  personRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stackedRow: { flexDirection: "column", alignItems: "stretch" },
  personName: { flex: 1, minWidth: 0, gap: 5 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
  connection: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: c.secondary },
  detailsToggle: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  details: { gap: 20, marginTop: 16, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 48 },
  emptyTitle: { fontFamily: fonts.medium, color: c.text, fontSize: 24, lineHeight: 31, textAlign: "center" },
  emptyDetail: { fontFamily: fonts.body, color: c.secondary, fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 300 },
  call: {
    minWidth: 88,
    minHeight: 48,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: c.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  callLabel: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: c.text, flexShrink: 1 },
  callHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
  },
  messages: {
    flexGrow: 1,
    gap: 16,
    paddingTop: 8,
    paddingBottom: 24,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  message: {
    maxWidth: "88%",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  wideMessage: { maxWidth: "96%" },
  mine: {
    alignSelf: "flex-end",
    backgroundColor: c.raised,
    borderBottomRightRadius: 5,
  },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: c.card,
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
    fontSize: 12,
    lineHeight: 18,
    color: c.secondary,
    textAlign: "right",
  },
  composerArea: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
    paddingTop: 16,
    gap: 8,
    width: "100%",
    maxWidth: 640,
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
    borderRadius: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 22,
  },
  send: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },
});
