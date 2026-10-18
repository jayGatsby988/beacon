import { useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Switch,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBeacon } from "../src/services/BeaconContext";
import {
  Body,
  Button,
  ErrorNotice,
  Field,
  Screen,
  TextButton,
  useAction,
} from "../src/components/ui";
import { colors as c } from "../src/theme/tokens";

export default function Settings() {
  const b = useBeacon();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(b.displayName);
  const action = useAction();
  const hasChanges = name !== b.displayName;
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen
        back
        title="Settings"
        footer={
          hasChanges ? (
            <View
              style={{
                padding: 20,
                paddingBottom: Math.max(insets.bottom, 12),
                backgroundColor: c.background,
              }}
            >
              <Button
                busy={action.busy}
                onPress={() =>
                  action.run(async () => {
                    const displayName = name.trim() || "Participant";
                    await b.saveSettings({ displayName });
                    setName(displayName);
                  })
                }
              >
                Save name
              </Button>
            </View>
          ) : undefined
        }
      >
        <ErrorNotice message={action.error} />
        <Field
          label="Your name"
          value={name}
          onChangeText={setName}
          maxLength={40}
          editable={!action.busy}
        />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
            paddingVertical: 16,
          }}
        >
          <View style={{ flex: 1 }}>
            <Body>Nearby sharing</Body>
          </View>
          <Switch
            accessibilityLabel="Enable nearby sharing"
            value={b.relayEnabled}
            disabled={action.busy}
            onValueChange={(value) =>
              action.run(() => b.setRelayEnabled(value))
            }
            trackColor={{ false: c.border, true: c.secondary }}
            thumbColor={c.text}
          />
        </View>
        <TextButton onPress={() => action.run(() => Linking.openSettings())}>
          Phone permissions
        </TextButton>
      </Screen>
    </KeyboardAvoidingView>
  );
}
