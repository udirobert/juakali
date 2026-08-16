import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/** Light selection tick for meaningful taps. No-op on web (no actuator). */
export function tapHaptic(): void {
    if (Platform.OS === "web") return;
    void Haptics.selectionAsync();
}

/**
 * Success pattern — reserved for the two consequential completions: an
 * approved run finishing, and a digest landing on the ledger.
 */
export function successHaptic(): void {
    if (Platform.OS === "web") return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
