import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { BRAND } from "@/lib/brand";
import { RegisterServiceWorker } from "@/components/pwa/register";

/**
 * Inter, served from here rather than fetched from Google.
 *
 * next/font/google downloads the file at build time, which makes every
 * build depend on fonts.googleapis.com being reachable from whatever
 * machine is doing the building. That was fine on one host and is a
 * needless way for a deploy to fail on another; a build should not go
 * red because a third party is having a bad morning.
 *
 * Byte-for-byte the same typeface: the latin variable cut Google serves
 * for Inter, taken from @fontsource-variable/inter and committed. The
 * weight axis covers 100-900, so every weight the interface uses is the
 * real one rather than a synthesised oblique.
 */
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
  style: "normal",
});

export const metadata: Metadata = {
  title: {
    default: BRAND.name,
    template: `%s · ${BRAND.name}`,
  },
  description: `${BRAND.name} - wholesale distribution and inventory management`,
  manifest: "/manifest.webmanifest",
  applicationName: BRAND.name,
  appleWebApp: {
    capable: true,
    title: BRAND.name,
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // The driver app is a tool, not a page anyone should find by search.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
  width: "device-width",
  initialScale: 1,
  // The driver PWA is used one-handed; pinch zoom stays available.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
