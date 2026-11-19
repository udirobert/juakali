import { useCallback, useEffect, useRef, useState } from "react";
import {
    StyleSheet,
    Text,
    View,
    type GestureResponderEvent,
    type StyleProp,
    type ViewStyle,
} from "react-native";

import { color, radius, type as typeStyle } from "@/components/jua-kali/theme";

const LENS_R = 110;

/**
 * The verification lens — the proof story made physical. The styled record is
 * a courtesy; hold anywhere on the slab and a lens follows your pointer,
 * revealing the raw entry underneath. On web a radial mask cuts the soft
 * surface away; on native the whole raw layer crossfades in while held.
 * Same metaphor both platforms: anyone can inspect the record itself.
 */
export function VerifyLens({
    rawLines,
    hint = "Hold to inspect the raw entry",
    style,
}: {
    /** The machine-readable lines revealed under the lens. */
    rawLines: [string, string][];
    hint?: string;
    style?: StyleProp<ViewStyle>;
}) {
    const isWeb = process.env.EXPO_OS === "web";
    const slabRef = useRef<View>(null);
    const softRef = useRef<View>(null);
    const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
    const [pinned, setPinned] = useState(false);
    const grantRef = useRef<{ x: number; y: number } | null>(null);
    const movedRef = useRef(false);

    const active = pinned || lens !== null;

    const onDomClick = useCallback(() => {
        if (!movedRef.current) setPinned((p) => !p);
    }, []);

    useEffect(() => {
        if (!isWeb) return;
        const slab = slabRef.current as unknown as HTMLElement | null;
        if (slab) {
            slab.style.cursor = "crosshair";
            // Tap pins the veil open — keyboard and screen-reader parity for
            // the press-and-hold lens. Drags reach here too but movedRef
            // filters them out (the peek feel survives on release).
            slab.addEventListener("click", onDomClick);
        }
        const el = softRef.current as unknown as HTMLElement | null;
        if (!el) return;
        if (active && lens) {
            const mask = `radial-gradient(circle ${LENS_R}px at ${lens.x}px ${lens.y}px, transparent 0 ${LENS_R * 0.55}px, black ${LENS_R}px)`;
            el.style.maskImage = mask;
            el.style.webkitMaskImage = mask;
            el.style.opacity = "1";
        } else if (pinned) {
            // Pinned (tap/keyboard path): lift the veil entirely — a mask of
            // "none" would leave the soft layer opaque over the record.
            el.style.maskImage = "";
            el.style.webkitMaskImage = "";
            el.style.opacity = "0";
        } else {
            el.style.maskImage = "";
            el.style.webkitMaskImage = "";
            el.style.opacity = "1";
        }
        return () => slab?.removeEventListener("click", onDomClick);
    }, [isWeb, active, lens, pinned, onDomClick]);

    const onGrant = useCallback((e: GestureResponderEvent) => {
        grantRef.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        movedRef.current = false;
        setLens((l) => (pinned ? l : { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }));
    }, [pinned]);
    const onMove = useCallback((e: GestureResponderEvent) => {
        const g = grantRef.current;
        if (
            g &&
            Math.hypot(e.nativeEvent.locationX - g.x, e.nativeEvent.locationY - g.y) > 8
        ) {
            movedRef.current = true;
        }
        setLens((l) => (pinned ? l : { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }));
    }, [pinned]);
    const onRelease = useCallback(() => {
        setLens(null);
        // Native taps pin open (web handles taps via onClick).
        if (process.env.EXPO_OS !== "web" && !movedRef.current) setPinned((p) => !p);
    }, []);

    return (
        <View
            ref={slabRef}
            style={[styles.slab, style]}
            onStartShouldSetResponder={() => true}
            onResponderGrant={onGrant}
            onResponderMove={onMove}
            onResponderRelease={onRelease}
            onResponderTerminate={onRelease}
            accessibilityRole="button"
            accessibilityLabel={`${hint}. Activating reveals the raw record fields.`}
        >
            {/* Raw record — the layer underneath. */}
            <View style={[styles.raw, isWeb ? null : active ? styles.rawOn : styles.rawOff]}>
                <Text style={styles.rawEyebrow}>Raw ledger entry</Text>
                {rawLines.map(([k, v]) => (
                    <View key={k} style={styles.rawRow}>
                        <Text style={styles.rawKey}>{k}</Text>
                        <Text style={styles.rawVal} numberOfLines={2}>
                            {v}
                        </Text>
                    </View>
                ))}
            </View>

            {/* Soft surface — masked away under the lens on web, hidden on native hold. */}
            <View ref={softRef} style={[styles.soft, isWeb ? null : active && styles.softOff]}>
                <View style={styles.softInner}>
                    <View style={styles.lensIcon}>
                        <View style={styles.lensIconRing} />
                        <View style={styles.lensIconDot} />
                    </View>
                    <Text style={styles.hint}>{hint}</Text>
                    <Text style={styles.hintSub}>
                        The presentation is a courtesy — the record underneath is the truth.
                    </Text>
                </View>
            </View>

            {/* Brass ring tracing the lens while held (web draws the mask hole at the same point). */}
            {isWeb && lens ? (
                <View
                    pointerEvents="none"
                    style={[
                        styles.ring,
                        {
                            left: lens.x - LENS_R * 0.55,
                            top: lens.y - LENS_R * 0.55,
                            width: LENS_R * 1.1,
                            height: LENS_R * 1.1,
                            borderRadius: (LENS_R * 1.1) / 2,
                        },
                    ]}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    slab: {
        position: "relative",
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.brassBorder,
        backgroundColor: color.foam,
        overflow: "hidden",
        minHeight: 148,
    },
    soft: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.foam },
    softOff: { opacity: 0 },
    softInner: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 18 },
    lensIcon: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1.5,
        borderColor: color.brassDeep,
        alignItems: "center",
        justifyContent: "center",
    },
    lensIconRing: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 17,
        borderWidth: 0,
    },
    lensIconDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: color.brassDeep },
    hint: { ...typeStyle.eyebrow, fontSize: 10, color: color.ink, textAlign: "center" },
    hintSub: { ...typeStyle.meta, fontSize: 11, color: color.mistSoft, textAlign: "center" },
    raw: {
        padding: 14,
        gap: 6,
        backgroundColor: color.paper,
    },
    rawOn: { opacity: 1 },
    rawOff: { opacity: 0 },
    rawEyebrow: { ...typeStyle.eyebrow, fontSize: 9, color: color.brassDeep, marginBottom: 2 },
    rawRow: { flexDirection: "row", gap: 10 },
    rawKey: {
        ...typeStyle.meta,
        fontSize: 10,
        width: 108,
        color: color.mist,
        fontVariant: ["tabular-nums"],
    },
    rawVal: {
        ...typeStyle.meta,
        flex: 1,
        fontSize: 10,
        color: color.ink,
        fontFamily: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
    },
    ring: {
        position: "absolute",
        borderWidth: 1.5,
        borderColor: color.brassDeep,
        opacity: 0.9,
    },
});
