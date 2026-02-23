import React, { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { verificationClient } from '@/api/verificationClient';

function asCode(value) {
  if (typeof value !== 'string') {
    return 'verification_failed';
  }

  const normalized = value.trim().toLowerCase();
  return normalized || 'verification_failed';
}

export default function Verify() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasAttempted = useRef(false);

  const token = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('token') || '').trim();
  }, [location.search]);

  const confirmMutation = useMutation({
    mutationFn: (verificationToken) => verificationClient.confirm(verificationToken),
    onSuccess: () => {
      navigate('/verification?verified=success', { replace: true });
    },
    onError: (error) => {
      const code = asCode(error?.code);
      navigate(`/verification?verified=error&code=${encodeURIComponent(code)}`, { replace: true });
    },
  });

  useEffect(() => {
    if (hasAttempted.current) {
      return;
    }

    hasAttempted.current = true;

    if (!token) {
      navigate('/verification?verified=error&code=token_missing', { replace: true });
      return;
    }

    confirmMutation.mutate(token);
  }, [confirmMutation, navigate, token]);

  return (
    <div className="min-h-screen bg-slate-50 py-16 flex items-center justify-center">
      <div className="max-w-md w-full px-4 text-center text-slate-700">
        <LoaderCircle className="w-6 h-6 animate-spin mx-auto mb-3" />
        <p className="text-sm">Verifying your email link...</p>
      </div>
    </div>
  );
}
