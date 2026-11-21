import { Redirect } from "expo-router";

/** Old private-workspace deep link — the canonical route is /workspace/private. */
export default function KitchenRedirect() {
    return <Redirect href="/workspace/private" />;
}
