import type { Metadata, Viewport } from "next"
import { IBM_Plex_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google"
import type { ReactNode } from "react"

import "./globals.css"
import { AppNav } from "@/components/app-nav"
import { cn } from "@/lib/utils"
import { getAppTenant } from "@/src/web/tenant"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
})
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
})

export const metadata: Metadata = {
  title: { default: "Intros", template: "%s · Intros" },
  description: "Who should your clients introduce you to?",
}
export const viewport: Viewport = { colorScheme: "light" }
export const dynamic = "force-dynamic"

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  const tenant = await getAppTenant()
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        inter.variable,
        jakarta.variable,
        plexMono.variable
      )}
    >
      <body className="min-h-svh bg-background font-sans text-foreground">
        <div className="flex h-svh max-h-svh flex-col overflow-hidden">
          <AppNav tenantName={tenant.name} />
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
