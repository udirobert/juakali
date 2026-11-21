/**
 * WorkspaceEntry — a state-aware card that surfaces the caller's private
 * workspace wherever it belongs: a pending invitation, the one outstanding
 * ask, the week's check-in, or a "start one" prompt.
 *
 * Deliberately thin: one `overview` query (minimal metadata — never notes,
 * asks, or amounts), one pure state→presentation mapper, one CTA that deep
 * links into `/workspace/private` with a presentational `intent` param only.
 * If the query fails — e.g. the function is not yet deployed — the card
 * degrades to a neutral link instead of taking down the surrounding page.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { useRouter } from "expo-router";

import { api } from "@/convex/_generated/api";
import { SectionLabel } from "@/components/jua-kali/ui";
import { color, font, space } from "@/components/jua-kali/theme";

type Overview = NonNullable<
    ReturnType<typeof useQuery<typeof api.privateWorkspace.overview>>
>;

type Intent =
    | "invite"
    | "pending"
    | "request"
    | "report"
    | "feedback"
    | "review"
    | undefined;

type Presentation = {
    /** Members/invitees get an eyebrow + dark workspace title; guests don't. */
    eyebrow: string | null;
    title: string | null;
    /** Printed status — never conveyed by colour alone. */
    status: string;
    cta: string | null;
    intent: Intent;
};

/** Pure state → presentation. Names and week numbers come from the API. */
function present(o: Overview): Presentation {
    const none = { eyebrow: null, title: null, intent: undefined };
    switch (o.state) {
        case "disabled":
            return {
                ...none,
                status: "Private workspaces are off while the demo sign-in inbox is enabled.",
                cta: null,
            };
        case "signedout":
            return {
                ...none,
                status: "A private Friday loop between you and one other person.",
                cta: "Sign in to start",
            };
        case "verify":
            return {
                ...none,
                status: "A verified email account is required.",
                cta: "Verify your account",
            };
        case "empty":
            return {
                ...none,
                status: "Back one person's work week by week — private to the two of you.",
                cta: "Start a private workspace",
            };
        case "invited":
            return {
                eyebrow: "Invitation",
                title: `Invitation to ${o.name}`,
                status: o.multiple
                    ? "One more invitation also waits — review before joining."
                    : "Review before joining — nothing joins automatically.",
                cta: o.multiple ? "Review invitations" : "Review invitation",
                intent: "invite",
            };
        case "pending":
            return {
                eyebrow: "Private workspace",
                title: o.name,
                status: "Waiting for acceptance — no check-ins scheduled yet.",
                cta: "Manage invitation",
                intent: "pending",
            };
        case "request":
            return {
                eyebrow: "Private workspace",
                title: o.name,
                status: `A help request is waiting on you${o.completed ? " · all 4 Fridays complete" : ""}.`,
                cta: "Review request",
                intent: "request",
            };
        case "report":
            return {
                eyebrow: "Private workspace",
                title: o.name,
                status: o.week ? `Week ${o.week} check-in is due.` : "This week's check-in is due.",
                cta: "Post check-in",
                intent: "report",
            };
        case "feedback":
            return {
                eyebrow: "Private workspace",
                title: o.name,
                status: "Mark whether the help landed.",
                cta: "Review follow-up",
                intent: "feedback",
            };
        case "complete":
            return {
                eyebrow: "Private workspace",
                title: o.name,
                status: "All four Fridays are on the book.",
                cta: "Review together",
                intent: "review",
            };
        default:
            return {
                eyebrow: "Private workspace",
                title: o.name,
                status: o.week ? `Week ${o.week} · private Fridays` : "Private Fridays",
                cta: "Open workspace",
                intent: undefined,
            };
    }
}

function EntryBody({ overview }: { overview: Overview }) {
    const router = useRouter();
    const p = present(overview);
    const member = p.eyebrow !== null;
    const body = (
        <>
            {p.eyebrow ? <Text style={styles.eyebrow}>{p.eyebrow}</Text> : null}
            {p.title ? <Text style={styles.title}>{p.title}</Text> : null}
            <Text style={styles.status} accessibilityLiveRegion="polite">
                {p.status}
            </Text>
            {p.cta ? (
                <Pressable
                    onPress={() =>
                        router.push({
                            pathname: "/workspace/private",
                            params: p.intent ? { intent: p.intent } : {},
                        })
                    }
                    style={styles.cta}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.cta} — private workspace`}
                >
                    <Text style={styles.ctaLabel}>{p.cta} →</Text>
                </Pressable>
            ) : null}
        </>
    );
    return member ? <View style={styles.memberRule}>{body}</View> : body;
}

function Queried() {
    const overview = useQuery(api.privateWorkspace.overview, {});
    if (overview === undefined) {
        return <Text style={styles.status}>Loading…</Text>;
    }
    return <EntryBody overview={overview} />;
}

/** Neutral fallback — no claim about membership state, navigation only. */
function Fallback() {
    const router = useRouter();
    return (
        <Pressable
            onPress={() => router.push("/workspace/private")}
            style={styles.cta}
            accessibilityRole="button"
        >
            <Text style={styles.ctaLabel}>Private workspace →</Text>
        </Pressable>
    );
}

class Boundary extends React.Component<
    { children: React.ReactNode },
    { failed: boolean }
> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    render() {
        return this.state.failed ? <Fallback /> : this.props.children;
    }
}

export function WorkspaceEntry({
    variant = "home",
    label,
}: {
    variant?: "home" | "compact";
    label?: string;
}) {
    return (
        <View style={variant === "compact" ? styles.wrapCompact : styles.wrap}>
            <SectionLabel>{label ?? "Your workspaces"}</SectionLabel>
            <Boundary>
                <Queried />
            </Boundary>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        gap: space[2],
        width: "100%",
    },
    wrapCompact: {
        gap: space[1],
        width: "100%",
    },
    memberRule: {
        borderLeftWidth: 3,
        borderLeftColor: color.brass,
        paddingLeft: space[3],
        gap: space[1],
    },
    eyebrow: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        letterSpacing: 1.4,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    title: {
        fontFamily: font.display,
        fontSize: 20,
        lineHeight: 26,
        color: color.ink,
        flexWrap: "wrap",
    },
    status: {
        fontFamily: font.body,
        fontSize: 14,
        lineHeight: 20,
        color: color.mist,
        flexWrap: "wrap",
    },
    cta: {
        alignSelf: "flex-start",
        minHeight: 44,
        justifyContent: "center",
        borderBottomWidth: 1,
        borderBottomColor: color.brass,
    },
    ctaLabel: {
        fontFamily: font.bodyBold,
        fontSize: 14,
        color: color.brassDeep,
    },
});
