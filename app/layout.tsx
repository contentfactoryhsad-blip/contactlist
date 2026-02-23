import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import NavBar from "@/components/NavBar";

const display = localFont({
  src: [
    { path: "../public/fonts/LGEIHeadlineTTF-Semibold.ttf", weight: "600" },
    { path: "../public/fonts/LGEIHeadlineTTF-Bold.ttf", weight: "700" }
  ],
  variable: "--font-display"
});

const body = localFont({
  src: [
    { path: "../public/fonts/LGEITextTTF-Regular.ttf", weight: "400" },
    { path: "../public/fonts/LGEITextTTF-SemiBold.ttf", weight: "600" }
  ],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "LGE Creative Hub",
  description: "Request and manage Airtable access across regions and branches."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <div className="app-shell">
          <NavBar />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
