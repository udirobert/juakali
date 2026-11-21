import { View } from "react-native";

import { PrivateWorkspace } from "@/components/jua-kali/private-workspace";
import { color } from "@/components/jua-kali/theme";

export default function PrivateWorkspaceRoute() {
    return (
        <View style={{ flex: 1, backgroundColor: color.field }}>
            <PrivateWorkspace />
        </View>
    );
}
