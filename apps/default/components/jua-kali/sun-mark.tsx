import Svg, { Circle, Line } from "react-native-svg";

import { color } from "@/components/jua-kali/theme";

/**
 * The JuaKali mark — a brass sun (jua = sun). Drawn as SVG so it stays crisp
 * at any size and shares geometry with LivingSun. Repeated across surfaces as
 * the brand motif. Decorative by design; hidden from screen readers.
 */
export function SunMark({ size = 40 }: { size?: number }) {
    const c = size / 2;
    const dotR = size * 0.21;
    const gap = size * 0.04;
    const rayLen = size * 0.17;
    const rayW = Math.max(1.5, size * 0.05);

    const rays = Array.from({ length: 8 }, (_, i) => {
        const a = ((i * 45 - 90) * Math.PI) / 180;
        const r1 = dotR + gap;
        const r2 = r1 + rayLen;
        return {
            x1: c + Math.cos(a) * r1,
            y1: c + Math.sin(a) * r1,
            x2: c + Math.cos(a) * r2,
            y2: c + Math.sin(a) * r2,
        };
    });

    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" accessibilityElementsHidden>
            {rays.map((ray, i) => (
                <Line
                    key={i}
                    x1={ray.x1}
                    y1={ray.y1}
                    x2={ray.x2}
                    y2={ray.y2}
                    stroke={color.brass}
                    strokeWidth={rayW}
                    strokeLinecap="round"
                />
            ))}
            <Circle cx={c} cy={c} r={dotR} fill={color.brass} />
        </Svg>
    );
}
