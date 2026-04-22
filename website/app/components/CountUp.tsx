"use client";

import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  value: string;
  duration?: number;
  className?: string;
}

export default function CountUp({ value, duration = 1600, className = "" }: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(value);
  const [animated, setAnimated] = useState(false);

  const match = value.match(/^(\$?)(\d+(?:\.\d+)?)(.*)$/);
  const prefix = match ? match[1] : "";
  const target = match ? parseFloat(match[2]) : NaN;
  const suffix = match ? match[3] : "";

  useEffect(() => {
    if (!ref.current || isNaN(target) || animated) {
      return;
    }
    const node = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !animated) {
          setAnimated(true);
          const start = performance.now();
          const tick = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = target * eased;
            const rounded = target < 10 ? current.toFixed(0) : Math.round(current).toString();
            setDisplay(`${prefix}${rounded}${suffix}`);
            if (progress < 1) {
              requestAnimationFrame(tick);
            } else {
              setDisplay(value);
            }
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [target, duration, prefix, suffix, value, animated]);

  if (isNaN(target)) {
    return <span className={className}>{value}</span>;
  }

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
