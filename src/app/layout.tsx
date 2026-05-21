import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Ksenda",
    template: "%s — Ksenda",
  },
  description:
    "Ksenda. Multi-tenant cold outreach instrument across email + LinkedIn: bring your own keys, draft with Gemini, review every line, send email through your own SMTP or paste LinkedIn DMs manually.",
  applicationName: "Ksenda",
  authors: [{ name: "Ksenda" }],
  creator: "Ksenda",
  publisher: "Ksenda",
  robots: { index: true, follow: true },
  // `icons` is intentionally omitted — Next.js auto-detects
  // src/app/icon.png, src/app/apple-icon.png, src/app/favicon.ico,
  // src/app/opengraph-image.png, and src/app/twitter-image.png and emits
  // the correct <link> + <meta> tags. Manifest still listed explicitly.
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Ksenda",
    title: "Ksenda",
    description:
      "Cold outreach across email + LinkedIn. Bring your own keys, review every draft, send email via SMTP or paste LinkedIn DMs manually.",
    url: "https://app.ksenda.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ksenda",
    description:
      "Cold outreach across email + LinkedIn. Bring your own keys, review every draft, send email via SMTP or paste LinkedIn DMs manually.",
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://app.ksenda.com"),
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body className="min-h-dvh font-sans antialiased">
        <ImpersonationBanner />
        <Providers>{children}</Providers>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-M4HFLJLZVZ"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-M4HFLJLZVZ');
          `}
        </Script>
      </body>
    </html>
  );
}
