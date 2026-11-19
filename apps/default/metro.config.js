const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

// Load environment variables from monorepo root
require("@expo/env").loadProjectEnv(monorepoRoot, { force: true });

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo
config.watchFolders = [monorepoRoot];

// Let Metro know where to resolve packages from
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(monorepoRoot, "node_modules"),
];

// Resolve `@/convex/*` and `@/shared/*` aliases at bundle time. tsconfig#paths
// is honored only by tsc, not by Metro — without this, `@/convex/_generated/api`
// imports fail at bundle time even though tsc resolves them cleanly. This
// mirrors the production setup in `apps/mobile/metro.config.js` in the Bloom
// monorepo (the canonical reference for Expo-Convex monorepo apps).
config.resolver.extraNodeModules = {
    "@/convex": path.resolve(monorepoRoot, "packages/backend/convex"),
    "@/shared": path.resolve(monorepoRoot, "packages/shared/src"),
};

// @bitauth/libauth's crypto/default-crypto-instances.js instantiates WASM at
// module load via top-level await — Metro cannot parse TLA, and native runtimes
// lack WebAssembly anyway. Redirect that one module to a lazy shim; the app
// awaits `ensureBchCrypto()` before any crypto path (wallet connect, hashing).
const defaultResolveRequest =
    config.resolver.resolveRequest ??
    ((context, moduleName, platform) => context.resolveRequest(context, moduleName, platform));
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (
        (moduleName === "./default-crypto-instances.js" ||
            moduleName === "../crypto/default-crypto-instances.js" ||
            moduleName.endsWith("/default-crypto-instances.js") ||
            moduleName.endsWith("/default-crypto-instances")) &&
        context.originModulePath?.includes("@bitauth/libauth")
    ) {
        return {
            type: "sourceFile",
            filePath: path.resolve(projectRoot, "lib/bch/libauth-crypto-shim.ts"),
        };
    }
    return defaultResolveRequest(context, moduleName, platform);
};

module.exports = config;
