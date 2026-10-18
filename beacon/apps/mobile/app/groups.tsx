import { useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Check, LockKeyhole, Users } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../src/services/BeaconContext";
import {
  Body,
  Button,
  Card,
  ErrorNotice,
  Field,
  Heading,
  Screen,
  TextButton,
  styles,
  useAction,
} from "../src/components/ui";
import { colors as c } from "../src/theme/tokens";

export default function Groups() {
  const b = useBeacon();
  const [mode, setMode] = useState<"create" | "join" | null>(null);
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
      if (mode === "create") {
        if (!name.trim()) throw new Error("Enter a group name.");
        await b.createGroup(name.trim());
      } else {
        await b.joinGroup("Joined group", code.trim());
        router.replace("/(tabs)/nearby");
      }
      setName("");
      setCode("");
      setMode(null);
    });
  return (
    <Screen back title="Groups">
      {mode === null && (<>
      <Body muted>Choose who you share with. Only the selected group is active.</Body>
      <View style={s.choices}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Everyone nearby, public sharing"
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
            <Text style={styles.smallTitle}>Everyone nearby</Text>
            <Text style={styles.caption}>Anyone using Beacon nearby</Text>
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
              <Text style={styles.caption}>{b.activeGroupId === group.id ? "Selected · invite only" : "Invite only"}</Text>
            </View>
            {b.activeGroupId === group.id && <Check size={22} color={c.text} />}
          </Pressable>
        ))}
      </View>
      </>)}
      {selected && mode === null && (
        <Card>
          <Text style={styles.smallTitle}>Invite to {selected.name}</Text>
          <Text style={styles.caption}>Anyone with this code can join. Share only with your group.</Text>
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
      <ErrorNotice message={action.error} />
      <View style={{ gap: 16 }}>
        {mode === null ? (
          <>
            <Button
              secondary
              disabled={action.busy}
              onPress={() => setMode("join")}
            >
              Join a group
            </Button>
            <TextButton
              onPress={() => {
                if (!action.busy) setMode("create");
              }}
            >
              Create a group
            </TextButton>
          </>
        ) : (
          <>
            <Heading size={22}>
              {mode === "create" ? "Create a group" : "Join a group"}
            </Heading>
            {mode === "create" && (
              <Field
                label="Group name"
                placeholder="Friends, family, neighbors"
                value={name}
                onChangeText={setName}
                maxLength={40}
                editable={!action.busy}
                autoCapitalize="words"
              />
            )}
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
            <Button
              busy={action.busy}
              disabled={mode === "create" ? !name.trim() : !code.trim()}
              onPress={submit}
            >
              {mode === "create" ? "Create group" : "Join group"}
            </Button>
            <TextButton
              onPress={() => {
                if (!action.busy) setMode(null);
              }}
            >
              Cancel
            </TextButton>
          </>
        )}
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
    minHeight: 76,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
});
