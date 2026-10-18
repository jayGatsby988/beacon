import { useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Check, LockKeyhole, Users } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../src/services/BeaconContext";
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  Heading,
  Pill,
  Screen,
  styles,
  useAction,
} from "../src/components/ui";
import { colors as c } from "../src/theme/tokens";

export default function Groups() {
  const b = useBeacon();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const action = useAction();
  const selected = b.groups.find((g) => g.id === b.activeGroupId);
  const choose = (id: string | null) =>
    action.run(async () => {
      await b.selectGroup(id);
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/nearby");
    });
  const submit = () =>
    action.run(async () => {
      if (!name.trim()) throw new Error("Enter a group name.");
      if (mode === "create") await b.createGroup(name.trim());
      else await b.joinGroup(name.trim(), code.trim());
      setName("");
      setCode("");
    });
  return (
    <Screen back title="Groups">
      <Heading>Share with</Heading>
      <View style={s.choices}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Nearby, public sharing"
          accessibilityState={{
            selected: b.activeGroupId === null,
            disabled: action.busy,
          }}
          disabled={action.busy}
          onPress={() => choose(null)}
          style={s.choice}
        >
          <Users color={c.secondary} size={23} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.smallTitle}>Nearby</Text>
            <Text style={styles.caption}>People using Beacon around you</Text>
          </View>
          {b.activeGroupId === null && <Check size={22} color={c.text} />}
        </Pressable>
        {b.groups.map((group) => (
          <Pressable
            key={group.id}
            accessibilityRole="button"
            accessibilityLabel={group.name}
            accessibilityState={{
              selected: b.activeGroupId === group.id,
              disabled: action.busy,
            }}
            disabled={action.busy}
            onPress={() => choose(group.id)}
            style={[s.choice, { borderTopWidth: 1, borderTopColor: c.border }]}
          >
            <LockKeyhole color={c.secondary} size={23} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.smallTitle}>{group.name}</Text>
              <Text style={styles.caption}>Private group</Text>
            </View>
            {b.activeGroupId === group.id && <Check size={22} color={c.text} />}
          </Pressable>
        ))}
      </View>
      {selected && (
        <Card>
          <Text style={styles.smallTitle}>{selected.name} invite</Text>
          <Text
            selectable
            accessibilityLabel="Group invite code"
            style={[styles.caption, { color: c.text }]}
          >
            {selected.inviteCode}
          </Text>
          <Text style={styles.caption}>Share only with your group.</Text>
          <Button
            secondary
            busy={action.busy}
            onPress={() =>
              action.run(() =>
                Share.share({
                  title: `${selected.name} · Beacon`,
                  message: selected.inviteCode,
                }),
              )
            }
          >
            Share invite
          </Button>
        </Card>
      )}
      <View style={{ gap: 16, marginTop: 8 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Pill
            selected={mode === "create"}
            onPress={() => {
              if (!action.busy) setMode("create");
            }}
          >
            Create group
          </Pill>
          <Pill
            selected={mode === "join"}
            onPress={() => {
              if (!action.busy) setMode("join");
            }}
          >
            Join group
          </Pill>
        </View>
        <Field
          label="Group name"
          placeholder="Friends, family, neighbors"
          value={name}
          onChangeText={setName}
          maxLength={40}
          editable={!action.busy}
          autoCapitalize="words"
        />
        {mode === "join" && (
          <Field
            label="Invite code"
            placeholder="Paste the group’s invite code"
            value={code}
            onChangeText={setCode}
            maxLength={512}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!action.busy}
            multiline
            style={{ minHeight: 84 }}
          />
        )}
        <ErrorNotice message={action.error} />
        <Button
          busy={action.busy}
          disabled={!name.trim() || (mode === "join" && !code.trim())}
          onPress={submit}
        >
          {mode === "create" ? "Create group" : "Join group"}
        </Button>
      </View>
    </Screen>
  );
}
const s = StyleSheet.create({
  choices: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 16,
    backgroundColor: c.card,
    overflow: "hidden",
  },
  choice: {
    minHeight: 80,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
});
