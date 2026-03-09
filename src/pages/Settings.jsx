import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { accountClient } from '@/api/accountClient';
import { authClient } from '@/api/authClient';
import { securityClient } from '@/api/securityClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Bell,
  Mail,
  Shield,
  Trash2,
  AlertTriangle,
  LogOut,
  CheckCircle2,
  CreditCard,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDateTime(value) {
  if (!value) {
    return 'Unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString();
}

function summarizeUserAgent(userAgent) {
  const ua = asText(userAgent).toLowerCase();
  if (!ua) {
    return 'Unknown device';
  }

  let browser = 'Browser';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome/')) browser = 'Chrome';
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
  else if (ua.includes('firefox/')) browser = 'Firefox';

  let os = 'Unknown OS';
  if (ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('linux')) os = 'Linux';

  return `${browser} on ${os}`;
}

function mapSecurityEventLabel(eventType) {
  const normalized = asText(eventType);
  const labels = {
    'auth.login.success': 'Signed in',
    'auth.logout': 'Signed out',
    'auth.session.revoked': 'Signed out a device',
    'auth.sessions.revoked_all': 'Signed out other devices',
    'auth.mfa.enabled': '2FA enabled',
    'auth.mfa.disabled': '2FA disabled',
    'auth.mfa.challenge.success': '2FA challenge passed',
    'auth.mfa.challenge.fail': '2FA challenge failed',
    'auth.mfa.backup.regenerated': '2FA backup codes regenerated',
    'share.link.created': 'Shared link created',
    'share.link.accessed': 'Shared link accessed',
    'share.reveal.requested': 'Reveal requested',
    'share.reveal.approved': 'Reveal approved',
    'share.reveal.denied': 'Reveal denied',
  };

  return labels[normalized] || normalized || 'Security event';
}

export default function Settings() {
  const { user, isLoadingAuth, navigateToLogin, logout } = useAuth();
  const [emailConfig, setEmailConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(false);

  const [mfaEnrollmentSecret, setMfaEnrollmentSecret] = useState('');
  const [mfaEnrollmentUri, setMfaEnrollmentUri] = useState('');
  const [mfaEnrollmentCode, setMfaEnrollmentCode] = useState('');
  const [mfaQrDataUrl, setMfaQrDataUrl] = useState('');
  const [disableMfaCode, setDisableMfaCode] = useState('');
  const [regenerateBackupCode, setRegenerateBackupCode] = useState('');
  const [visibleBackupCodes, setVisibleBackupCodes] = useState([]);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isLoadingAuth && !user) {
      navigateToLogin('/settings');
    }
  }, [isLoadingAuth, navigateToLogin, user]);

  useEffect(() => {
    let mounted = true;

    if (!mfaEnrollmentUri) {
      setMfaQrDataUrl('');
      return () => {
        mounted = false;
      };
    }

    QRCode.toDataURL(mfaEnrollmentUri, {
      width: 180,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl) => {
        if (mounted) {
          setMfaQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (mounted) {
          setMfaQrDataUrl('');
        }
      });

    return () => {
      mounted = false;
    };
  }, [mfaEnrollmentUri]);

  const loadEmailConfig = async () => {
    setLoadingConfig(true);
    try {
      const config = await accountClient.getEmailConfigStatus();
      setEmailConfig(config);
    } catch (error) {
      console.error('Failed to load email config:', error);
      setEmailConfig({ error: error.message });
    }
    setLoadingConfig(false);
  };

  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => accountClient.getProfile(),
    enabled: !!user?.email,
  });

  const { data: sessions = [], isLoading: sessionsLoading, isError: sessionsError } = useQuery({
    queryKey: ['securitySessions'],
    queryFn: () => securityClient.getSessions(),
    enabled: !!user?.id,
  });

  const { data: securityActivity = [], isError: securityActivityError } = useQuery({
    queryKey: ['securityActivity'],
    queryFn: () => securityClient.getActivity(50),
    enabled: !!user?.id,
  });

  const { data: mfaStatus } = useQuery({
    queryKey: ['securityMfaStatus'],
    queryFn: () => securityClient.getMfaStatus(),
    enabled: !!user?.id,
  });

  const [notifications, setNotifications] = useState({
    email_notifications: true,
    email_proposals: true,
    email_evaluations: true,
    email_reveals: true,
    email_marketing: false,
  });

  useEffect(() => {
    if (profile?.notification_settings) {
      setNotifications({
        email_notifications: profile.notification_settings.email_notifications ?? true,
        email_proposals: profile.notification_settings.email_proposals ?? true,
        email_evaluations: profile.notification_settings.email_evaluations ?? true,
        email_reveals: profile.notification_settings.email_reveals ?? true,
        email_marketing: profile.notification_settings.email_marketing ?? false,
      });
    }
  }, [profile]);

  const saveNotificationsMutation = useMutation({
    mutationFn: (settings) => accountClient.saveProfile({ notification_settings: settings }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    },
  });

  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId) => securityClient.revokeSession(sessionId),
    onSuccess: async (payload) => {
      await queryClient.invalidateQueries({ queryKey: ['securitySessions'] });
      await queryClient.invalidateQueries({ queryKey: ['securityActivity'] });
      await queryClient.invalidateQueries({ queryKey: ['securityMfaStatus'] });
      if (payload?.signed_out) {
        try {
          await logout(true);
        } catch {
          await authClient.logout('/');
        }
      }
    },
    onError: (error) => {
      alert(error?.message || 'Unable to revoke session');
    },
  });

  const revokeOtherDevicesMutation = useMutation({
    mutationFn: () => securityClient.revokeAllSessions({ includeCurrent: false }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['securitySessions'] });
      await queryClient.invalidateQueries({ queryKey: ['securityActivity'] });
    },
    onError: (error) => {
      alert(error?.message || 'Unable to sign out other devices');
    },
  });

  const startMfaEnrollmentMutation = useMutation({
    mutationFn: () => securityClient.startMfaEnrollment(),
    onSuccess: (enrollment) => {
      setMfaEnrollmentSecret(asText(enrollment?.secret));
      setMfaEnrollmentUri(asText(enrollment?.otpauth_uri || enrollment?.otpauthUri));
      setMfaEnrollmentCode('');
      setVisibleBackupCodes([]);
    },
    onError: (error) => {
      alert(error?.message || 'Unable to start 2FA enrollment');
    },
  });

  const confirmMfaEnrollmentMutation = useMutation({
    mutationFn: (code) => securityClient.confirmMfaEnrollment(code),
    onSuccess: async (payload) => {
      setVisibleBackupCodes(payload?.backup_codes || payload?.backupCodes || []);
      setMfaEnrollmentSecret('');
      setMfaEnrollmentUri('');
      setMfaEnrollmentCode('');
      await queryClient.invalidateQueries({ queryKey: ['securityMfaStatus'] });
      await queryClient.invalidateQueries({ queryKey: ['securityActivity'] });
    },
    onError: (error) => {
      alert(error?.message || 'Unable to enable 2FA');
    },
  });

  const disableMfaMutation = useMutation({
    mutationFn: (codeOrBackup) => securityClient.disableMfa(codeOrBackup),
    onSuccess: async () => {
      setDisableMfaCode('');
      setVisibleBackupCodes([]);
      setMfaEnrollmentSecret('');
      setMfaEnrollmentUri('');
      await queryClient.invalidateQueries({ queryKey: ['securityMfaStatus'] });
      await queryClient.invalidateQueries({ queryKey: ['securityActivity'] });
    },
    onError: (error) => {
      alert(error?.message || 'Unable to disable 2FA');
    },
  });

  const regenerateBackupCodesMutation = useMutation({
    mutationFn: (code) => securityClient.regenerateBackupCodes(code),
    onSuccess: async (payload) => {
      setVisibleBackupCodes(payload?.backup_codes || payload?.backupCodes || []);
      setRegenerateBackupCode('');
      await queryClient.invalidateQueries({ queryKey: ['securityActivity'] });
    },
    onError: (error) => {
      alert(error?.message || 'Unable to regenerate backup codes');
    },
  });

  const handleNotificationChange = (key, value) => {
    const newSettings = { ...notifications, [key]: value };
    setNotifications(newSettings);
    saveNotificationsMutation.mutate(newSettings);
  };

  const handleSignOutEverywhere = async () => {
    if (!confirm('Are you sure you want to sign out of all devices?')) {
      return;
    }

    try {
      await securityClient.revokeAllSessions({ includeCurrent: true });
    } catch {
      // fallback to local sign out below
    }

    try {
      await logout(true);
    } catch {
      await authClient.logout('/');
    }
  };

  const handleDeleteAccount = async () => {
    if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
      if (confirm('Final confirmation: Type DELETE to proceed.')) {
        alert('Account deletion is currently unavailable. Please contact support@premarket.com');
      }
    }
  };

  const isVerified = Boolean(profile?.email_verified || profile?.verification_status === 'verified');
  const mfaEnabled = Boolean(mfaStatus?.enabled);

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-slate-200 rounded w-48" />
            <div className="h-64 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-slate-500 mt-1">Manage your account preferences and security.</p>
        </div>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-slate-400" />
                Account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input value={user?.email || ''} disabled className="bg-slate-50" />
                <p className="text-xs text-slate-500">Contact support to change your email.</p>
              </div>
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input value={user?.full_name || ''} disabled className="bg-slate-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-slate-400" />
                Billing & Subscription
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Manage your subscription</p>
                  <p className="text-sm text-slate-500">View your plan and billing details.</p>
                </div>
                <Link to={createPageUrl('Billing')}>
                  <Button variant="outline">View Billing</Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {user?.role === 'admin' && (
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-slate-400" />
                  Email Configuration
                </CardTitle>
                <CardDescription>Check email provider settings (Admin only)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Email Provider Status</p>
                    <p className="text-sm text-slate-500">Verify Resend configuration.</p>
                  </div>
                  <Button variant="outline" onClick={loadEmailConfig} disabled={loadingConfig}>
                    {loadingConfig ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      'Check Status'
                    )}
                  </Button>
                </div>

                {emailConfig && (
                  <div className="mt-4 p-4 bg-slate-50 rounded-lg space-y-2 text-sm">
                    {emailConfig.error ? (
                      <p className="text-red-600">Error: {emailConfig.error}</p>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Resend API Key:</span>
                          <span className="font-medium">{emailConfig.hasResendKey ? '✓ Set' : '✗ Missing'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">From Email:</span>
                          <span className="font-medium">{emailConfig.fromEmail || 'Not set'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">From Domain:</span>
                          <span
                            className={`font-medium ${
                              emailConfig.fromDomain === 'mail.getpremarket.com' ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {emailConfig.fromDomain || 'Not set'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Reply To:</span>
                          <span className="font-medium">{emailConfig.replyTo || 'Not set'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Environment:</span>
                          <span className="font-medium">{emailConfig.environment}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Base URL:</span>
                          <span className="font-medium text-xs">{emailConfig.baseUrl}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Valid Config:</span>
                          <span className={`font-medium ${emailConfig.isValidConfig ? 'text-green-600' : 'text-red-600'}`}>
                            {emailConfig.isValidConfig ? '✓ Valid' : '✗ Invalid'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-slate-400" />
                Notifications
              </CardTitle>
              <CardDescription>Choose what you want to be notified about.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Email Notifications</p>
                  <p className="text-sm text-slate-500">Receive email copies for enabled notification types.</p>
                </div>
                <Switch
                  checked={notifications.email_notifications}
                  onCheckedChange={(v) => handleNotificationChange('email_notifications', v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">New Proposals</p>
                  <p className="text-sm text-slate-500">Get notified when you receive a proposal.</p>
                </div>
                <Switch
                  checked={notifications.email_proposals}
                  onCheckedChange={(v) => handleNotificationChange('email_proposals', v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Evaluation Updates</p>
                  <p className="text-sm text-slate-500">Get notified when an evaluation is complete.</p>
                </div>
                <Switch
                  checked={notifications.email_evaluations}
                  onCheckedChange={(v) => handleNotificationChange('email_evaluations', v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Reveal Requests</p>
                  <p className="text-sm text-slate-500">Get notified when someone requests a reveal.</p>
                </div>
                <Switch checked={notifications.email_reveals} onCheckedChange={(v) => handleNotificationChange('email_reveals', v)} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Marketing Emails</p>
                  <p className="text-sm text-slate-500">Receive product updates and tips.</p>
                </div>
                <Switch checked={notifications.email_marketing} onCheckedChange={(v) => handleNotificationChange('email_marketing', v)} />
              </div>
              {saveNotificationsMutation.isSuccess && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-green-600 text-sm pt-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Settings saved
                </motion.div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-slate-400" />
                Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Change Password</p>
                    <p className="text-sm text-slate-500">Google-authenticated accounts do not use local passwords.</p>
                  </div>
                  <Button variant="outline" disabled className="opacity-50">
                    Not Applicable
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Two-Factor Authentication</p>
                    <p className="text-sm text-slate-500">Status: {mfaEnabled ? 'Enabled' : 'Disabled'}</p>
                  </div>
                  {mfaEnabled ? (
                    <Button
                      variant="outline"
                      onClick={() => disableMfaMutation.mutate(disableMfaCode)}
                      disabled={disableMfaMutation.isPending || !disableMfaCode.trim()}
                    >
                      {disableMfaMutation.isPending ? 'Disabling...' : 'Disable 2FA'}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => startMfaEnrollmentMutation.mutate()}
                      disabled={startMfaEnrollmentMutation.isPending || !isVerified}
                    >
                      {startMfaEnrollmentMutation.isPending ? 'Preparing...' : 'Enable 2FA'}
                    </Button>
                  )}
                </div>

                {!isVerified && !mfaEnabled ? (
                  <p className="text-sm text-amber-700">
                    Verify your account to enable 2FA.{' '}
                    <Link to={createPageUrl('Verification')} className="underline underline-offset-4">
                      Go to verification
                    </Link>
                  </p>
                ) : null}

                {mfaEnabled ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <Label htmlFor="disable-mfa-code">Disable 2FA (enter authenticator code or backup code)</Label>
                    <Input
                      id="disable-mfa-code"
                      value={disableMfaCode}
                      onChange={(event) => setDisableMfaCode(event.target.value)}
                      placeholder="123456 or backup code"
                    />
                  </div>
                ) : null}

                {mfaEnrollmentUri ? (
                  <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                    <p className="text-sm font-medium text-slate-900">Scan this QR code with your authenticator app.</p>
                    {mfaQrDataUrl ? (
                      <img src={mfaQrDataUrl} alt="MFA QR code" className="h-44 w-44 rounded border border-slate-200" />
                    ) : null}
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500">Manual setup key</p>
                      <p className="font-mono text-sm break-all">{mfaEnrollmentSecret}</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mfa-enrollment-code">Enter 6-digit code to confirm</Label>
                      <Input
                        id="mfa-enrollment-code"
                        value={mfaEnrollmentCode}
                        onChange={(event) => setMfaEnrollmentCode(event.target.value)}
                        placeholder="123456"
                        maxLength={6}
                      />
                      <Button
                        onClick={() => confirmMfaEnrollmentMutation.mutate(mfaEnrollmentCode)}
                        disabled={confirmMfaEnrollmentMutation.isPending || mfaEnrollmentCode.trim().length < 6}
                      >
                        {confirmMfaEnrollmentMutation.isPending ? 'Confirming...' : 'Confirm & Enable'}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {mfaEnabled ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <Label htmlFor="regenerate-backup-codes">Regenerate backup codes (TOTP required)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="regenerate-backup-codes"
                        value={regenerateBackupCode}
                        onChange={(event) => setRegenerateBackupCode(event.target.value)}
                        placeholder="123456"
                      />
                      <Button
                        variant="outline"
                        onClick={() => regenerateBackupCodesMutation.mutate(regenerateBackupCode)}
                        disabled={regenerateBackupCodesMutation.isPending || regenerateBackupCode.trim().length < 6}
                      >
                        Regenerate
                      </Button>
                    </div>
                  </div>
                ) : null}

                {visibleBackupCodes.length > 0 ? (
                  <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                    <p className="text-sm font-medium text-amber-900">Backup codes (shown once)</p>
                    <div className="grid grid-cols-2 gap-2">
                      {visibleBackupCodes.map((code) => (
                        <code key={code} className="rounded bg-white px-2 py-1 text-xs text-slate-700">
                          {code}
                        </code>
                      ))}
                    </div>
                    <Button variant="outline" onClick={() => setVisibleBackupCodes([])}>
                      I saved these
                    </Button>
                  </div>
                ) : null}
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Active Sessions</p>
                    <p className="text-sm text-slate-500">Manage your logged-in devices.</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => revokeOtherDevicesMutation.mutate()}
                    disabled={revokeOtherDevicesMutation.isPending}
                  >
                    {revokeOtherDevicesMutation.isPending ? 'Signing out...' : 'Sign out other devices'}
                  </Button>
                </div>

                {sessionsLoading ? (
                  <p className="text-sm text-slate-500">Loading sessions...</p>
                ) : sessionsError ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Could not load sessions — your proposals and data are unaffected. Refresh to retry.
                  </p>
                ) : sessions.length === 0 ? (
                  <p className="text-sm text-slate-500">No active sessions found.</p>
                ) : (
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <div key={session.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {summarizeUserAgent(session.user_agent)}{' '}
                              {session.is_current || session.isCurrent ? (
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">This device</span>
                              ) : null}
                            </p>
                            <p className="text-xs text-slate-500">Created: {formatDateTime(session.created_at)}</p>
                            <p className="text-xs text-slate-500">Last seen: {formatDateTime(session.last_seen_at)}</p>
                          </div>
                          <Button
                            variant="outline"
                            onClick={() => revokeSessionMutation.mutate(session.id)}
                            disabled={revokeSessionMutation.isPending}
                          >
                            Sign out
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <p className="font-medium">Recent security activity</p>
                  <p className="text-sm text-slate-500">Recent sign-ins, session changes, and 2FA events.</p>
                </div>
                <div className="space-y-2">
                  {securityActivityError ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      Could not load security activity. Refresh to retry.
                    </p>
                  ) : securityActivity.length === 0 ? (
                    <p className="text-sm text-slate-500">No security activity available yet.</p>
                  ) : (
                    securityActivity.map((event) => (
                      <div key={event.id} className="rounded-lg border border-slate-200 p-3">
                        <p className="text-sm font-medium text-slate-900">{mapSecurityEventLabel(event.event_type)}</p>
                        <p className="text-xs text-slate-500">{formatDateTime(event.created_at)}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm border-red-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Sign Out Everywhere</p>
                  <p className="text-sm text-slate-500">Log out of all devices, including this one.</p>
                </div>
                <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={handleSignOutEverywhere}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out All
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Delete Account</p>
                  <p className="text-sm text-slate-500">Permanently delete your account and data.</p>
                </div>
                <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={handleDeleteAccount}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
