import { Linking, Switch, Text, View } from "react-native";
import { Body, Button, Card, ErrorNotice, styles, useAction } from "./ui";
import { useHelpNotifications } from "../services/NotificationContext";
import { colors } from "../theme/tokens";

export default function NotificationSettings() {
  const notifications = useHelpNotifications();
  const action = useAction();
  const denied = notifications.permission === "denied";
  return <Card>
    <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.smallTitle}>Help notifications</Text>
        <Body muted>New SOS requests, help offers and acceptance updates.</Body>
      </View>
      <Switch accessibilityLabel="Help notifications" value={notifications.enabled && notifications.permission === "granted"}
        disabled={!notifications.ready || action.busy || notifications.permission === "unavailable"}
        onValueChange={value => void action.run(() => notifications.setEnabled(value))}
        trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.onAction} />
    </View>
    <Text style={styles.caption}>Alerts work without internet after a Bluetooth message arrives. Keep Beacon open for reliable reception. Names and locations stay out of alerts.</Text>
    {denied && <Button secondary onPress={() => action.run(() => Linking.openSettings())}>Allow notifications in phone settings</Button>}
    {notifications.permission === "unavailable" && <Body muted>Notifications require a current native iPhone or Android build.</Body>}
    <ErrorNotice message={action.error || notifications.error} />
  </Card>;
}
