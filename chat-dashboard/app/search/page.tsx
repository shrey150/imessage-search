"use client";

import { useEffect } from "react";
import { useSpotlight } from "@/components/spotlight-modal";
import { Search } from "lucide-react";

/**
 * Search page - now just a shell that auto-opens the spotlight modal
 * Kept for backwards compatibility and testing
 */
export default function SearchPage() {
  const { openSpotlight, isOpen } = useSpotlight();

  // Auto-open spotlight when this page loads
  useEffect(() => {
    if (!isOpen) {
      openSpotlight();
    }
  }, [openSpotlight, isOpen]);

  return (
    <div className="min-h-screen bg-[#1a1a1e] text-white flex flex-col items-center justify-center">
      {/* Fallback content shown briefly before modal opens or if modal is closed */}
      {!isOpen && (
        <div className="text-center">
          <div className="mb-6">
            <Search className="h-16 w-16 text-gray-600 mx-auto" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-400 mb-2">Spotlight Search</h1>
          <p className="text-gray-500 mb-6">Search across all your messages</p>
          <button
            onClick={() => openSpotlight()}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors"
          >
            Open Spotlight
          </button>
          <p className="mt-4 text-sm text-gray-600">
            or press <kbd className="px-2 py-1 bg-gray-800 rounded text-gray-400">⌘K</kbd>
          </p>
        </div>
      )}
    </div>
  );
}
