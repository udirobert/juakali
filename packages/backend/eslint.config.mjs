import convexPlugin from "@convex-dev/eslint-plugin";
import tseslint from "typescript-eslint";

export default [
    { ignores: ["convex/_generated/**"] },
    ...tseslint.configs.recommended,
    ...convexPlugin.configs.recommended,

    // Prevent process.env usage -- use typed env from convex-env instead.
    // Without this the typed schema in convex/env.ts is advisory; with it,
    // every direct process.env access is a hard error and you're forced to
    // declare the var in fullSchema first. The only file allowed to read
    // process.env directly is convex/env.ts itself (in `isPreProvisioning`,
    // to detect the pre-provisioning gap window before Bloom syncs the
    // managed env vars).
    {
        files: ["convex/**/*.ts"],
        ignores: ["convex/env.ts"],
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    selector:
                        "MemberExpression[object.object.name='process'][object.property.name='env']",
                    message:
                        "Use env.VAR_NAME from './env' instead of process.env.VAR_NAME. Add new vars to fullSchema in convex/env.ts.",
                },
            ],
        },
    },

    // =========================================================================
    // CUSTOM PROJECT RULES
    // =========================================================================
    // You can define powerful custom rules inline to enforce project invariants.
    // Below are three examples showing different ESLint techniques. Uncomment
    // and adapt any of these, or use them as templates for your own rules.
    //
    // --- Example 1: Prevent full table scans -----------------------------------
    // Catches ctx.db.query("table").filter(...) without .withIndex() first.
    // Walks the method call chain to detect the pattern.
    //
    // {
    //   files: ["convex/**/*.ts"],
    //   plugins: {
    //     project: {
    //       rules: {
    //         "no-filter-without-index": {
    //           meta: { type: "problem", messages: {
    //             bad: "Using .filter() after .query() without .withIndex() causes a full table scan. Add .withIndex() first."
    //           }, schema: [] },
    //           create(context) {
    //             return {
    //               CallExpression(node) {
    //                 if (node.callee.type !== "MemberExpression" || node.callee.property.name !== "filter") return;
    //                 let cur = node.callee.object;
    //                 let hasIndex = false, hasQuery = false;
    //                 while (cur?.type === "CallExpression" && cur.callee.type === "MemberExpression") {
    //                   const name = cur.callee.property.name;
    //                   if (name === "withIndex" || name === "withSearchIndex") hasIndex = true;
    //                   if (name === "query") hasQuery = true;
    //                   cur = cur.callee.object;
    //                 }
    //                 if (hasQuery && !hasIndex) context.report({ node: node.callee.property, messageId: "bad" });
    //               },
    //             };
    //           },
    //         },
    //       },
    //     },
    //   },
    //   rules: { "project/no-filter-without-index": "error" },
    // },
    //
    // --- Example 2: Require error context on all throws ------------------------
    // Catches bare `throw new Error("msg")` and requires wrapping with context
    // (e.g., enrichError or a custom wrapper). Prevents opaque production errors.
    //
    // {
    //   files: ["convex/**/*.ts"],
    //   plugins: {
    //     project: {
    //       rules: {
    //         "require-error-context": {
    //           meta: { type: "suggestion", messages: {
    //             bare: "Wrap errors with context: throw enrichError(new Error('...'), { userId, table });"
    //           }, schema: [] },
    //           create(context) {
    //             return {
    //               ThrowStatement(node) {
    //                 const ancestors = context.getAncestors();
    //                 if (ancestors.some(a => a.type === "CatchClause")) return;
    //                 if (node.argument?.type === "NewExpression" &&
    //                     node.argument.callee.name === "Error") {
    //                   context.report({ node, messageId: "bare" });
    //                 }
    //               },
    //             };
    //           },
    //         },
    //       },
    //     },
    //   },
    //   rules: { "project/require-error-context": "warn" },
    // },
    //
    // --- Example 3: Warn about ctx.runQuery/runMutation inside queries/mutations -
    // Each ctx.runQuery/runMutation call inside a query or mutation is a separate
    // transaction with per-call overhead. Prefer extracting shared logic into plain
    // helper functions that reuse the same ctx.db instead.
    // See: https://docs.convex.dev/understanding/best-practices/#use-ctxrunquery-and-ctxrunmutation-sparingly-in-queries-and-mutations
    //
    // {
    //   files: ["convex/**/*.ts"],
    //   ignores: ["convex/_generated/**"],
    //   plugins: {
    //     project: {
    //       rules: {
    //         "no-nested-function-calls": {
    //           meta: { type: "suggestion", messages: {
    //             nested: "Avoid ctx.{{method}}() inside {{kind}}s — each call is a separate transaction. Extract a helper that uses ctx.db directly."
    //           }, schema: [] },
    //           create(context) {
    //             const wrappers = new Set(["query", "internalQuery", "mutation", "internalMutation"]);
    //             const banned = new Set(["runQuery", "runMutation"]);
    //             let insideKind = null;
    //             return {
    //               CallExpression(node) {
    //                 if (!insideKind && node.callee.type === "Identifier" && wrappers.has(node.callee.name)) {
    //                   insideKind = node.callee.name.replace("internal", "").replace(/^./, c => c.toLowerCase());
    //                 }
    //                 if (insideKind && node.callee.type === "MemberExpression" &&
    //                     node.callee.object.name === "ctx" && banned.has(node.callee.property.name)) {
    //                   context.report({ node, messageId: "nested", data: { method: node.callee.property.name, kind: insideKind } });
    //                 }
    //               },
    //               "CallExpression:exit"(node) {
    //                 if (node.callee.type === "Identifier" && wrappers.has(node.callee.name)) insideKind = null;
    //               },
    //             };
    //           },
    //         },
    //       },
    //     },
    //   },
    //   rules: { "project/no-nested-function-calls": "warn" },
    // },
    //
    // --- Example 4: Enforce return validators on public functions ---------------
    // Ensures every exported query/mutation/action has a `returns:` property,
    // preventing untyped API responses.
    //
    // {
    //   files: ["convex/**/*.ts"],
    //   ignores: ["convex/_generated/**"],
    //   plugins: {
    //     project: {
    //       rules: {
    //         "require-return-validator": {
    //           meta: { type: "problem", messages: {
    //             missing: "Public Convex functions must include a `returns:` validator for type-safe API responses."
    //           }, schema: [] },
    //           create(context) {
    //             const publicFns = new Set(["query", "mutation", "action"]);
    //             return {
    //               CallExpression(node) {
    //                 if (node.callee.type !== "Identifier" || !publicFns.has(node.callee.name)) return;
    //                 const config = node.arguments[0];
    //                 if (config?.type !== "ObjectExpression") return;
    //                 const hasReturns = config.properties.some(
    //                   p => p.type === "Property" && p.key.type === "Identifier" && p.key.name === "returns"
    //                 );
    //                 if (!hasReturns) context.report({ node, messageId: "missing" });
    //               },
    //             };
    //           },
    //         },
    //       },
    //     },
    //   },
    //   rules: { "project/require-return-validator": "error" },
    // },
];
