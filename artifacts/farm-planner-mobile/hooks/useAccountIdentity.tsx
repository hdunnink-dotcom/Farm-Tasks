import { createContext, useContext, type ReactNode } from 'react';

const AccountIdentityContext = createContext<string | null>(null);

export function AccountIdentityProvider({ value, children }: { value: string | null; children: ReactNode }) {
  return <AccountIdentityContext.Provider value={value}>{children}</AccountIdentityContext.Provider>;
}

export function useAccountIdentity() {
  return useContext(AccountIdentityContext);
}