import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PublicClientApplication } from '@azure/msal-browser';
import { api, setTokenProvider, type Me } from './api';

interface AuthState {
  me: Me | null;
  ready: boolean;
  error: string | null;
  signIn: (devIdentity?: string, devRoles?: string) => Promise<void>;
  signOut: () => void;
}
const Ctx = createContext<AuthState | null>(null);
export const useAuth = (): AuthState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
};

const MODE = import.meta.env.VITE_AUTH_MODE ?? 'entra';
// Dev sign-in only exists in builds made with VITE_AUTH_MODE=dev; production builds use Entra.
const msal =
  MODE === 'entra' && import.meta.env.VITE_ENTRA_CLIENT_ID
    ? new PublicClientApplication({
        auth: {
          clientId: import.meta.env.VITE_ENTRA_CLIENT_ID,
          authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID}`,
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: 'sessionStorage' },
      })
    : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (e) {
      setMe(null);
      setError((e as Error).message);
      setTokenProvider(null);
    }
  };

  useEffect(() => {
    (async () => {
      if (MODE === 'dev') {
        const saved = sessionStorage.getItem('aegis-dev-token');
        if (saved) {
          setTokenProvider(async () => saved);
          await load();
        }
      } else if (msal) {
        await msal.initialize();
        const redirected = await msal.handleRedirectPromise();
        if (redirected?.account) msal.setActiveAccount(redirected.account);
        const acct = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
        if (acct) {
          msal.setActiveAccount(acct);
          setTokenProvider(entraToken);
          await load();
        }
      }
      setReady(true);
    })().catch((e) => {
      setError((e as Error).message);
      setReady(true);
    });
  }, []);

  const entraToken = async (): Promise<string> => {
    const scopes = [import.meta.env.VITE_ENTRA_API_SCOPE ?? ''];
    const r = await msal!
      .acquireTokenSilent({ scopes, account: msal!.getActiveAccount() ?? undefined })
      .catch(async () => {
        await msal!.acquireTokenRedirect({ scopes });
        throw new Error('Redirecting to sign in');
      });
    return `Bearer ${r.accessToken}`;
  };

  const value = useMemo<AuthState>(
    () => ({
      me,
      ready,
      error,
      signIn: async (identity, roles) => {
        if (MODE === 'dev') {
          const t = `Bearer dev:${identity}:${roles ?? 'viewer'}`;
          sessionStorage.setItem('aegis-dev-token', t);
          setTokenProvider(async () => t);
        } else if (msal) {
          await msal.initialize();
          await msal.loginRedirect({ scopes: [import.meta.env.VITE_ENTRA_API_SCOPE ?? ''] });
          return;
        }
        await load();
      },
      signOut: () => {
        sessionStorage.removeItem('aegis-dev-token');
        setTokenProvider(null);
        setMe(null);
        if (msal) void msal.logoutRedirect();
      },
    }),
    [me, ready, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const AUTH_MODE = MODE;
