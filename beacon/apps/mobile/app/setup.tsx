import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Bluetooth, MapPin, Smartphone } from "lucide-react-native";
import { useBeacon } from "../src/services/BeaconContext";
import {
  Body,
  Button,
  Card,
  ErrorNotice,
  Field,
  Screen,
  StatusLine,
  TextButton,
  useAction,
} from "../src/components/ui";
import { colors as c } from "../src/theme/tokens";
export default function Setup() {
  const b = useBeacon();
  const [name, setName] = useState(b.displayName);
  const action = useAction();
  return (
    <Screen title="Set up Beacon">
      <Body muted>Share requests over Bluetooth. No account required.</Body>
      <Field
        label="Name (optional)"
        placeholder="Participant"
        value={name}
        maxLength={40}
        onChangeText={setName}
        autoComplete="given-name"
      />
      <Card>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <Bluetooth color={c.text} size={23} />
          <View style={{ flex: 1, gap: 6 }}>
            <Body>Bluetooth</Body>
            <Body muted>Receive and relay nearby requests.</Body>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: c.border }} />
        <View style={{ flexDirection: "row", gap: 14 }}>
          <MapPin color={c.text} size={23} />
          <View style={{ flex: 1, gap: 6 }}>
            <Body>Location (optional)</Body>
            <Body muted>Share coordinates or enter a place manually.</Body>
          </View>
        </View>
        <StatusLine
          complete={b.bluetooth === "poweredOn"}
          title={
            b.bluetooth === "poweredOn"
              ? "Bluetooth ready"
              : b.bluetooth === "unsupported"
                ? "Bluetooth unavailable"
                : "Enable Bluetooth and allow access"
          }
        />
        <StatusLine
          complete={b.locationPermission === "granted"}
          title={
            b.locationPermission === "granted"
              ? "Location allowed"
              : "Location is optional"
          }
        />
        <Button
          secondary
          busy={action.busy}
          onPress={() => action.run(b.requestPermissions)}
        >
          Check permissions
        </Button>
      </Card>
      <View style={{ flexDirection: "row", gap: 14, paddingHorizontal: 2 }}>
        <Smartphone size={22} color={c.secondary} />
        <Body muted style={{ flex: 1 }}>
          Keep Beacon open. Delivery requires another participating phone.
        </Body>
      </View>
      <ErrorNotice message={action.error || b.error} />
      <Button
        busy={action.busy}
        onPress={() =>
          action.run(async () => {
            await b.completeSetup(name.trim() || "Participant");
            router.replace("/(tabs)");
          })
        }
      >
        Continue
      </Button>
      <Body muted style={{ fontSize: 12, lineHeight: 19 }}>
        Beacon does not contact emergency services or guarantee help.
      </Body>
      <TextButton onPress={() => router.push("/settings")}>
        Offline map settings
      </TextButton>
    </Screen>
  );
}
