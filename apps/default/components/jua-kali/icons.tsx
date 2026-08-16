import Svg, { Circle, Line, Path } from "react-native-svg";

/**
 * The JuaKali glyph set — hand-drawn 24pt strokes that match the ledger
 * language: 1.75pt rounded strokes, no fills, brass-friendly. Sized by `size`
 * and colored by `color` so glyphs inherit their context.
 */
type GlyphProps = {
    size?: number;
    color?: string;
    strokeWidth?: number;
};

function glyph(paths: (sw: number, color: string) => React.ReactNode, displayName: string) {
    function Glyph({ size = 16, color = "#141816", strokeWidth = 1.75 }: GlyphProps) {
        return (
            <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
                {paths(strokeWidth, color)}
            </Svg>
        );
    }
    Glyph.displayName = displayName;
    return Glyph;
}

export const IconArrowRight = glyph(
    (sw, c) => <Path d="M4 12h15m0 0-6-6m6 6-6 6" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    "IconArrowRight",
);

export const IconArrowLeft = glyph(
    (sw, c) => <Path d="M20 12H5m0 0 6-6m-6 6 6 6" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    "IconArrowLeft",
);

export const IconCheck = glyph(
    (sw, c) => <Path d="m4.5 12.5 5 5 10-11" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    "IconCheck",
);

export const IconX = glyph(
    (sw, c) => <Path d="M6 6l12 12M18 6 6 18" stroke={c} strokeWidth={sw} strokeLinecap="round" />,
    "IconX",
);

export const IconChevronDown = glyph(
    (sw, c) => <Path d="m5 9 7 7 7-7" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    "IconChevronDown",
);

export const IconShare = glyph(
    (sw, c) => (
        <>
            <Path d="M12 3v12" stroke={c} strokeWidth={sw} strokeLinecap="round" />
            <Path d="m7.5 7.5 4.5-4.5 4.5 4.5" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
            <Path
                d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
                stroke={c}
                strokeWidth={sw}
                strokeLinecap="round"
            />
        </>
    ),
    "IconShare",
);

/** Evidence — a chain link, for chips that cite proof. */
export const IconLink = glyph(
    (sw, c) => (
        <>
            <Path
                d="M10 14a4.2 4.2 0 0 0 6 0l3.2-3.2a4.24 4.24 0 0 0-6-6L11.6 6.4"
                stroke={c}
                strokeWidth={sw}
                strokeLinecap="round"
            />
            <Path
                d="M14 10a4.2 4.2 0 0 0-6 0l-3.2 3.2a4.24 4.24 0 0 0 6 6l1.6-1.6"
                stroke={c}
                strokeWidth={sw}
                strokeLinecap="round"
            />
        </>
    ),
    "IconLink",
);

export const IconSend = glyph(
    (sw, c) => <Path d="M4 11.5 20 4l-7.5 16-2.2-6.3L4 11.5Z" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />,
    "IconSend",
);

/** Ledger — ruled lines, the public record. */
export const IconLedger = glyph(
    (sw, c) => (
        <>
            <Path d="M5 4h14v16H5z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />
            <Line x1="9" y1="9" x2="15" y2="9" stroke={c} strokeWidth={sw} strokeLinecap="round" />
            <Line x1="9" y1="13" x2="15" y2="13" stroke={c} strokeWidth={sw} strokeLinecap="round" />
        </>
    ),
    "IconLedger",
);

/** Capital — a cut stone, the pledge glyph. */
export const IconCapital = glyph(
    (sw, c) => <Path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />,
    "IconCapital",
);

/** KPI — a rising step. */
export const IconTrend = glyph(
    (sw, c) => (
        <>
            <Path d="M4 19h16" stroke={c} strokeWidth={sw} strokeLinecap="round" />
            <Path d="m5 15 4.5-5 3.5 3L19 7" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        </>
    ),
    "IconTrend",
);

/** Digest — the pen that writes the record. */
export const IconPen = glyph(
    (sw, c) => (
        <>
            <Path d="M4 20h4l11-11a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />
            <Line x1="13.5" y1="6.5" x2="17.5" y2="10.5" stroke={c} strokeWidth={sw} />
        </>
    ),
    "IconPen",
);

export const IconBolt = glyph(
    (sw, c) => <Path d="M13 3 5 13.5h5.5L10 21l8-10.5h-5.5L13 3Z" stroke={c} strokeWidth={sw} strokeLinejoin="round" />,
    "IconBolt",
);

/** Jua's mark in glyph form — the four-point agent signature. */
export const IconSparkle = glyph(
    (sw, c) => (
        <Path
            d="M12 3.5c.7 4 1.8 5.1 5.8 5.8-4 .7-5.1 1.8-5.8 5.8-.7-4-1.8-5.1-5.8-5.8 4-.7 5.1-1.8 5.8-5.8ZM18.2 14.6c.35 2 1 2.65 3 3-2 .35-2.65 1-3 3-.35-2-1-2.65-3-3 2-.35 2.65-1 3-3Z"
            stroke={c}
            strokeWidth={sw}
            strokeLinejoin="round"
        />
    ),
    "IconSparkle",
);

export const IconGlobe = glyph(
    (sw, c) => (
        <>
            <Circle cx="12" cy="12" r="8.5" stroke={c} strokeWidth={sw} />
            <Path d="M3.5 12h17M12 3.5c-4.8 4.9-4.8 12.1 0 17 4.8-4.9 4.8-12.1 0-17Z" stroke={c} strokeWidth={sw} />
        </>
    ),
    "IconGlobe",
);
