/**
 * Private backer–venture-lead workspace ("service book").
 *
 * A quiet weekly loop: the lead files one short report each Friday week —
 * a value for the measure the pair chose (zero counts), a note, and an
 * optional help request — and the backer answers exactly one outstanding
 * ask at a time. Everything here is private to the two members; nothing is
 * emailed, pledged publicly, or moved as money.
 */
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button, Card, Chip, Input, SectionLabel } from "@/components/jua-kali/ui";
import { SoftIdentityBar } from "@/components/jua-kali/soft-identity";
import { layout } from "@/components/jua-kali/theme";
import { styles } from "@/components/jua-kali/private-workspace.styles";

type Desk = NonNullable<ReturnType<typeof useQuery<typeof api.privateWorkspace.desk>>>;
type HomeDesk = Extract<Desk, { state: "home" }>;
type WeekView = HomeDesk["weeks"][number];
type Measure = HomeDesk["workspace"]["measure"];

type SupportKind = "undecided" | "gift" | "loan" | "revenue_share";
type RequestKind = "supplier" | "introduction" | "pricing" | "feedback" | "other";
type Precision = "whole" | "decimal";

const SUPPORT_OPTIONS: Array<{ value: SupportKind; label: string }> = [
    { value: "undecided", label: "Haven't decided" },
    { value: "gift", label: "A gift" },
    { value: "loan", label: "A loan" },
    { value: "revenue_share", label: "A small revenue share" },
];
const KIND_OPTIONS: Array<{ value: RequestKind; label: string }> = [
    { value: "supplier", label: "Supplier" },
    { value: "introduction", label: "Introduction" },
    { value: "pricing", label: "Pricing" },
    { value: "feedback", label: "Feedback" },
    { value: "other", label: "Something else" },
];
/** Frontend-only starting examples — editable defaults, never presets locked in. */
const EXAMPLES: Array<{
    name: string;
    label: string;
    unit: string;
    precision: Precision;
    focus: string;
}> = [
    {
        name: "Catering",
        label: "Paid catering bookings",
        unit: "bookings",
        precision: "whole",
        focus: "ingredient costs for one dish",
    },
    {
        name: "Welding",
        label: "Completed jobs",
        unit: "jobs",
        precision: "whole",
        focus: "materials and labor for one quote",
    },
];

const SUPPORT_LABEL: Record<SupportKind, string> = {
    undecided: "support not yet decided",
    gift: "a gift",
    loan: "a loan",
    revenue_share: "a small revenue share",
};

const INSTRUCTION =
    "Friday at 18:00 EAT. Bring help requests to me; otherwise let the work continue.";

function formatFriday(ts: number): string {
    return new Date(ts).toLocaleString("en-KE", {
        timeZone: "Africa/Nairobi",
        weekday: "short",
        month: "short",
        day: "numeric",
    });
}

function formatValue(value: number, precision: Precision): string {
    return precision === "decimal" ? String(value) : value.toLocaleString("en-KE");
}

export function PrivateWorkspace() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const desk = useQuery(api.privateWorkspace.desk, {});
    const { intent } = useLocalSearchParams<{ intent?: string }>();

    return (
        <ScrollView
            style={styles.page}
            contentContainerStyle={[
                styles.content,
                {
                    paddingTop: Platform.OS === "web" ? Math.max(insets.top, 72) : insets.top + 16,
                    paddingBottom: Math.max(insets.bottom, 24) + 40,
                    maxWidth: layout.maxWidth,
                    width: "100%",
                    alignSelf: "center",
                },
            ]}
            showsVerticalScrollIndicator={false}
        >
            <Pressable
                onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Back"
            >
                <Text style={styles.inlineLink}>← Back</Text>
            </Pressable>
            {desk === undefined ? (
                <Text style={styles.status}>Opening the service book…</Text>
            ) : desk.state === "signedout" ? (
                <SignedOut />
            ) : desk.state === "verify" ? (
                <VerifyEmail />
            ) : desk.state === "disabled" ? (
                <Disabled />
            ) : desk.state === "lobby" ? (
                <Lobby desk={desk} intent={intent} />
            ) : (
                <ServiceBook desk={desk} intent={intent} />
            )}
        </ScrollView>
    );
}

function SignedOut() {
    return (
        <>
            <View style={styles.bookCover}>
                <View style={styles.bookSpine} />
                <View style={styles.bookBody}>
                    <Text style={styles.eyebrow}>Example — a private service book</Text>
                    <Text style={styles.title}>The private service book</Text>
                    <Text style={styles.subtitle}>
                        Know how the work is going. See where your help is wanted.
                        One venture lead, one backer, one Friday each week.
                        Private to the two of you — nothing public, nothing
                        emailed, no money moved.
                    </Text>
                    <View style={styles.weekRow}>
                        <View style={styles.weekHead}>
                            <Text style={styles.weekLabel}>WEEK 2 · sample</Text>
                            <Text style={styles.weekMeta}>Fri, Jan 17</Text>
                        </View>
                        <Text style={styles.weekLine}>
                            Three paid orders. One repeat customer this week.
                        </Text>
                        <Text style={styles.weekLineQuiet}>
                            Suggested next step — agree on one next step together.
                        </Text>
                    </View>
                </View>
            </View>
            <Card>
                <Text style={styles.subtitle}>
                    Sign in with your own verified email to open a private workspace.
                </Text>
                <SoftIdentityBar forceOpen heading="Sign in to your workspace" />
            </Card>
        </>
    );
}

function VerifyEmail() {
    return (
        <Card>
            <Text style={styles.eyebrow}>Private workspace</Text>
            <Text style={styles.title}>Verify your email first</Text>
            <Text style={styles.subtitle}>
                A private workspace is shared between two named people. This
                account has no verified email — sign out and sign back in with
                a real address (magic link or Google), never a guest account.
            </Text>
            <SoftIdentityBar compact />
        </Card>
    );
}

function Disabled() {
    return (
        <Card>
            <Text style={styles.eyebrow}>Private workspace</Text>
            <Text style={styles.title}>Private workspaces are off in this demo build</Text>
            <Text style={styles.subtitle}>
                The demo sign-in inbox is enabled, so private records are closed
                here on purpose — demo login links are not private. Run without
                the demo inbox and sign in with a verified email to use a
                workspace.
            </Text>
        </Card>
    );
}

type Invite = Extract<Desk, { state: "lobby" }>["invites"][number];

/** What the invitee consents to — printed before any accept can run. */
function InvitePreview({
    invite,
    onNotNow,
    onAccepted,
}: {
    invite: Invite;
    onNotNow: () => void;
    onAccepted: () => void;
}) {
    const accept = useMutation(api.privateWorkspace.accept);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function join() {
        setBusy(true);
        setError(null);
        try {
            await accept({ workspaceId: invite.id });
            onAccepted();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not join.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card variant="artifact">
            <Text style={styles.eyebrow}>Invitation</Text>
            <Text style={styles.decisionTitle}>{invite.name}</Text>
            <Text style={styles.subtitle}>
                {invite.backerLabel} invited you to a private Friday workspace.
            </Text>
            <View style={{ gap: 6 }}>
                <Text style={styles.fieldHint}>What you're joining</Text>
                <Text style={styles.subtitle}>
                    · Private to the two members — nothing public is published.
                    {"\n"}· Four Fridays at 18:00 EAT, starting when you accept.
                    {"\n"}· Each week you file one value and a short note.
                    {"\n"}· An optional help request shares that whole update
                    immediately; without one, it stays private until Friday.
                    {"\n"}· No messages are sent, no money moves, and your agent
                    permissions don't change — this is not a funding agreement.
                </Text>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
                label={busy ? "Joining…" : "Accept & start four Fridays"}
                onPress={() => void join()}
                disabled={busy}
                busy={busy}
            />
            <Pressable
                onPress={onNotNow}
                disabled={busy}
                accessibilityRole="button"
                style={{ minHeight: 44, justifyContent: "center" }}
            >
                <Text style={styles.inlineLink}>Not now — go back</Text>
            </Pressable>
        </Card>
    );
}

function Lobby({
    desk,
    intent,
}: {
    desk: Extract<Desk, { state: "lobby" }>;
    intent?: string;
}) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [declinedAuto, setDeclinedAuto] = useState(false);
    const [showSetup, setShowSetup] = useState(false);

    // A Home "Review invitation" deep link opens the preview — but only when
    // exactly one invitation is outstanding, and never twice after Not now.
    useEffect(() => {
        if (
            intent === "invite" &&
            desk.invites.length === 1 &&
            !declinedAuto &&
            selectedId === null
        ) {
            setSelectedId(desk.invites[0]!.id);
        }
    }, [intent, desk.invites, declinedAuto, selectedId]);

    // Revalidate the selection against the freshest invite list — a withdrawn
    // or corrected invitation must not keep showing stale details.
    const selected =
        desk.invites.find((i) => i.id === selectedId) ?? null;

    if (selected) {
        return (
            <>
                <Text style={styles.title}>Private workspace</Text>
                <InvitePreview
                    invite={selected}
                    onNotNow={() => {
                        setSelectedId(null);
                        setDeclinedAuto(true);
                    }}
                    onAccepted={() => setSelectedId(null)}
                />
            </>
        );
    }

    return (
        <>
            <Text style={styles.title}>Private workspace</Text>
            {desk.invites.map((invite) => (
                <Card key={invite.id} variant="artifact">
                    <Text style={styles.eyebrow}>Invitation</Text>
                    <Text style={styles.decisionTitle}>{invite.name}</Text>
                    <Text style={styles.subtitle}>
                        {invite.backerLabel} invited you to a private Friday
                        workspace — review what you're joining first.
                    </Text>
                    <Button
                        label="Review invitation"
                        onPress={() => setSelectedId(invite.id)}
                    />
                </Card>
            ))}
            {desk.invites.length > 0 ? (
                <Pressable
                    onPress={() => setShowSetup((v) => !v)}
                    accessibilityRole="button"
                >
                    <Text style={styles.inlineLink}>
                        {showSetup
                            ? "Hide the setup form"
                            : "Or start your own workspace →"}
                    </Text>
                </Pressable>
            ) : null}
            {desk.invites.length === 0 || showSetup ? <BackerSetup /> : null}
        </>
    );
}

function BackerSetup() {
    const create = useMutation(api.privateWorkspace.create);
    const [name, setName] = useState("");
    const [leadEmail, setLeadEmail] = useState("");
    const [label, setLabel] = useState("");
    const [unit, setUnit] = useState("");
    const [precision, setPrecision] = useState<Precision>("whole");
    const [focus, setFocus] = useState("");
    const [relationship, setRelationship] = useState("");
    const [showExamples, setShowExamples] = useState(false);
    const [showFunding, setShowFunding] = useState(false);
    const [support, setSupport] = useState<SupportKind>("undecided");
    const [budget, setBudget] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** Apply a starting example to the measure fields only — never name, invite, or funding. */
    function applyExample(ex: (typeof EXAMPLES)[number]) {
        setLabel(ex.label);
        setUnit(ex.unit);
        setPrecision(ex.precision);
        setFocus(ex.focus);
    }

    async function submit() {
        setError(null);
        const budgetKes = budget.trim() === "" ? undefined : Number(budget);
        setBusy(true);
        try {
            await create({
                name,
                leadEmail,
                measure: { label, unit, precision },
                pricingFocus: focus.trim() || undefined,
                relationship: relationship.trim() || undefined,
                supportKind: showFunding ? support : undefined,
                budgetKes: showFunding ? budgetKes : undefined,
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not create the workspace.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card>
            <Text style={styles.eyebrow}>Back someone's work, quietly</Text>
            <Text style={styles.decisionTitle}>Open a private workspace</Text>
            <Text style={styles.fieldHint}>
                One venture lead, four Fridays, no public record. Nothing is
                emailed — you'll tell them yourself.
            </Text>
            <View style={styles.gap}>
                <Text style={styles.fieldLabel}>Workspace name</Text>
                <Input
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Friday check-ins"
                    accessibilityLabel="Workspace name"
                />
                <Text style={styles.fieldLabel}>The venture lead's email</Text>
                <Input
                    value={leadEmail}
                    onChangeText={setLeadEmail}
                    placeholder="lead@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    accessibilityLabel="The venture lead's email"
                />
                <Text style={styles.fieldHint}>
                    They'll sign in here with that same address — you share it
                    with them, we don't email it.
                </Text>

                <Pressable onPress={() => setShowExamples((v) => !v)} accessibilityRole="button">
                    <Text style={styles.inlineLink}>
                        {showExamples ? "Hide starting examples" : "Use a starting example"}
                    </Text>
                </Pressable>
                {showExamples ? (
                    <View style={styles.chipRow}>
                        {EXAMPLES.map((ex) => (
                            <Chip
                                key={ex.name}
                                label={ex.name}
                                active={false}
                                onPress={() => applyExample(ex)}
                            />
                        ))}
                    </View>
                ) : null}

                <Text style={styles.fieldLabel}>What are you tracking?</Text>
                <Input
                    value={label}
                    onChangeText={setLabel}
                    placeholder="e.g. Repeat customers"
                    accessibilityLabel="Measure label"
                />
                <Text style={styles.fieldLabel}>Unit, e.g. orders or hours</Text>
                <Input
                    value={unit}
                    onChangeText={setUnit}
                    placeholder="e.g. customers"
                    accessibilityLabel="Measure unit"
                />
                <View style={styles.chipRow}>
                    <Chip
                        label="Whole numbers"
                        active={precision === "whole"}
                        onPress={() => setPrecision("whole")}
                    />
                    <Chip
                        label="Decimals allowed"
                        active={precision === "decimal"}
                        onPress={() => setPrecision("decimal")}
                    />
                </View>
                <Text style={styles.fieldLabel}>When discussing pricing, review… (optional)</Text>
                <Input
                    value={focus}
                    onChangeText={setFocus}
                    placeholder="e.g. the cost of fulfilling one order"
                    accessibilityLabel="Optional pricing focus"
                />
                <Text style={styles.fieldLabel}>Your relationship (optional)</Text>
                <Input
                    value={relationship}
                    onChangeText={setRelationship}
                    placeholder="e.g. mentor, aunt, neighbour"
                    accessibilityLabel="Optional relationship"
                />

                <Pressable onPress={() => setShowFunding((v) => !v)} accessibilityRole="button">
                    <Text style={styles.inlineLink}>
                        {showFunding
                            ? "Hide funding options"
                            : "Record a funding understanding (optional)"}
                    </Text>
                </Pressable>
                {showFunding ? (
                    <>
                        <Text style={styles.fieldHint}>
                            Planning only; no money moves.
                        </Text>
                        <View style={styles.chipRow}>
                            {SUPPORT_OPTIONS.map((opt) => (
                                <Chip
                                    key={opt.value}
                                    label={opt.label}
                                    active={support === opt.value}
                                    onPress={() => setSupport(opt.value)}
                                />
                            ))}
                        </View>
                        <Text style={styles.fieldLabel}>Agreed amount (optional, KES)</Text>
                        <Input
                            value={budget}
                            onChangeText={setBudget}
                            placeholder="Planning only — nothing moves"
                            keyboardType="number-pad"
                            accessibilityLabel="Agreed amount in KES, optional"
                        />
                    </>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button
                    label={busy ? "Creating…" : "Create private workspace"}
                    onPress={() => void submit()}
                    disabled={busy}
                    busy={busy}
                />
            </View>
        </Card>
    );
}

function PendingInvite({ workspace }: { workspace: HomeDesk["workspace"] }) {
    const changeInvite = useMutation(api.privateWorkspace.changeInvite);
    const [editing, setEditing] = useState(false);
    const [email, setEmail] = useState(workspace.leadEmail);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function save() {
        setBusy(true);
        setError(null);
        try {
            await changeInvite({ workspaceId: workspace.id, leadEmail: email });
            setEditing(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not update the invite.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card>
            <Text style={styles.eyebrow}>Waiting for acceptance</Text>
            <Text style={styles.subtitle}>
                Nothing was emailed. Tell{" "}
                <Text style={{ fontWeight: "700" }}>{workspace.leadEmail}</Text> to
                open this same page and sign in with that address — the
                invitation will be waiting.
            </Text>
            {editing ? (
                <View style={styles.gap}>
                    <Input
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        accessibilityLabel="Correct the venture lead's email"
                    />
                    {error ? <Text style={styles.error}>{error}</Text> : null}
                    <Button label={busy ? "Saving…" : "Save address"} onPress={() => void save()} busy={busy} />
                    <Pressable onPress={() => setEditing(false)}>
                        <Text style={styles.inlineLink}>Cancel</Text>
                    </Pressable>
                </View>
            ) : (
                <Pressable onPress={() => setEditing(true)} accessibilityRole="button">
                    <Text style={styles.inlineLink}>Correct the address →</Text>
                </Pressable>
            )}
        </Card>
    );
}

function ReportForm({ week, measure }: { week: WeekView; measure: Measure }) {
    const report = useMutation(api.privateWorkspace.report);
    const [value, setValue] = useState("");
    const [note, setNote] = useState("");
    const [ask, setAsk] = useState("");
    const [kind, setKind] = useState<RequestKind | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const blank = value.trim() === "";
    const parsed = Number(value);
    const invalid =
        !blank &&
        (!Number.isFinite(parsed) ||
            parsed < 0 ||
            (measure.precision === "whole" && !Number.isSafeInteger(parsed)));

    async function submit() {
        setError(null);
        if (blank) {
            setError("Enter this week's value — zero counts too.");
            return;
        }
        if (invalid) {
            setError(
                measure.precision === "whole"
                    ? "Enter zero or a positive whole number."
                    : "Enter zero or a positive number."
            );
            return;
        }
        if (!note.trim()) {
            setError("Add one short note about the week.");
            return;
        }
        setBusy(true);
        try {
            await report({
                value: parsed,
                note,
                ask: ask.trim() || undefined,
                requestKind: ask.trim() ? (kind ?? undefined) : undefined,
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not file the report.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card>
            <Text style={styles.eyebrow}>This week · due {formatFriday(week.deadline)}</Text>
            <Text style={styles.decisionTitle}>File this week's report</Text>
            <View style={styles.gap}>
                <Text style={styles.fieldLabel}>{measure.label} this week</Text>
                <Input
                    value={value}
                    onChangeText={setValue}
                    placeholder={`Enter the value in ${measure.unit}.`}
                    keyboardType={measure.precision === "whole" ? "number-pad" : "decimal-pad"}
                    accessibilityLabel={`${measure.label} this week in ${measure.unit}, zero allowed`}
                />
                <Text style={styles.fieldLabel}>One short note</Text>
                <Input
                    value={note}
                    onChangeText={setNote}
                    placeholder="e.g. quoted two jobs; Tuesday was slow"
                    multiline
                    accessibilityLabel="One short note about the week"
                />
                <Text style={styles.fieldLabel}>Ask for help (optional)</Text>
                <Input
                    value={ask}
                    onChangeText={setAsk}
                    placeholder="e.g. a supplier introduction for materials"
                    multiline
                    accessibilityLabel="Optional help request"
                />
                {ask.trim() ? (
                    <View style={styles.chipRow}>
                        {KIND_OPTIONS.map((opt) => (
                            <Chip
                                key={opt.value}
                                label={opt.label}
                                active={kind === opt.value}
                                onPress={() => setKind(opt.value)}
                            />
                        ))}
                    </View>
                ) : null}
                <Text style={styles.fieldHint}>
                    With a help request, your backer sees this entire update immediately.
                    Otherwise the value and note stay private until Friday.
                </Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button
                    label={busy ? "Filing…" : "File the report"}
                    onPress={() => void submit()}
                    disabled={busy || invalid}
                    busy={busy}
                />
            </View>
        </Card>
    );
}

function WeekEntry({ week, role, measure }: { week: WeekView; role: "backer" | "lead"; measure: Measure }) {
    const outcome = useMutation(api.privateWorkspace.outcome);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function mark(result: "helped" | "not_yet") {
        setBusy(true);
        setError(null);
        try {
            await outcome({ weekId: week.id, result });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save feedback.");
        } finally {
            setBusy(false);
        }
    }

    const responseLabel =
        week.response === "help"
            ? "Backer: I can help."
            : week.response === "talk"
              ? "Backer: let's talk."
              : week.response === "pass"
                ? "Backer: not this week."
                : null;
    const outcomeLabel =
        week.outcome === "helped"
            ? "Lead: it helped."
            : week.outcome === "not_yet"
              ? "Lead: not yet."
              : null;
    const canMarkOutcome =
        role === "lead" &&
        (week.response === "help" || week.response === "talk") &&
        week.outcome !== "helped";

    return (
        <View style={styles.weekRow}>
            <View style={styles.weekHead}>
                <Text style={styles.weekLabel}>WEEK {week.week}</Text>
                <Text style={styles.weekMeta}>
                    {week.closed ? `Closed ${formatFriday(week.deadline)}` : `Due ${formatFriday(week.deadline)}`}
                </Text>
            </View>
            {week.brief ? (
                week.brief.map((line, i) => (
                    <Text key={i} style={styles.weekLine}>
                        {line}
                    </Text>
                ))
            ) : week.report ? (
                <>
                    <Text style={styles.weekLine}>
                        {formatValue(week.report.value, measure.precision)} {measure.unit} —{" "}
                        {week.report.note}
                    </Text>
                    {week.report.ask ? (
                        <Text style={styles.weekLine}>Asked: {week.report.ask}</Text>
                    ) : null}
                </>
            ) : week.reportPending ? (
                <Text style={styles.weekLineQuiet}>Report filed — private until Friday.</Text>
            ) : week.closed ? (
                <Text style={styles.weekLineQuiet}>No check-in received.</Text>
            ) : Date.now() < week.deadline - 7 * 86400000 ? (
                <Text style={styles.weekLineQuiet}>Upcoming.</Text>
            ) : (
                <Text style={styles.weekLineQuiet}>Open — waiting on the lead.</Text>
            )}
            {responseLabel ? <Text style={styles.weekLineQuiet}>{responseLabel}</Text> : null}
            {outcomeLabel ? <Text style={styles.weekLineQuiet}>{outcomeLabel}</Text> : null}
            {canMarkOutcome && !busy ? (
                <View style={styles.chipRow}>
                    <Chip
                        label="It helped"
                        active={week.outcome === "helped"}
                        onPress={() => void mark("helped")}
                    />
                    {week.outcome !== "not_yet" ? (
                        <Chip
                            label="Not yet"
                            active={false}
                            onPress={() => void mark("not_yet")}
                        />
                    ) : null}
                </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
    );
}

/** Focused follow-up for the lead's earliest unanswered outcome — the same
 * WeekEntry controls as history, rendered directly under the cover. */
function FollowUpCard({
    week,
    measure,
}: {
    week: WeekView;
    measure: Measure;
}) {
    return (
        <View style={styles.bookCover}>
            <View style={styles.bookSpine} />
            <View style={styles.bookBody}>
                <Text style={styles.eyebrow}>Follow-up waiting on you</Text>
                <WeekEntry week={week} role="lead" measure={measure} />
            </View>
        </View>
    );
}

/** Four-Friday totals for the "review together" deep link. */
function ReviewSummary({ desk }: { desk: HomeDesk }) {
    const reported = desk.weeks.filter((w) => w.report || w.reportPending).length;
    const asks = desk.weeks.filter((w) => w.report?.ask).length;
    const helped = desk.weeks.filter((w) => w.outcome === "helped").length;
    return (
        <Card variant="artifact">
            <Text style={styles.eyebrow}>After four Fridays</Text>
            <Text style={styles.decisionTitle}>Review together</Text>
            <Text style={styles.subtitle}>
                {reported} of 4 weeks reported · {asks} help{" "}
                {asks === 1 ? "request" : "requests"} ·{" "}
                {helped === 1 ? "1 marked helpful" : `${helped} marked helpful`}
            </Text>
            <Text style={styles.subtitle}>
                Read the briefs below and decide together whether this rhythm
                is worth keeping — nothing here decides for you.
            </Text>
        </Card>
    );
}

function ServiceBook({ desk, intent }: { desk: HomeDesk; intent?: string }) {
    const respond = useMutation(api.privateWorkspace.respond);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function answer(weekId: Id<"privateWorkspaceWeeks">, choice: "help" | "talk" | "pass") {
        setBusy(true);
        setError(null);
        try {
            await respond({ weekId, choice });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not answer.");
        } finally {
            setBusy(false);
        }
    }

    // Earliest open week drives the UI window; the server remains the
    // authority on whether a report is accepted for it.
    const openWeek = desk.weeks.find((w) => !w.closed);
    const leadMustReport = desk.role === "lead" && openWeek && !openWeek.report;
    const leadSubmitted = desk.role === "lead" && openWeek?.report;
    const ws = desk.workspace;
    // Deep-link targets rendered just below the cover.
    const followUpWeek =
        intent === "feedback" && desk.role === "lead"
            ? desk.weeks.find(
                  (w) =>
                      (w.response === "help" || w.response === "talk") &&
                      !w.outcome
              )
            : undefined;

    return (
        <>
            <View style={styles.bookCover}>
                <View style={styles.bookSpine} />
                <View style={styles.bookBody}>
                    <Text style={styles.eyebrow}>Private service book</Text>
                    <Text style={styles.title}>{ws.name}</Text>
                    <Text style={styles.subtitle}>
                        {desk.role === "backer" ? "You back this work" : "You lead this work"} ·{" "}
                        {ws.measure.label} in {ws.measure.unit}
                        {ws.relationship ? ` · ${ws.relationship}` : ""}
                        {ws.supportKind ? ` · ${SUPPORT_LABEL[ws.supportKind]}` : ""}
                        {ws.budgetKes != null
                            ? ` · agreed ${ws.budgetKes.toLocaleString("en-KE")} KES`
                            : ""}
                    </Text>
                    <Text style={styles.instruction}>{INSTRUCTION}</Text>
                </View>
            </View>

            {desk.role === "backer" && !ws.leadJoined ? (
                <PendingInvite workspace={ws} />
            ) : null}

            {/* Outstanding work stays primary; the four-Friday summary follows. */}
            {followUpWeek ? (
                <FollowUpCard week={followUpWeek} measure={ws.measure} />
            ) : null}
            {desk.role === "backer" && desk.openAsk ? (
                <View style={styles.decisionCard}>
                    <Text style={styles.eyebrow}>One decision for you · week {desk.openAsk.week}</Text>
                    <Text style={styles.decisionAsk}>{desk.openAsk.ask}</Text>
                    <Text style={styles.weekLineQuiet}>
                        Suggested next step — {desk.openAsk.suggestion}
                    </Text>
                    <View style={styles.decisionButtons}>
                        <Button
                            label="I can help"
                            variant="approve"
                            onPress={() => void answer(desk.openAsk!.weekId, "help")}
                            disabled={busy}
                        />
                        <Button
                            label="Let's talk"
                            onPress={() => void answer(desk.openAsk!.weekId, "talk")}
                            disabled={busy}
                        />
                        <Button
                            label="Not this week"
                            variant="ghost"
                            onPress={() => void answer(desk.openAsk!.weekId, "pass")}
                            disabled={busy}
                        />
                    </View>
                    {error ? <Text style={styles.error}>{error}</Text> : null}
                </View>
            ) : null}

            {desk.reviewComplete ? <ReviewSummary desk={desk} /> : null}

            {leadMustReport ? (
                <ReportForm key={openWeek.id} week={openWeek} measure={ws.measure} />
            ) : null}
            {leadSubmitted ? (
                <Card>
                    <Text style={styles.eyebrow}>Filed · week {openWeek.week}</Text>
                    <Text style={styles.subtitle}>
                        {formatValue(openWeek.report!.value, ws.measure.precision)}{" "}
                        {ws.measure.unit} — {openWeek.report!.note}
                        {openWeek.report!.ask ? ` Asked: ${openWeek.report!.ask}` : ""}
                    </Text>
                    <Text style={styles.fieldHint}>
                        Filed for this week — you can't submit twice.
                    </Text>
                </Card>
            ) : null}

            <View>
                <SectionLabel>The weeks</SectionLabel>
                <View style={styles.bookCover}>
                    <View style={styles.bookSpine} />
                    <View style={styles.bookBody}>
                        {desk.weeks.length === 0 ? (
                            <Text style={styles.weekLineQuiet}>
                                Weeks appear once the venture lead joins.
                            </Text>
                        ) : (
                            desk.weeks
                                .filter((w) => w.id !== followUpWeek?.id)
                                .map((w) => (
                                    <WeekEntry
                                        key={w.id}
                                        week={w}
                                        role={desk.role}
                                        measure={ws.measure}
                                    />
                                ))
                        )}
                    </View>
                </View>
            </View>
        </>
    );
}
