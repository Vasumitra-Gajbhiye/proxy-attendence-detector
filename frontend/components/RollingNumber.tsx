"use client";

/**
 * Odometer-style integer: each digit is a vertical 0–9 strip translated with a CSS transition,
 * so count changes roll smoothly instead of flickering.
 */
export function RollingNumber({ value, className = "" }: { value: number; className?: string }) {
  const digits = String(Math.max(0, Math.round(value))).split("");
  return (
    <span className={`inline-flex tabular-nums leading-none ${className}`} aria-live="polite" aria-label={String(value)}>
      {digits.map((d, i) => (
        // key by position from the right so units stay the units column when the width changes
        <Digit key={digits.length - i} digit={Number(d)} />
      ))}
    </span>
  );
}

function Digit({ digit }: { digit: number }) {
  return (
    <span className="relative inline-block h-[1em] w-[0.62em] overflow-hidden" aria-hidden>
      <span
        className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-500 motion-reduce:transition-none ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `translateY(-${digit}em)` }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n} className="flex h-[1em] items-center justify-center">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
