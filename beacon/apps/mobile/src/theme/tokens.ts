import { Platform } from "react-native";
export const colors = {
  background: "#0B1014",
  card: "#141B21",
  raised: "#1D262E",
  border: "#2A343D",
  text: "#F7F9FA",
  onAction: "#FFFFFF",
  secondary: "#BAC4CC",
  muted: "#96A3AD",
  red: "#D9363E",
  alert: "#251418",
  alertBorder: "#713039",
  redLabel: "#FF8A91",
};
export const fonts = {
  headline: "InterTight-Black",
  body: "Inter-Regular",
  medium: "Inter-SemiBold",
  wordmark: "BarlowCondensed-Bold",
  fallback: Platform.select({ ios: "System", android: "sans-serif" }),
};
export const radius = { sm: 12, md: 16, lg: 24 };
export const spacing = { xs: 6, sm: 12, md: 20, lg: 28, xl: 40, xxl: 56 };
