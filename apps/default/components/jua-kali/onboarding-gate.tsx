import { useEffect, type ReactNode } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";

import {
    InvestorLanding,
    useInvestorOnboardingGate,
} from "@/components/jua-kali/investor-onboarding";
import { color } from "@/components/jua-kali/theme";

function hasDeepLinkSkip(): boolean {
    if (Platform.OS !== "web" || typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get("c") || params.get("v") || params.get("ledger") || params.get("tab"));
}

/** Gates the signed-in product shell behind investor onboarding. */
export function OnboardingGate({ children }: { children: ReactNode }) {
    const onboarding = useInvestorOnboardingGate();
    const router = useRouter();
    const { isAuthenticated } = useConvexAuth();
    const { signIn } = useAuthActions();

    useEffect(() => {
        if (!__DEV__ || Platform.OS !== "web" || typeof window === "undefined") return;
        if (isAuthenticated) return;
        if (new URLSearchParams(window.location.search).get("dev_anon") !== "1") return;
        void signIn("anonymous");
    }, [isAuthenticated, signIn]);

    useEffect(() => {
        if (onboarding.showLanding && hasDeepLinkSkip()) {
            void onboarding.completeLanding();
        }
    }, [onboarding.showLanding, onboarding.completeLanding]);

    if (!onboarding.ready) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.stone }}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }

    if (onboarding.showLanding && !hasDeepLinkSkip()) {
        return (
            <InvestorLanding
                onEnter={(opts) => {
                    void onboarding.completeLanding().then(() => {
                        if (opts?.commitmentId) {
                            router.replace(`/(tabs)/deals?c=${opts.commitmentId}`);
                        } else {
                            router.replace("/(tabs)/today");
                        }
                    });
                }}
            />
        );
    }

    return <>{children}</>;
}

/** Legacy query-param entry → path routes. */
export function LegacyRedirect() {
    if (Platform.OS === "web" && typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get("tab");
        const ledger = params.get("ledger");
        const venture = params.get("venture");
        const lab = params.get("lab");
        const c = params.get("c");
        const v = params.get("v");

        if (lab === "1") return <Redirect href="/lab" />;
        if (venture) return <Redirect href="/workspace/founder" />;
        if (ledger) return <Redirect href={`/(tabs)/proof?ledger=${encodeURIComponent(ledger)}`} />;
        if (tab === "ledger") return <Redirect href="/(tabs)/proof" />;
        if (tab === "venture") return <Redirect href="/workspace/founder" />;
        if (tab === "lab") return <Redirect href="/lab" />;
        if (c) return <Redirect href={`/(tabs)/deals?c=${encodeURIComponent(c)}`} />;
        if (v) return <Redirect href={`/(tabs)/deals?v=${encodeURIComponent(v)}`} />;
        if (tab === "home" || tab === "today" || tab === "deals") {
            return <Redirect href={tab === "deals" ? "/(tabs)/deals" : "/(tabs)/today"} />;
        }
    }
    return <Redirect href="/(tabs)/today" />;
}
