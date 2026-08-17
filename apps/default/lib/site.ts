/** Canonical public site — Netlify production. */
export const SITE_URL = "https://juakaliapp.netlify.app";

export const SITE = {
    name: "JuaKali",
    title: "JuaKali · Follow every venture you back",
    description:
        "Jua follows every venture you back, gets the weekly update, and shows you what changed — soft pledges, agent runs, and public proof.",
    locale: "en_KE",
    twitterHandle: "",
    themeColor: "#E6E4DF",
    backgroundColor: "#141816",
    ogImagePath: "/og.jpg",
    ogImageAlt: "JuaKali — Jua follows your ventures and shows what changed.",
} as const;

export function absoluteUrl(path: string) {
    if (path.startsWith("http")) return path;
    return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
