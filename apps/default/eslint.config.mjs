import convexPlugin from "@convex-dev/eslint-plugin";
import tseslint from "typescript-eslint";

export default [
    { ignores: ["node_modules/", "convex/_generated/"] },
    ...tseslint.configs.recommended,
    ...convexPlugin.configs.recommended,
    {
        // `require()` is the standard Expo / React Native asset-loading
        // pattern (`require("./assets/icon.png")` is what Metro resolves
        // at bundle time -- ES `import` doesn't work for asset URIs).
        // Off in app code (`*.tsx`) and Metro config; on everywhere else.
        files: ["metro.config.js", "**/*.tsx"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },
];
