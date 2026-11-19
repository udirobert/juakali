import { useEffect, useRef } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { halftone, type PrintInk } from "@/lib/print/halftone";

/**
 * Web renderer: loads the photo into an offscreen canvas, runs the ledger
 * halftone, and paints it to a real <canvas> appended into a View host.
 * With `animate`, the dithered plate "prints" left-to-right once the element
 * scrolls into view — evidence resolving into print, the demo's tell.
 *
 * Native falls back to the plain photo (./ledger-print-image.tsx) — canvas
 * is DOM-only and the treatment is an atmosphere, not the data.
 */
export function LedgerPrintImage({
    uri,
    ink = "charcoal",
    cell = 3,
    animate = false,
    sweepSeconds = 2.4,
    aspectRatio,
    alt = "Field photo printed as ledger halftone",
    style,
}: {
    uri: string;
    ink?: PrintInk;
    /** Pixels per halftone cell — smaller = finer print. */
    cell?: number;
    /** Print-sweep entrance when the element becomes visible. */
    animate?: boolean;
    sweepSeconds?: number;
    /** w/h — reserves layout space and center-crops the source. */
    aspectRatio?: number;
    alt?: string;
    style?: StyleProp<ViewStyle>;
}) {
    const hostRef = useRef<View>(null);

    useEffect(() => {
        const host = hostRef.current as unknown as HTMLElement | null;
        if (!host || !uri) return;

        let dead = false;
        let raf = 0;
        let observer: IntersectionObserver | null = null;

        const canvas = document.createElement("canvas");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", alt);
        canvas.style.width = "100%";
        canvas.style.display = "block";
        canvas.style.borderRadius = "4px";
        host.appendChild(canvas);

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            if (dead) return;
            // Center-crop to the requested aspect so a strip prints uniform plates.
            let sw = img.naturalWidth,
                sh = img.naturalHeight,
                sx = 0,
                sy = 0;
            if (aspectRatio) {
                const natural = sw / sh;
                if (natural > aspectRatio) {
                    sw = Math.round(sh * aspectRatio);
                    sx = Math.round((img.naturalWidth - sw) / 2);
                } else {
                    sh = Math.round(sw / aspectRatio);
                    sy = Math.round((img.naturalHeight - sh) / 2);
                }
            }
            const off = document.createElement("canvas");
            off.width = sw;
            off.height = sh;
            const octx = off.getContext("2d");
            if (!octx) return;
            octx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
            const src = octx.getImageData(0, 0, off.width, off.height);

            const paint = (sweep: number) => {
                const out = halftone(src.data, off.width, off.height, { cell, ink, sweep });
                canvas.width = out.width;
                canvas.height = out.height;
                const ctx = canvas.getContext("2d");
                if (!ctx) return;
                const frame = new ImageData(
                    out.data as Uint8ClampedArray<ArrayBuffer>,
                    out.width,
                    out.height,
                );
                ctx.putImageData(frame, 0, 0);
            };

            const run = () => {
                if (!animate) {
                    paint(1);
                    return;
                }
                const t0 = performance.now();
                const frame = (now: number) => {
                    const t = Math.min(1, (now - t0) / (sweepSeconds * 1000));
                    paint(t);
                    if (t < 1 && !dead) raf = requestAnimationFrame(frame);
                };
                raf = requestAnimationFrame(frame);
            };

            if (animate && "IntersectionObserver" in window) {
                observer = new IntersectionObserver(
                    (entries) => {
                        if (entries.some((e) => e.isIntersecting)) {
                            observer?.disconnect();
                            run();
                        }
                    },
                    { threshold: 0.3 },
                );
                observer.observe(canvas);
            } else {
                run();
            }
        };
        img.src = uri;

        return () => {
            dead = true;
            cancelAnimationFrame(raf);
            observer?.disconnect();
            canvas.remove();
        };
    }, [uri, ink, cell, animate, sweepSeconds, aspectRatio, alt]);

    return (
        <View
            ref={hostRef}
            accessibilityRole="image"
            accessibilityLabel={alt}
            style={[
                {
                    width: "100%",
                    aspectRatio: aspectRatio ?? 3 / 2,
                    borderRadius: 4,
                    overflow: "hidden",
                    backgroundColor: "#F7F6F2",
                },
                style,
            ]}
        />
    );
}
