import { useWindowDimensions } from "react-native";
import { Tabs } from "expo-router";
import { Users, Radio } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBeacon } from "../../src/services/BeaconContext";
import { colors as c, fonts } from "../../src/theme/tokens";
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const { requests, people, activeGroupId } = useBeacon();
  const requestCount = requests.filter(
    (request) =>
      !request.mine &&
      (request.groupId ?? null) === activeGroupId &&
      (request.status === "active" || request.status === "accepted"),
  ).length;
  const unreadCount = people
    .filter((person) => person.scope === activeGroupId)
    .reduce((sum, person) => sum + person.unreadCount, 0);
  const badgeStyle = {
    backgroundColor: c.text,
    color: c.background,
    fontFamily: fonts.medium,
  };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarAllowFontScaling: true,
        tabBarLabelPosition: "below-icon",
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: {
          backgroundColor: c.background,
          borderTopColor: c.border,
          height: 64 + insets.bottom + Math.max(0, fontScale - 1) * 22,
          paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: {
          fontFamily: fonts.medium,
          fontSize: 12,
          marginTop: 4,
        },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Help",
          tabBarAccessibilityLabel: requestCount ? `Help, ${requestCount} active requests` : "Help",
          tabBarBadge: requestCount > 99 ? "99+" : requestCount || undefined,
          tabBarBadgeStyle: badgeStyle,
          tabBarIcon: ({ color }) => <Radio size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="nearby"
        options={{
          title: "Nearby",
          tabBarAccessibilityLabel: unreadCount
            ? `Nearby, ${unreadCount} unread messages`
            : "Nearby",
          tabBarBadge: unreadCount > 99 ? "99+" : unreadCount || undefined,
          tabBarBadgeStyle: badgeStyle,
          tabBarIcon: ({ color }) => <Users size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
