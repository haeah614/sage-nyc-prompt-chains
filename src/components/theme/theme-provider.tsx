"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      enableSystem
      storageKey="prompt-chains-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}
