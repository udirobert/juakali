// CONVEX_SITE_URL is auto-injected by Convex into every deployment. Read it
// directly instead of via ./env: importing the shared env object would pull the
// full env schema into the auth config's dependency graph, and the deploy-time
// auth-config check then requires every declared variable to be set on the
// deployment — including optional integrations (Resend, Twilio, Gemini) this
// deployment deliberately leaves unset.
export default {
    providers: [
        {
            domain: process.env.CONVEX_SITE_URL ?? "",
            applicationID: "convex",
        },
    ],
};
