import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "edge-runtime",
        include: ["convex/**/*.test.ts"],
        exclude: ["convex/_generated/**"],
        passWithNoTests: true,
    },
});
