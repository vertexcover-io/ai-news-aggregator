import { useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  type UseInViewOptions,
  type Variants,
} from "motion/react";

type MarginType = UseInViewOptions["margin"];

interface BlurFadeProps {
  children: ReactNode;
  className?: string;
  variant?: Variants;
  duration?: number;
  delay?: number;
  offset?: number;
  direction?: "up" | "down" | "left" | "right";
  inView?: boolean;
  inViewMargin?: MarginType;
  blur?: string;
}

export function BlurFade({
  children,
  className,
  variant,
  duration = 0.4,
  delay = 0,
  offset = 8,
  direction = "down",
  inView = true,
  inViewMargin = "-60px",
  blur = "6px",
}: BlurFadeProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin });
  const isInView = !inView || inViewResult;
  const axis = direction === "left" || direction === "right" ? "x" : "y";
  const sign = direction === "right" || direction === "down" ? -offset : offset;
  const defaultVariants: Variants = {
    hidden: { [axis]: sign, opacity: 0, filter: `blur(${blur})` },
    visible: { [axis]: 0, opacity: 1, filter: "blur(0px)" },
  };
  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        exit="hidden"
        variants={variant ?? defaultVariants}
        transition={{ delay: 0.04 + delay, duration, ease: "easeOut" }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
