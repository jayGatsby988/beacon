import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { AccessibilityInfo, Animated } from "react-native";

// Begin without motion until the OS preference is known. One listener serves
// the whole app; buttons animate on the native driver without delaying actions.
const ReduceMotion = createContext(true);
export function MotionProvider({ children }: PropsWithChildren) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true;
    let receivedChange = false;
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      receivedChange = true;
      setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (alive && !receivedChange) setReduced(value); })
      .catch(() => { /* A missing preference leaves motion disabled. */ });
    return () => { alive = false; listener.remove(); };
  }, []);
  return <ReduceMotion.Provider value={reduced}>{children}</ReduceMotion.Provider>;
}
export function useReducedMotion() {
  return useContext(ReduceMotion);
}
export function usePressFeedback() {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) { scale.stopAnimation(); scale.setValue(1); }
    return () => scale.stopAnimation();
  }, [reduced, scale]);
  return {
    style: { transform: [{ scale }] },
    onPressIn: () => {
      if (reduced) return;
      Animated.timing(scale, { toValue: 0.975, duration: 85, useNativeDriver: true }).start();
    },
    onPressOut: () => {
      if (reduced) return;
      Animated.spring(scale, { toValue: 1, stiffness: 380, damping: 28, mass: 0.65, useNativeDriver: true }).start();
    },
  };
}
