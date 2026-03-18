"use client";

import {
  createContext,
  useContext,
  type ReactNode
} from "react";

interface NavigationGuardContextValue {
  requestNavigation(href: string): boolean;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue>({
  requestNavigation() {
    return true;
  }
});

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  return (
    <NavigationGuardContext.Provider
      value={{
        requestNavigation() {
          return true;
        }
      }}
    >
      {children}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard() {
  return useContext(NavigationGuardContext);
}
