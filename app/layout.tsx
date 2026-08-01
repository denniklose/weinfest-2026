import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weinfest 2026 · An der Mosel",
  description: "Die private Weinabstimmung für das Weinfest an der Mosel."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de"><body>{children}</body></html>;
}
