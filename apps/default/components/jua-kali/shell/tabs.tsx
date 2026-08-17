import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, font, layout } from "@/components/jua-kali/theme";

/** The top-level surfaces and the Lab's sub-tabs — kept here so the shell chrome stays presentational. */
export type TabId = "home" | "today" | "deals" | "ledger" | "proof" | "venture" | "lab";
export type LabTabId = "agent" | "funnel" | "ops";

export const LAB_TABS: Array<{ id: LabTabId; label: string }> = [
    { id: "agent", label: "Agent" },
    { id: "funnel", label: "Funnel" },
    { id: "ops", label: "Ops" },
];

/**
 * The app's one tab treatment — three physical layouts (bottom tab / top tab /
 * compact lab chip) driven by `top` and `compact`, with press + selected states.
 */
export function TabButton({
    label,
    active,
    onPress,
    compact,
    top,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
    compact?: boolean;
    top?: boolean;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.tab,
                top && styles.tabTop,
                compact && styles.tabCompact,
                active && (top ? styles.tabActiveTop : styles.tabActive),
                pressed && styles.tabPressed,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
        >
            <Text
                style={[
                    styles.tabText,
                    compact && styles.tabTextCompact,
                    active && styles.tabTextActive,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

/**
 * The nav cluster — a primary tab row plus (when the Lab is open) the Lab's
 * Agent/Funnel/Ops sub-row. Purely presentational: index.tsx owns the state.
 */
export function NavTabs({
    primaryTabs,
    activePrimary,
    labActive,
    showLab,
    onSelectPrimary,
    onSelectLab,
    top,
}: {
    primaryTabs: Array<{ id: TabId; label: string }>;
    activePrimary: string;
    labActive: string;
    showLab: boolean;
    onSelectPrimary: (id: TabId) => void;
    onSelectLab: (id: LabTabId) => void;
    top?: boolean;
}) {
    return (
        <View style={[styles.navInner, top && styles.navInnerTop]}>
            <View style={[styles.tabRow, top && styles.tabRowTop]}>
                {primaryTabs.map((tab) => (
                    <TabButton
                        key={tab.id}
                        label={tab.label}
                        active={activePrimary === tab.id}
                        onPress={() => onSelectPrimary(tab.id)}
                        top={top}
                    />
                ))}
            </View>
            {showLab ? (
                <View style={styles.labRow}>
                    {LAB_TABS.map((tab) => (
                        <TabButton
                            key={tab.id}
                            label={tab.label}
                            active={labActive === tab.id}
                            onPress={() => onSelectLab(tab.id)}
                            compact
                            top={top}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    navInner: { width: "100%" },
    navInnerTop: { flex: 1 },
    tabRow: {
        flexDirection: "row",
        justifyContent: "center",
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        paddingHorizontal: 8,
    },
    tabRowTop: {
        justifyContent: "flex-start",
        paddingHorizontal: 0,
        gap: 4,
    },
    labRow: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingTop: 2,
    },
    tab: {
        flex: 1,
        maxWidth: 160,
        paddingVertical: 14,
        alignItems: "center",
        minHeight: 48,
        justifyContent: "center",
    },
    tabTop: {
        flex: 0,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minHeight: 44,
        maxWidth: undefined,
        borderRadius: 4,
    },
    tabCompact: {
        flex: 0,
        paddingHorizontal: 14,
        paddingVertical: 8,
        minHeight: 36,
    },
    tabActive: {
        borderTopWidth: 2,
        borderTopColor: color.brass,
    },
    tabActiveTop: {
        backgroundColor: color.brassSoft,
    },
    tabPressed: { opacity: 0.6 },
    tabText: {
        fontFamily: font.bodyBold,
        color: color.mist,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0.3,
    },
    tabTextCompact: { fontSize: 11 },
    tabTextActive: { color: color.charcoal },
});