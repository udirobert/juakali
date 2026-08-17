// One-off generator for the JuaKali launcher identity.
// Renders the LivingSun language (partial rise, layered asymmetric rays,
// horizon hairline) to PNGs with a pure-Node encoder — no runtime deps.
//
//   node scripts/generate-brand-assets.mjs
//
// Writes:
//   assets/images/icon.png            (1024, stone bg, centered mark)
//   assets/images/adaptive-icon.png   (1024, transparent, safe-zone mark)
//   assets/images/splash-icon.png     (1024, transparent, wide rising scene)
//   assets/images/favicon.png         (64, transparent, compact mark)

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// --- Brand tokens (mirror apps/default/components/jua-kali/theme.ts) -------
const BRASS = [166, 124, 45];
const BRASS_LIGHT = [196, 161, 90];
const BRASS_DEEP = [124, 94, 34];
const STONE = [230, 228, 223];
const CHARCOAL = [20, 24, 22];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "images");

// --- Pure-Node PNG encoder -------------------------------------------------
function crc32(buf) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

/** rgba rows -> PNG */
function encodePng(size, rgba) {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    // raw scanlines with filter byte 0
    const stride = size * 4;
    const raw = Buffer.alloc((stride + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const idat = deflateSync(raw, { level: 9 });
    return Buffer.concat([
        sig,
        chunk("IHDR", ihdr),
        chunk("IDAT", idat),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

// --- Geometry helpers ------------------------------------------------------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (e0, e1, x) => {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
};

// Distance from point p to segment a->b (used for anti-aliased strokes).
function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = clamp01(t);
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
}

/**
 * Render a canvas of RGBA pixels.
 * draw(x, y) -> [r, g, b, a] with a in 0..1 (premultiplied not required).
 */
function render(size, draw) {
    const rgba = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // 4x4 supersample for clean edges
            let r = 0, g = 0, b = 0, a = 0;
            for (let sy = 0; sy < 4; sy++) {
                for (let sx = 0; sx < 4; sx++) {
                    const px = x + (sx + 0.5) / 4;
                    const py = y + (sy + 0.5) / 4;
                    const [cr, cg, cb, ca] = draw(px, py);
                    r += cr * ca;
                    g += cg * ca;
                    b += cb * ca;
                    a += ca;
                }
            }
            const n = 16;
            const i = (y * size + x) * 4;
            rgba[i] = Math.round(r / n);
            rgba[i + 1] = Math.round(g / n);
            rgba[i + 2] = Math.round(b / n);
            rgba[i + 3] = Math.round((a / n) * 255);
        }
    }
    return rgba;
}

/**
 * The sun mark: a core disc with a layered ray fan rising from the lower
 * half (dawn below the horizon, longer rays above = partial rise), plus an
 * optional horizon hairline. Rays vary in length for an organic, non-weather
 * glyph. `rise` (0..1) lifts the core and lights the rays.
 */
function sunScene(opts) {
    const {
        size,
        cx,
        cy,
        coreR,
        rise = 1,
        rayCount = 12,
        rayGap = 0.045 * size,
        horizonY = null,
        horizonColor = CHARCOAL,
        horizonAlpha = 0.18,
        baseColor = BRASS,
        lightColor = BRASS_LIGHT,
        deepColor = BRASS_DEEP,
        background = null, // [r,g,b] or null for transparent
    } = opts;

    const coreY = cy + (1 - rise) * coreR * 0.9; // sinks below center at dawn
    const maxRay = coreR * 1.05;

    return (x, y) => {
        let base = [0, 0, 0, 0];

        // Horizon hairline (full-width, drawn before the sun so the sun sits
        // "on" the line).
        if (horizonY != null) {
            const d = Math.abs(y - horizonY);
            const a = (1 - clamp01(d / 1.5)) * horizonAlpha;
            if (a > 0.001) {
                base = [horizonColor[0], horizonColor[1], horizonColor[2], a];
            }
        }

        // Ray fan: rays originate just outside the core on the lower half and
        // point outward. Bottom rays are short (below-horizon dawn), top rays
        // long — the "partial rise" signature.
        const rayW = Math.max(1.2, size * 0.05);
        for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * Math.PI * 2 - Math.PI / 2;
            const dirX = Math.cos(angle);
            const dirY = Math.sin(angle);
            // Rays below the horizon are hidden (dawn under the line).
            if (horizonY != null && coreY + dirY * coreR > horizonY) continue;
            const upward = -dirY;
            const lit = 0.3 + 0.7 * clamp01(upward) * rise;
            const lenVar = 0.6 + 0.4 * ((i * 37) % 10) / 10; // organic variance
            const len = maxRay * (0.62 + 0.38 * lit) * lenVar;
            const r1 = coreR + rayGap;
            const r2 = r1 + len;
            const ax = cx + dirX * r1;
            const ay = coreY + dirY * r1;
            const bx = cx + dirX * r2;
            const by = coreY + dirY * r2;
            const d = segDist(x, y, ax, ay, bx, by);
            const cover = 1 - clamp01((d - rayW / 2) / 1.5);
            if (cover > 0.001) {
                const col = lit > 0.75 ? lightColor : lit > 0.45 ? baseColor : deepColor;
                const a = cover * (0.45 + 0.55 * lit);
                if (a > base[3]) {
                    base = [col[0], col[1], col[2], a];
                }
            }
        }

        // Core disc with a soft brass gradient (dawn deep -> noon light).
        const dc = Math.hypot(x - cx, y - coreY);
        const coreCover = 1 - clamp01((dc - coreR) / 1.5);
        if (coreCover > 0.001) {
            const t = clamp01((y - (coreY - coreR)) / (coreR * 2));
            const col = [
                deepColor[0] + (lightColor[0] - deepColor[0]) * t,
                deepColor[1] + (lightColor[1] - deepColor[1]) * t,
                deepColor[2] + (lightColor[2] - deepColor[2]) * t,
            ];
            // A faint highlight arc keeps the disc from reading flat.
            const hl = clamp01(1 - Math.hypot(x - cx, y - (coreY - coreR * 0.4)) / (coreR * 0.9));
            const a = Math.max(coreCover, base[3]);
            base = [
                col[0] + (lightColor[0] - col[0]) * hl * 0.4,
                col[1] + (lightColor[1] - col[1]) * hl * 0.4,
                col[2] + (lightColor[2] - col[2]) * hl * 0.4,
                a,
            ];
        }

        // Composite the sun mark over the background (if any).
        if (background) {
            const bg = background;
            const a = base[3];
            return [
                base[0] * a + bg[0] * (1 - a),
                base[1] * a + bg[1] * (1 - a),
                base[2] * a + bg[2] * (1 - a),
                1,
            ];
        }
        return base;
    };
}

// --- Asset definitions -----------------------------------------------------
const ICON = 1024;
const SPLASH = 1024;
const FAVICON = 64;

// App icon: centered mark on stone, full rise (noon) so it reads boldly.
const iconDraw = sunScene({
    size: ICON,
    cx: ICON / 2,
    cy: ICON / 2 - 20,
    coreR: ICON * 0.175,
    rise: 1,
    rayCount: 16,
    horizonY: ICON * 0.63,
    horizonAlpha: 0.3,
    background: STONE,
});

// Adaptive foreground: transparent, mark inside the Android safe zone
// (center 66%). No horizon so the mask never clips it oddly.
const adaptiveDraw = sunScene({
    size: ICON,
    cx: ICON / 2,
    cy: ICON / 2,
    coreR: ICON * 0.15,
    rise: 0.95,
    rayCount: 16,
    rayGap: 0.04 * ICON,
    horizonY: null,
});

// Splash: wide rising scene — sun low over a full-width horizon.
const splashDraw = sunScene({
    size: SPLASH,
    cx: SPLASH / 2,
    cy: SPLASH * 0.42,
    coreR: SPLASH * 0.12,
    rise: 0.55,
    rayCount: 16,
    horizonY: SPLASH * 0.68,
    horizonAlpha: 0.3,
});

// Favicon: compact mark, transparent.
const faviconDraw = sunScene({
    size: FAVICON,
    cx: FAVICON / 2,
    cy: FAVICON / 2,
    coreR: FAVICON * 0.2,
    rise: 1,
    rayCount: 10,
    rayGap: 0.04 * FAVICON,
    horizonY: null,
});

mkdirSync(OUT, { recursive: true });
const targets = [
    ["icon.png", ICON, iconDraw],
    ["adaptive-icon.png", ICON, adaptiveDraw],
    ["splash-icon.png", SPLASH, splashDraw],
    ["favicon.png", FAVICON, faviconDraw],
];

for (const [name, size, draw] of targets) {
    const rgba = render(size, draw);
    writeFileSync(join(OUT, name), encodePng(size, rgba));
    console.log(`wrote ${name} (${size}x${size})`);
}
