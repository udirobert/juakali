import Google from "@auth/core/providers/google";
import GitHub from "@auth/core/providers/github";
import Apple from "@auth/core/providers/apple";
import { Password } from "@convex-dev/auth/providers/Password";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";

import { env } from "./env";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
    providers: [Google, GitHub, Apple, Password, Anonymous],
    callbacks: {
        async redirect({ redirectTo }) {
            // SITE_URL may be undefined during the brief pre-provisioning window
            // before Bloom writes the domain vars; nullish-coalesce to "" so the
            // branches below still produce a sensible (relative) redirect.
            const siteUrl = (env.SITE_URL ?? "").replace(/\/$/, "");
            if (redirectTo.startsWith("/") || redirectTo.startsWith("?")) {
                return `${siteUrl}${redirectTo}`;
            }
            if (redirectTo.startsWith(siteUrl)) {
                return redirectTo;
            }
            // Allow native app schemes (exp://, myapp://, etc.) for mobile OAuth
            const match = redirectTo.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
            if (match && !["http", "https"].includes(match[1].toLowerCase())) {
                return redirectTo;
            }
            return siteUrl;
        },
    },
});
