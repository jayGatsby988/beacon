import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { InterTight_900Black } from "@expo-google-fonts/inter-tight";
import { BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BeaconProvider } from "../src/services/BeaconContext";
import CallOverlay from "../src/components/CallOverlay";
import { colors } from "../src/theme/tokens";
export default function RootLayout() {
  useFonts({
    "Inter-Regular": Inter_400Regular,
    "Inter-SemiBold": Inter_600SemiBold,
    "InterTight-Black": InterTight_900Black,
    "BarlowCondensed-Bold": BarlowCondensed_700Bold,
  });
  return (
    <SafeAreaProvider>
      <BeaconProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: "none",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="setup" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="request/[id]" />
          <Stack.Screen name="network" />
          <Stack.Screen name="history" />
          <Stack.Screen name="incident" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="groups" />
          <Stack.Screen name="messages" />
          <Stack.Screen name="chat/[id]" />
        </Stack>
        <CallOverlay />
      </BeaconProvider>
    </SafeAreaProvider>
  );
}
