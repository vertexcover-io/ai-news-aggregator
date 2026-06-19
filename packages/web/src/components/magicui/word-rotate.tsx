import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";

interface WordRotateProps {
  words: string[];
  duration?: number;
  motionProps?: HTMLMotionProps<"span">;
  className?: string;
}

export function WordRotate({
  words,
  duration = 2600,
  motionProps = {
    initial: { opacity: 0, y: -18 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 18 },
    transition: { duration: 0.28, ease: "easeOut" },
  },
  className,
}: WordRotateProps): ReactElement {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % words.length);
    }, duration);
    return () => {
      clearInterval(interval);
    };
  }, [words, duration]);

  return (
    <span className="relative inline-flex overflow-hidden pb-1 align-bottom">
      <AnimatePresence mode="wait">
        <motion.span
          key={words[index]}
          className={cn("inline-block", className)}
          {...motionProps}
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
