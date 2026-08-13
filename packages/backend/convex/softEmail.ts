import { Email } from "@convex-dev/auth/providers/Email";

/**
 * Soft identity: email magic link.
 * Uses process.env (not ./env) so auth config can load without requiring
 * optional AUTH_* / SOFT_* vars to be provisioned on every deployment.
 *
 * - With AUTH_RESEND_KEY: sends via Resend API
 * - With SOFT_AUTH_INBOX=1: posts to /soft-auth/inbox for demo peek UI
 */
export const SoftEmail = Email({
    id: "soft-email",
    maxAge: 60 * 60 * 24,
    authorize: undefined,
    async sendVerificationRequest({ identifier: email, url }) {
        const normalized = email.trim().toLowerCase();
         
        const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
        const inboxOn = process.env.SOFT_AUTH_INBOX === "1";
        const resendKey = process.env.AUTH_RESEND_KEY;
        const inboxSecret = process.env.SOFT_AUTH_INBOX_SECRET ?? "";
        const from = process.env.AUTH_EMAIL_FROM ?? "JuaKali <onboarding@resend.dev>";
         

        if (inboxOn && site) {
            await fetch(`${site}/soft-auth/inbox`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(inboxSecret ? { "x-soft-auth-secret": inboxSecret } : {}),
                },
                body: JSON.stringify({ email: normalized, url }),
            }).catch((err) => {
                console.error("[soft-email] inbox store failed", err);
            });
        }

        if (resendKey) {
            const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${resendKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from,
                    to: [normalized],
                    subject: "Sign in to JuaKali",
                    text: `Open this link to continue (expires in 24h):\n\n${url}\n\nIf you did not request this, ignore the email.`,
                }),
            });
            if (!res.ok) {
                const detail = await res.text();
                throw new Error(`Resend failed: ${detail}`);
            }
            return;
        }

        if (!inboxOn) {
            console.log(`[soft-email] Magic link for ${normalized}: ${url}`);
            console.warn(
                "[soft-email] Set AUTH_RESEND_KEY to send email, or SOFT_AUTH_INBOX=1 for demo peek."
            );
        }
    },
});
