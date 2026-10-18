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
      if (!name.trim()) throw new Error("Enter a group name.");
      if (mode === "create") await b.createGroup(name.trim());
      else await b.joinGroup(name.trim(), code.trim());
      setName("");
      setCode("");
      setMode(null);
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
            <Text style={styles.caption}>Public</Text>
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
          <Text style={styles.smallTitle}>Invite to {selected.name}</Text>
          <Text style={styles.caption}>Anyone with the invite can join.</Text>
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
      <View style={{ gap: 16, marginTop: 8 }}>
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
            <Button
              busy={action.busy}
              disabled={!name.trim() || (mode === "join" && !code.trim())}
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
    minHeight: 80,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
});
