"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { listChats } from "@/lib/chat-history";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Check if there are existing chats
    const chats = listChats();
    if (chats.length > 0) {
      // Go to most recent chat
      router.replace(`/chat/${chats[0].id}`);
    } else {
      // Create a new chat
      router.replace("/chat/new");
    }
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
