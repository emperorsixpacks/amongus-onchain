"use client";

import { motion } from "framer-motion";

interface TaskBarProps {
  completed: number;
  total: number;
}

export function TaskBar({ completed, total }: TaskBarProps) {
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="fixed top-4 left-4 z-50">
      <div className="flex flex-col gap-1">
        {/* Task bar container */}
        <div
          className="relative w-48 sm:w-64 md:w-80 h-5 sm:h-6 rounded"
          style={{
            backgroundColor: "#1a1a2e",
            border: "2px solid #333",
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5)",
          }}
        >
          {/* Progress fill */}
          <motion.div
            className="absolute left-0 top-0 bottom-0 rounded-l"
            style={{
              background: "linear-gradient(180deg, #4ade80 0%, #22c55e 50%, #16a34a 100%)",
              boxShadow: "inset 0 2px 4px rgba(255,255,255,0.2)",
            }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />

          {/* Segments */}
          <div className="absolute inset-0 flex">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 border-r border-black/30 last:border-r-0"
              />
            ))}
          </div>
        </div>

        {/* Label */}
        <span
          className="text-white text-xs sm:text-sm font-bold tracking-wider"
          style={{
            textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
            fontFamily: "'Comic Sans MS', cursive",
          }}
        >
          TASKS COMPLETED
        </span>
      </div>
    </div>
  );
}
