"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AmongUsSprite } from "./AmongUsSprite";

interface WalkingCharacter {
  id: number;
  colorId: number;
  y: number; // percentage from top
  speed: number; // seconds to cross
  direction: "left" | "right";
  size: number;
  delay: number;
}

function generateCharacters(count: number): WalkingCharacter[] {
  const characters: WalkingCharacter[] = [];

  for (let i = 0; i < count; i++) {
    characters.push({
      id: i,
      colorId: Math.floor(Math.random() * 12),
      y: 15 + Math.random() * 70, // 15% to 85% from top
      speed: 15 + Math.random() * 20, // 15-35 seconds to cross
      direction: Math.random() > 0.5 ? "left" : "right",
      size: 40 + Math.random() * 30, // 40-70px
      delay: Math.random() * 10, // 0-10 second delay
    });
  }

  return characters;
}

interface WalkingCharacterProps {
  character: WalkingCharacter;
}

function WalkingCharacterItem({ character }: WalkingCharacterProps) {
  const startX = character.direction === "right" ? "-100px" : "calc(100vw + 100px)";
  const endX = character.direction === "right" ? "calc(100vw + 100px)" : "-100px";

  return (
    <motion.div
      className="fixed pointer-events-none"
      style={{
        top: `${character.y}%`,
        zIndex: 1,
      }}
      initial={{ x: startX }}
      animate={{ x: endX }}
      transition={{
        duration: character.speed,
        delay: character.delay,
        repeat: Infinity,
        ease: "linear",
      }}
    >
      <AmongUsSprite
        colorId={character.colorId}
        size={character.size}
        direction={character.direction}
        isMoving={true}
        showShadow={false}
      />
    </motion.div>
  );
}

export function WalkingCharacters() {
  const [characters, setCharacters] = useState<WalkingCharacter[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCharacters(generateCharacters(6));
  }, []);

  // Don't render on server
  if (!mounted) return null;

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 1 }}>
      {characters.map((char) => (
        <WalkingCharacterItem key={char.id} character={char} />
      ))}
    </div>
  );
}
