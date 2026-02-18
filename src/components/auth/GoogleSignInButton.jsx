import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authClient } from '@/api/authClient';

const GOOGLE_GSI_SCRIPT_ID = 'pm-google-gsi-script';
const GOOGLE_GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGoogleScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Identity Services is only available in the browser'));
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google);
  }

  const existingScript = document.getElementById(GOOGLE_GSI_SCRIPT_ID);

  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve(window.google));
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = GOOGLE_GSI_SCRIPT_ID;
    script.src = GOOGLE_GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

export default function GoogleSignInButton({
  returnTo,
  text = 'signin_with',
  theme = 'outline',
  size = 'large',
  width = 260,
  onSuccess,
  onError,
}) {
  const buttonContainerRef = useRef(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const googleClientId = useMemo(
    () => import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const setupGoogleButton = async () => {
      if (!googleClientId) {
        setErrorMessage('Google login is not configured.');
        setIsInitializing(false);
        return;
      }

      try {
        setErrorMessage('');
        setIsInitializing(true);
        await loadGoogleScript();

        if (cancelled || !buttonContainerRef.current || !window.google?.accounts?.id) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async ({ credential }) => {
            if (!credential) {
              const credentialError = new Error('Google did not return an ID token');
              setErrorMessage(credentialError.message);
              onError?.(credentialError);
              return;
            }

            try {
              setIsSubmitting(true);
              setErrorMessage('');
              const result = await authClient.verifyGoogleIdToken(credential, returnTo);
              onSuccess?.(result);
            } catch (error) {
              const message = error?.message || 'Google sign-in failed';
              setErrorMessage(message);
              onError?.(error);
            } finally {
              setIsSubmitting(false);
            }
          },
          ux_mode: 'popup',
          auto_select: false,
          itp_support: true,
        });

        buttonContainerRef.current.innerHTML = '';

        window.google.accounts.id.renderButton(buttonContainerRef.current, {
          type: 'standard',
          shape: 'rectangular',
          text,
          theme,
          size,
          width,
        });
      } catch (error) {
        const message = error?.message || 'Unable to load Google sign-in';
        setErrorMessage(message);
        onError?.(error);
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    setupGoogleButton();

    return () => {
      cancelled = true;
    };
  }, [googleClientId, onError, onSuccess, returnTo, size, text, theme, width]);

  return (
    <div className="space-y-2">
      <div className="relative min-h-10">
        <div ref={buttonContainerRef} className={isSubmitting ? 'pointer-events-none opacity-70' : ''} />
        {(isInitializing || isSubmitting) && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-md">
            <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
          </div>
        )}
      </div>
      {errorMessage && <p className="text-xs text-red-600">{errorMessage}</p>}
    </div>
  );
}
