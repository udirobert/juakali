/**
 * FLIP (First, Last, Invert, Play) for the deal strip → deal detail move —
 * the Grid Layout Transitions technique, without the library: the pressed
 * chip's rect is recorded before navigation/selection, then a paper "ghost"
 * morphs to the destination while the real content fades in underneath.
 * Web-only by construction; every entry point no-ops on native.
 */

export type FlipRect = { left: number; top: number; width: number; height: number };

const sources = new Map<string, FlipRect>();

export function recordFlipSource(key: string, rect: FlipRect) {
    sources.set(key, rect);
}

export function consumeFlipSource(key: string): FlipRect | null {
    const rect = sources.get(key) ?? null;
    sources.delete(key);
    return rect;
}

/**
 * Morph a ghost card from `from` to the target element's rect over `duration`.
 * The ghost lands on the target's leading surface (height capped — the deal
 * stack is far taller than a chip), then hands off to the real content.
 */
export function flipMorph(target: HTMLElement, from: FlipRect, duration = 380) {
    const to = target.getBoundingClientRect();
    const land = {
        left: to.left,
        top: to.top,
        width: to.width,
        height: Math.min(to.height, 220),
    };
    const dx = from.left - land.left;
    const dy = from.top - land.top;
    const sx = from.width / Math.max(land.width, 1);
    const sy = from.height / Math.max(land.height, 1);
    // Identity-ish flip isn't worth the paint.
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4 && Math.abs(1 - sx) < 0.08 && Math.abs(1 - sy) < 0.08) {
        return;
    }

    const ghost = document.createElement("div");
    Object.assign(ghost.style, {
        position: "fixed",
        left: `${land.left}px`,
        top: `${land.top}px`,
        width: `${land.width}px`,
        height: `${land.height}px`,
        background: "#F7F6F2",
        border: "1px solid rgba(20, 24, 22, 0.1)",
        borderRadius: "10px",
        transformOrigin: "0 0",
        zIndex: "9999",
        pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(ghost);

    const flight = ghost.animate(
        [
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 1 },
            { transform: "none", opacity: 0.35 },
        ],
        { duration, easing: "cubic-bezier(0.22, 0.8, 0.24, 1)", fill: "forwards" },
    );
    const arrive = target.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: Math.round(duration * 0.55),
        delay: Math.round(duration * 0.35),
        easing: "ease-out",
        fill: "backwards",
    });

    void Promise.allSettled([flight.finished, arrive.finished]).then(() => {
        ghost.remove();
    });
}
