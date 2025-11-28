"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function Nav() {
  const pathname = usePathname();

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
        <Link
          href="/search"
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
            pathname === "/search"
              ? "bg-white text-black"
              : "text-white/70 hover:text-white hover:bg-white/10"
          )}
        >
          <Search className="h-4 w-4" />
          Spotlight
        </Link>
      </div>
    </nav>
  );
}

