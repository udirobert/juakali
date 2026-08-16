import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/** Light selection tick for meaningful taps. No-op on web (no actuator). */
export function tapHaptic(): void {
    if (Platform.OS === "web") return;
    void Haptics.selectionAsync();
}
