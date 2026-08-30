"use client";

import * as React from "react";

/** The display currency resolved on the server in `(app)/layout.tsx`. A context
 *  rather than a prop because every page header needs it and only the layout
 *  fetches it — prop-drilling it through nine pages would be the same value
 *  written nine times. */
const DisplayCurrencyContext = React.createContext<string | null>(null);

export function DisplayCurrencyProvider({
  value,
  children,
}: {
  value: string | null;
  children: React.ReactNode;
}) {
  return (
    <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>
  );
}

export function useDisplayCurrency(): string | null {
  return React.useContext(DisplayCurrencyContext);
}
