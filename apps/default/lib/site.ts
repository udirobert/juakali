/** Canonical public site — Netlify production. */
export const SITE_URL = "https://juakaliapp.netlify.app";

export const SITE = {
    name: "JuaKali",
    title: "JuaKali · Invest in public",
    description:
        "Soft-pledge into apprentice ventures. An agent drives weekly KPIs, digests, and a public ledger — non-securities, non-settling commitments.",
    locale: "en_KE",
    twitterHandle: "",
    themeColor: "#E6E4DF",
    backgroundColor: "#141816",
    ogImagePath: "/og.jpg",
    ogImageAlt: "JuaKali — Invest in public. Soft pledges, agent ops, public ledger.",
} as const;

export function absoluteUrl(path: string) {
    if (path.startsWith("http")) return path;
    return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
