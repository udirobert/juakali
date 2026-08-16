import { StyleSheet, View } from "react-native";

import { color } from "@/components/jua-kali/theme";

/**
 * The JuaKali mark — a brass sun (jua = sun). Pure Views so it renders
 * identically on native and web. Repeated across surfaces as the brand motif.
 */
export function SunMark({ size = 40 }: { size?: number }) {
    const dot = size * 0.42;
    const rayLen = size * 0.17;
    const rayWidth = Math.max(1.5, size * 0.05);
    return (
        <View
            style={{ width: size, height: size }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <View
                    key={i}
                    style={[styles.rayArm, { transform: [{ rotate: `${i * 45}deg` }] }]}
                >
                    <View
                        style={[
                            styles.ray,
                            { width: rayWidth, height: rayLen, borderRadius: rayWidth / 2 },
                        ]}
                    />
                </View>
            ))}
            <View
                style={[
                    styles.dot,
                    {
                        width: dot,
                        height: dot,
                        borderRadius: dot / 2,
                        top: size / 2 - dot / 2,
                        left: size / 2 - dot / 2,
                    },
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    rayArm: { ...StyleSheet.absoluteFillObject, alignItems: "center" },
    ray: { backgroundColor: color.brass },
    dot: { position: "absolute", backgroundColor: color.brass },
});
