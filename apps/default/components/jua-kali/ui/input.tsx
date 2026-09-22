import { StyleSheet, TextInput, type TextInputProps } from "react-native";

import { color, font, radius } from "@/components/jua-kali/theme";

/** The input — paper fill, hairline-strong border, 44pt comfortable. */
export function Input(props: TextInputProps) {
    return <TextInput placeholderTextColor={color.mist} {...props} style={[styles.input, props.style]} />;
}

const styles = StyleSheet.create({
    input: {
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: radius.sm,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: color.ink,
        backgroundColor: color.paper,
        fontFamily: font.body,
        fontSize: 15,
        lineHeight: 22,
    },
});
