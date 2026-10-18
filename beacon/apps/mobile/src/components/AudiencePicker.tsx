import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown, LockKeyhole, Users, X } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../services/BeaconContext";
import { ErrorNotice, useAction } from "./ui";
import { colors as c, fonts } from "../theme/tokens";
import { useReducedMotion } from "./Motion";

export default function AudiencePicker({ label = "Audience", compact = false }: { label?: string; compact?: boolean }) {
  const b = useBeacon();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const action = useAction();
  const insets = useSafeAreaInsets();
  const name = b.groups.find((group) => group.id === b.activeGroupId)?.name ?? (b.activeGroupId ? "Private group" : "Everyone nearby");
  const choices = [{ id: null, name: "Everyone nearby" }, ...b.groups];
  const close = () => { if (!action.busy) setOpen(false); };
  const choose = (id: string | null) => action.run(async () => {
    await b.selectGroup(id);
    setOpen(false);
  });
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${name}. Change audience`} onPress={() => setOpen(true)} style={({ pressed }) => [s.trigger, compact && s.compact, pressed && s.pressed]}>
        {b.activeGroupId ? <LockKeyhole size={17} color={c.secondary} /> : <Users size={17} color={c.secondary} />}
        <Text style={[s.triggerText, compact && s.compactText]}>{compact ? "To " : ""}{b.activeGroupId ? name : compact ? "everyone nearby" : "Everyone nearby"}</Text>
        <ChevronDown size={16} color={c.secondary} />
      </Pressable>
      <Modal visible={open} transparent animationType={reducedMotion ? "none" : "fade"} onRequestClose={close}>
        <View style={s.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close audience selection" disabled={action.busy} onPress={close} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={s.headingRow}>
              <Text accessibilityRole="header" style={s.heading}>Who can you reach?</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close audience selection" accessibilityState={{ disabled: action.busy }} disabled={action.busy} onPress={close} style={s.close}><X size={22} color={c.text} /></Pressable>
            </View>
            <Text style={s.caption}>Applies to SOS, people and messages.</Text>
            <ScrollView style={s.choices} keyboardShouldPersistTaps="handled">
              {choices.map((choice) => (
                <Pressable key={choice.id ?? "public"} accessibilityRole="radio" accessibilityLabel={choice.name} accessibilityState={{ checked: b.activeGroupId === choice.id, disabled: action.busy }} disabled={action.busy} onPress={() => void choose(choice.id)} style={({ pressed }) => [s.choice, b.activeGroupId === choice.id && s.selected, pressed && s.pressed]}>
                  {choice.id ? <LockKeyhole size={20} color={c.secondary} /> : <Users size={20} color={c.secondary} />}
                  <View style={s.choiceCopy}><Text style={s.name}>{choice.id ? choice.name : "Everyone nearby"}</Text><Text style={s.caption}>{choice.id ? "Invite only" : "People using Beacon"}</Text></View>
                  {b.activeGroupId === choice.id ? <Check size={21} color={c.text} /> : <View style={{ width: 21 }} />}
                </Pressable>
              ))}
            </ScrollView>
            <ErrorNotice message={action.error} />
            <Pressable accessibilityRole="button" disabled={action.busy} accessibilityState={{ disabled: action.busy }} onPress={() => { setOpen(false); router.push("/groups"); }} style={s.manage}><Text style={s.name}>Join or create a group</Text></Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trigger: { minHeight: 48, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: 24, backgroundColor: c.card, paddingHorizontal: 14, paddingVertical: 10, alignSelf: "flex-start" },
  triggerText: { fontFamily: fonts.medium, color: c.text, fontSize: 13, lineHeight: 19, flexShrink: 1 },
  compact: { minHeight: 44, borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0, paddingVertical: 5, gap: 6 },
  compactText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: c.secondary },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: { width: "100%", maxWidth: 640, maxHeight: "85%", alignSelf: "center", padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, gap: 14 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heading: { fontFamily: fonts.medium, fontSize: 22, color: c.text, flex: 1, letterSpacing: -0.6 },
  close: { width: 48, minHeight: 48, justifyContent: "center", alignItems: "center" },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: c.secondary },
  choices: { flexGrow: 0, maxHeight: 380 },
  choice: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "transparent", marginBottom: 6 },
  choiceCopy: { flex: 1, gap: 3 },
  name: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: c.text },
  selected: { backgroundColor: c.raised, borderColor: c.border },
  manage: { minHeight: 50, borderTopWidth: 1, borderTopColor: c.border, justifyContent: "center", paddingTop: 12 },
  pressed: { opacity: 0.65 },
});
