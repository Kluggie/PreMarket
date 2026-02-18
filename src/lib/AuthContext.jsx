import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authClient } from '@/api/authClient';
import LoginDialog from '@/components/auth/LoginDialog';

const LOGIN_EVENT_NAME = 'pm:auth:open-login';
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings] = useState(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginReturnTo, setLoginReturnTo] = useState('/');

  const refreshAuthState = useCallback(async () => {
    setIsLoadingAuth(true);

    try {
      const currentUser = await authClient.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (error) {
      setUser(null);
      setIsAuthenticated(false);

      if (error?.status && error.status !== 401) {
        setAuthError({
          type: 'unknown',
          message: error.message || 'Unable to load authentication state',
        });
      } else {
        setAuthError(null);
      }
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    authClient.getCsrfToken().catch((error) => {
      setAuthError({
        type: 'unknown',
        message: error?.message || 'Failed to initialize CSRF protection',
      });
    });
    refreshAuthState();
  }, [refreshAuthState]);

  useEffect(() => {
    const handleLoginOpen = (event) => {
      const requestedReturnTo = event?.detail?.returnTo;
      setLoginReturnTo(requestedReturnTo || authClient.consumeReturnTo());
      setIsLoginOpen(true);
    };

    window.addEventListener(LOGIN_EVENT_NAME, handleLoginOpen);

    return () => {
      window.removeEventListener(LOGIN_EVENT_NAME, handleLoginOpen);
    };
  }, []);

  const checkAppState = useCallback(async () => {
    await authClient.getCsrfToken().catch((error) => {
      setAuthError({
        type: 'unknown',
        message: error?.message || 'Failed to initialize CSRF protection',
      });
    });
    await refreshAuthState();
  }, [refreshAuthState]);

  const logout = useCallback(
    async (shouldRedirect = true) => {
      try {
        await authClient.logout();
      } finally {
        setUser(null);
        setIsAuthenticated(false);
      }

      if (shouldRedirect) {
        window.location.assign('/');
      }
    },
    [],
  );

  const navigateToLogin = useCallback((returnTo) => {
    authClient.redirectToLogin(returnTo);
  }, []);

  const handleAuthenticated = useCallback(
    async (result) => {
      const authenticatedUser = result?.user || null;
      const redirectTo = result?.redirectTo || authClient.consumeReturnTo();

      setUser(authenticatedUser);
      setIsAuthenticated(Boolean(authenticatedUser));
      setAuthError(null);
      setIsLoginOpen(false);

      if (redirectTo) {
        window.location.assign(redirectTo);
        return;
      }

      await refreshAuthState();
    },
    [refreshAuthState],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        logout,
        navigateToLogin,
        checkAppState,
      }}
    >
      {children}
      <LoginDialog
        open={isLoginOpen}
        onOpenChange={setIsLoginOpen}
        returnTo={loginReturnTo}
        onAuthenticated={handleAuthenticated}
      />
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};
