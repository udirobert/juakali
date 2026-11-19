/**
 * Ledger print — ordered-dither halftone in ledger ink.
 *
 * The treatment turns field photos into newspaper plates: KPI evidence and
 * venture imagery render as if they were printed onto the public ledger,
 * not pasted in. Technique adapted from the Codrops "Visualizing Dithering"
 * demo (Bayer/clustered threshold maps, per-cell `lum < t` ink test) — the
 * plate-prep (percentile stretch + gamma lift) and the duotone ink/paper
 * output are ours: photos print in JuaKali charcoal or brass on paper.
 *
 * Pure math, no DOM: takes RGBA bytes + dims, returns RGBA bytes. The web
 * canvas component drives it; a build-time script could do the same.
 */

/** Clustered-dot halftone threshold map (8×8) — the newspaper look. */
export const HALFTONE_8 = [
    24, 10, 12, 26, 35, 47, 49, 37,
    8, 0, 2, 14, 45, 59, 61, 51,
    22, 6, 4, 16, 43, 57, 63, 53,
    30, 20, 18, 28, 33, 41, 55, 39,
    34, 46, 48, 36, 25, 11, 13, 27,
    44, 58, 60, 50, 9, 1, 3, 15,
    42, 56, 62, 52, 23, 7, 5, 17,
    32, 40, 54, 38, 31, 21, 19, 29,
] as const;

/** Crisper Bayer order for very small cells. */
export const BAYER_4 = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
] as const;

export type PrintInk = "charcoal" | "brass";

const INKS: Record<PrintInk, { ink: [number, number, number]; paper: [number, number, number] }> = {
    /** Ledger ink on paper — the evidence plate. */
    charcoal: { ink: [20, 24, 22], paper: [247, 246, 242] },
    /** Brass on foam — decorative "riso" variant for hero moments. */
    brass: { ink: [124, 94, 34], paper: [255, 253, 247] },
};

export type DitherResult = {
    data: Uint8ClampedArray;
    width: number;
    height: number;
};

/**
 * Dither one source (RGBA `src`, `srcW`×`srcH`) at `cell`-px cells.
 * `sweep` ∈ [0,1] keeps columns ≤ sweep dithered and leaves the rest in
 * continuous tone — the "printing" reveal.
 */
export function halftone(
    src: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    { cell = 3, ink = "charcoal", sweep = 1 }: { cell?: number; ink?: PrintInk; sweep?: number },
): DitherResult {
    const W = Math.max(1, Math.floor(srcW / cell));
    const H = Math.max(1, Math.floor(srcH / cell));
    const matrix = HALFTONE_8;
    const mSize = 8;
    const pal = INKS[ink];

    // Average each cell from the source at 1 sample/px² of the cell grid.
    const lums = new Float32Array(W * H);
    const tones = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * cell));
            const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * cell));
            const i = (sy * srcW + sx) * 4;
            const r = src[i]!, g = src[i + 1]!, b = src[i + 2]!;
            lums[y * W + x] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            const t = (y * W + x) * 3;
            tones[t] = r; tones[t + 1] = g; tones[t + 2] = b;
        }
    }

    // Plate prep: percentile stretch (5–95) + gamma lift — lifts field-photo
    // mid-tones into the printable range, like prepress tone adjustment.
    const sorted = Float32Array.from(lums).sort();
    const lo = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
    const hi = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
    const range = Math.max(hi - lo, 0.05);
    for (let i = 0; i < lums.length; i++) {
        lums[i] = Math.pow(Math.min(1, Math.max(0, (lums[i]! - lo) / range)), 0.7);
    }

    const out = new Uint8ClampedArray(W * cell * H * cell * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const t = matrix[(y % mSize) * mSize + (x % mSize)]! / 64;
            const revealed = x / W <= sweep;
            let c: [number, number, number] | Float32Array;
            if (revealed) {
                c = lums[y * W + x]! < t ? pal.ink : pal.paper;
            } else {
                const ti = (y * W + x) * 3;
                c = [tones[ti]!, tones[ti + 1]!, tones[ti + 2]!];
            }
            for (let dy = 0; dy < cell; dy++) {
                const row = (y * cell + dy) * (W * cell);
                for (let dx = 0; dx < cell; dx++) {
                    const j = (row + x * cell + dx) * 4;
                    out[j] = c[0]!; out[j + 1] = c[1]!; out[j + 2] = c[2]!; out[j + 3] = 255;
                }
            }
        }
    }
    return { data: out, width: W * cell, height: H * cell };
}
