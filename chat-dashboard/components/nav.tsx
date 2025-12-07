"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpotlight } from "@/components/spotlight-modal";

export function Nav() {
  const pathname = usePathname();
  const { openSpotlight, isOpen } = useSpotlight();

  return (
    <nav className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 p-1">
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
            pathname === "/"
              ? "bg-white text-black"
              : "text-white/70 hover:text-white hover:bg-white/10"
          )}
        >
          <Sparkles className="h-4 w-4" />
          Agent
        </Link>
        <button
          onClick={() => openSpotlight()}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
            isOpen
              ? "bg-white text-black"
              : "text-white/70 hover:text-white hover:bg-white/10"
          )}
        >
          <Search className="h-4 w-4" />
          Spotlight
          <kbd className={cn(
            "ml-1 hidden sm:inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium",
            isOpen
              ? "bg-black/10 text-black/60"
              : "bg-white/10 text-white/50"
          )}>
            ⌘K
          </kbd>
        </button>
      </div>
    </nav>
  );
}

