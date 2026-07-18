import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RuneSpace — Development Scaffold",
  description: "RuneSpace foundation scaffold. Early development build; not a playable game.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f17",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-full bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
