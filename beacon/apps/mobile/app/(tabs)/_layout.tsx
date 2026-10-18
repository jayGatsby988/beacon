import { useWindowDimensions } from "react-native";
import { Tabs } from "expo-router";
import { HeartHandshake, RadioTower } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors as c, fonts } from "../../src/theme/tokens";
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
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
          height: 76 + insets.bottom + Math.max(0, fontScale - 1) * 22,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 12),
        },
        tabBarLabelStyle: {
          fontFamily: fonts.medium,
          fontSize: 12,
          marginTop: 6,
        },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "I need help",
          tabBarAccessibilityLabel: "I need help",
          tabBarIcon: ({ color }) => <RadioTower size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="nearby"
        options={{
          title: "Help nearby",
          tabBarAccessibilityLabel: "Help nearby",
          tabBarIcon: ({ color }) => <HeartHandshake size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
