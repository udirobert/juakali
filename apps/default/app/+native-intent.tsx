// Stop the sandbox's expo-router from reacting to URL events. The host
// Bloom app owns all external Universal Links / scheme URLs and routes
// to the right sandbox manifest itself. Without this file, iOS's shared
// NSNotification broadcast routes the same URL into the sandbox's
// runtime, which paints "Unmatched Route" until the host re-mounts the
// sandbox.
export async function redirectSystemPath(): Promise<null> {
    return null;
}
