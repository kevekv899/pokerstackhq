"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Authored size of the table scene. Seat coordinates are in this space. */
export const SCENE_W = 800;
export const SCENE_H = 440;

/** The felt oval inside the scene, used to honour max-oval-size caps. */
export const FELT_W = 660;
export const FELT_H = 330;

interface FitOptions {
  /** Largest the felt oval may be painted, in CSS px. */
  maxOvalW: number;
  maxOvalH: number;
  /** Hard ceiling on the scale. Also stops the scene ever being upscaled. */
  maxScale: number;
  /** Breathing room kept between the scene and its container. */
  padX?: number;
  padY?: number;
}

/**
 * Measures the container and returns the scale at which the 800×440 scene
 * fits inside it on both axes.
 *
 * This is deliberately JavaScript rather than a CSS `min()` expression. The
 * CSS form has to compare a bare number with a computed length, which is a
 * type error — the browser silently drops the whole declaration and the table
 * renders unscaled. Measuring the box avoids that class of failure entirely and
 * adapts to the action bar, whose height is not fixed (it changes with the hero
 * card size, and shrinks at showdown when the bet row becomes a status line).
 */
export function useFitScale({ maxOvalW, maxOvalH, maxScale, padX = 16, padY = 12 }: FitOptions) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cap = Math.min(maxScale, maxOvalW / FELT_W, maxOvalH / FELT_H);
  // Start at the cap so the first paint is never larger than the target.
  const [scale, setScale] = useState(cap);

  const measure = useCallback((el: HTMLElement) => {
    const { width, height } = el.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const next = Math.min(
      cap,
      (width - padX) / SCENE_W,
      (height - padY) / SCENE_H,
    );
    // Floor keeps a degenerate container from producing a zero/negative scale,
    // which would collapse or mirror the table instead of just shrinking it.
    setScale(prev => {
      const clamped = Math.max(0.1, Math.round(next * 1000) / 1000);
      return prev === clamped ? prev : clamped;
    });
  }, [cap, padX, padY]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure(el);
    const ro = new ResizeObserver(() => measure(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return { ref, scale };
}

/**
 * One fit config for every viewport. There is no phone variant on purpose: the
 * table is a single 800×440 scene that shrinks as a whole, so the only thing
 * that changes between a desktop and an iPhone is the number this hook returns.
 *
 * `maxScale` is what binds on desktop — 700×500 is *larger* than the authored
 * 660×330 oval, so without it a roomy window would scale the table UP rather
 * than down; 0.8 paints the oval at 528×264. On a phone neither cap is reached
 * and the container's own width binds instead: (390 − 8) / 800 ≈ 0.48.
 */
export const OVAL_FIT = { maxOvalW: 700, maxOvalH: 500, maxScale: 0.8, padX: 8, padY: 6 };
