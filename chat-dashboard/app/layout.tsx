import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatSidebar } from "@/components/chat-sidebar";
import { SpotlightProvider } from "@/components/spotlight-modal";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "iMessage Search",
  description: "AI-powered search for your iMessage history",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>
          <SpotlightProvider>
            <ChatSidebar>
              {children}
            </ChatSidebar>
          </SpotlightProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
