"use client";
import React from "react";
import { motion } from "motion/react";

export function ColourfulText({ text }: { text: string }) {
const colors = [
  "rgb(167, 139, 250)", // violet-400
  "rgb(139, 92, 246)",  // violet-500
  "rgb(34, 211, 238)",  // cyan-400
  "rgb(6, 182, 212)",   // cyan-500
  "rgb(16, 185, 129)",  // emerald-500
  "rgb(52, 211, 153)",  // emerald-400
  "rgb(251, 191, 36)",  // amber-400 (small accent)
];

  const [currentColors, setCurrentColors] = React.useState(colors);
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      const shuffled = [...colors].sort(() => Math.random() - 0.5);
      setCurrentColors(shuffled);
      setCount((prev) => prev + 1);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return text.split("").map((char, index) => (
    <motion.span
      key={`${char}-${count}-${index}`}
      initial={{
        y: 0,
      }}
      animate={{
        color: currentColors[index % currentColors.length],
        y: [0, -2, 0],
        scale: [1, 1.02, 1],
        textShadow: [
          "0 0 0px rgba(0,0,0,0)",
          "0 0 12px rgba(34,211,238,0.35)",
          "0 0 0px rgba(0,0,0,0)",
        ],
        opacity: [1, 0.85, 1],
      }}
      transition={{
        duration: 0.6,
        delay: index * 0.04,
        }}
      className="inline-block whitespace-pre font-sans tracking-tight"
    >
      {char}
    </motion.span>
  ));
}
