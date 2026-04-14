import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBeforeUnload, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { accountClient } from '@/api/accountClient';
import { billingClient } from '@/api/billingClient';
import { directoryClient } from '@/api/directoryClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import {
  User,
  Linkedin,
  Github,
  Twitter,
  Link2,
  Save,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { createPageUrl } from '../utils';

const PLAN_LABELS = {
  professional: 'Professional',
  enterprise: 'Enterprise',
  early_access: 'Free trial',
  starter: 'Starter',
};

const MAX_TAGLINE_LENGTH = 80;
const MAX_PSEUDONYM_LENGTH = 80;
const MAX_LOCATION_LENGTH = 120;
const MAX_WEBSITE_LENGTH = 280;
const EMPTY_SOCIAL_LINKS = {
  linkedin: '',
  twitter: '',
  github: '',
  crunchbase: '',
};
const EMPTY_FORM_DATA = {
  pseudonym: '',
  user_type: 'individual',
  title: '',
  tagline: '',
  industry: '',
  location: '',
  bio: '',
  website: '',
  privacy_mode: 'pseudonymous',
  social_links: EMPTY_SOCIAL_LINKS,
  social_links_ai_consent: false,
  is_public_directory: false,
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSocialLinks(links) {
  const source = links && typeof links === 'object' ? links : {};
  return {
    linkedin: normalizeText(source.linkedin),
    twitter: normalizeText(source.twitter),
    github: normalizeText(source.github),
    crunchbase: normalizeText(source.crunchbase),
  };
}

function normalizeWebsiteInput(rawValue) {
  const raw = normalizeText(rawValue);
  if (!raw) {
    return { normalized: '', error: '' };
  }

  if (raw.length > MAX_WEBSITE_LENGTH) {
    return {
      normalized: '',
      error: `Website must be ${MAX_WEBSITE_LENGTH} characters or fewer.`,
    };
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      return {
        normalized: '',
        error: 'Enter a valid website URL.',
      };
    }

    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }

    const normalized = parsed.toString();
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash && normalized.endsWith('/')) {
      return {
        normalized: normalized.slice(0, -1),
        error: '',
      };
    }

    return {
      normalized,
      error: '',
    };
  } catch {
    return {
      normalized: '',
      error: 'Enter a valid website URL.',
    };
  }
}

function mapProfileToForm(profile) {
  if (!profile) {
    return {
      ...EMPTY_FORM_DATA,
      social_links: { ...EMPTY_SOCIAL_LINKS },
    };
  }

  return {
    pseudonym: profile.pseudonym || '',
    user_type: profile.user_type || 'individual',
    title: profile.title || '',
    tagline: profile.tagline || '',
    industry: profile.industry || '',
    location: profile.location || '',
    bio: profile.bio || '',
    website: profile.website || '',
    privacy_mode: profile.privacy_mode || 'pseudonymous',
    social_links: {
      ...EMPTY_SOCIAL_LINKS,
      ...(profile.social_links || {}),
    },
    social_links_ai_consent: Boolean(profile.social_links_ai_consent),
    is_public_directory: Boolean(profile.is_public_directory),
  };
}

function buildProfilePayload(formData) {
  const websiteValidation = normalizeWebsiteInput(formData.website);

  return {
    pseudonym: normalizeText(formData.pseudonym),
    user_type: normalizeText(formData.user_type) || 'individual',
    title: normalizeText(formData.title),
    tagline: normalizeText(formData.tagline),
    industry: normalizeText(formData.industry),
    location: normalizeText(formData.location),
    bio: normalizeText(formData.bio),
    website: websiteValidation.normalized,
    privacy_mode: normalizeText(formData.privacy_mode) || 'pseudonymous',
    social_links: normalizeSocialLinks(formData.social_links),
    social_links_ai_consent: Boolean(formData.social_links_ai_consent),
    is_public_directory: Boolean(formData.is_public_directory),
  };
}

function createIndustryOptions(values) {
  const seen = new Set();
  const options = [];

  values.forEach((value) => {
    const text = normalizeText(value);
    if (!text) return;

    const key = text.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    options.push(text);
  });

  return options.sort((a, b) => a.localeCompare(b));
}

function getAccountProfileName(user) {
  const name = normalizeText(user?.full_name || user?.fullName || user?.name);
  if (name) {
    return name;
  }

  return normalizeText(user?.email) || 'Your name';
}

function getAccountDirectoryName(user) {
  return normalizeText(user?.full_name || user?.fullName || user?.name);
}

function getPrivacyModeDescription() {
  return 'Controls how your identity is handled in non-public product flows.';
}

function getDirectoryVisibilityState(user) {
  const accountName = getAccountDirectoryName(user);
  const displayName = accountName;

  if (displayName) {
    return {
      isEligible: true,
      displayName,
      message: '',
    };
  }

  return {
    isEligible: false,
    displayName: '',
    message: 'Your account needs a full name before it can appear in the public directory.',
  };
}

const SOCIAL_LINK_FIELDS = [
  {
    key: 'linkedin',
    label: 'LinkedIn',
    icon: Linkedin,
    iconClassName: 'text-[#0077b5]',
    placeholder: 'https://linkedin.com/in/username',
    inputId: 'profile-social-linkedin',
  },
  {
    key: 'twitter',
    label: 'X',
    icon: Twitter,
    iconClassName: 'text-slate-700',
    placeholder: 'https://x.com/username',
    inputId: 'profile-social-twitter',
  },
  {
    key: 'github',
    label: 'GitHub',
    icon: Github,
    iconClassName: 'text-slate-900',
    placeholder: 'https://github.com/username',
    inputId: 'profile-social-github',
  },
  {
    key: 'crunchbase',
    label: 'Crunchbase',
    icon: Link2,
    iconClassName: 'text-orange-500',
    placeholder: 'https://crunchbase.com/person/name',
    inputId: 'profile-social-crunchbase',
  },
];

export default function Profile() {
  const { user, isLoadingAuth, navigateToLogin } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [formData, setFormData] = useState(() => ({
    ...EMPTY_FORM_DATA,
    social_links: { ...EMPTY_SOCIAL_LINKS },
  }));
  const [initialFormData, setInitialFormData] = useState(() => ({
    ...EMPTY_FORM_DATA,
    social_links: { ...EMPTY_SOCIAL_LINKS },
  }));
  const industryLoadErrorToastShownRef = useRef(false);

  useEffect(() => {
    if (!isLoadingAuth && !user) {
      navigateToLogin('/profile');
    }
  }, [isLoadingAuth, navigateToLogin, user]);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => accountClient.getProfile(),
    enabled: Boolean(user?.email),
  });

  const { data: billing } = useQuery({
    queryKey: ['billing-status'],
    queryFn: () => billingClient.get(),
    enabled: Boolean(user),
  });

  const {
    data: industryFacets = [],
    error: industryFacetError,
  } = useQuery({
    queryKey: ['directoryIndustryOptions'],
    queryFn: async () => {
      const response = await directoryClient.search({
        mode: 'both',
        q: '',
        page: 1,
        pageSize: 1,
      });

      return Array.isArray(response?.facets?.industries) ? response.facets.industries : [];
    },
    enabled: Boolean(user?.email),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!industryFacetError || industryLoadErrorToastShownRef.current) {
      return;
    }

    industryLoadErrorToastShownRef.current = true;
    toast.error('Unable to load industry options. You can still save other profile changes.');
  }, [industryFacetError]);

  useEffect(() => {
    const next = mapProfileToForm(profile || null);
    setFormData(next);
    setInitialFormData(next);
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: (payload) => accountClient.saveProfile(payload),
    onSuccess: async (savedProfile) => {
      const next = mapProfileToForm(savedProfile || null);
      setFormData(next);
      setInitialFormData(next);
      queryClient.setQueryData(['userProfile', user?.email], savedProfile || null);
      await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      toast.success('Saved');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to save profile');
    },
  });

  const websiteValidation = useMemo(
    () => normalizeWebsiteInput(formData.website),
    [formData.website],
  );

  const locationError = useMemo(() => {
    const location = normalizeText(formData.location);
    if (location.length > MAX_LOCATION_LENGTH) {
      return `Location must be ${MAX_LOCATION_LENGTH} characters or fewer.`;
    }
    return '';
  }, [formData.location]);

  const payload = useMemo(() => buildProfilePayload(formData), [formData]);
  const initialPayload = useMemo(() => buildProfilePayload(initialFormData), [initialFormData]);

  const isDirty = useMemo(
    () => JSON.stringify(payload) !== JSON.stringify(initialPayload),
    [payload, initialPayload],
  );

  const hasValidationErrors = Boolean(websiteValidation.error || locationError);
  const canSave = isDirty && !hasValidationErrors && !saveMutation.isPending;
  const isVerified = Boolean(profile?.email_verified || profile?.verification_status === 'verified');

  const industryOptions = useMemo(
    () => createIndustryOptions([...(industryFacets || []), formData.industry]),
    [industryFacets, formData.industry],
  );

  const accountProfileName = getAccountProfileName(user);
  const directoryVisibility = useMemo(
    () => getDirectoryVisibilityState(user),
    [user],
  );

  const planTier = billing?.plan_tier || 'starter';
  const subscriptionLabel = PLAN_LABELS[planTier] ?? 'Starter';
  const cancelAtPeriodEnd = Boolean(billing?.cancel_at_period_end);
  const currentPeriodEnd = billing?.current_period_end;
  const subscriptionDetail = (() => {
    if (planTier === 'professional' && cancelAtPeriodEnd) {
      if (currentPeriodEnd) {
        try {
          return { text: `Cancels on ${format(new Date(currentPeriodEnd), 'MMM d, yyyy')}`, color: 'text-amber-600' };
        } catch {
          // fall through
        }
      }
      return { text: 'Scheduled to cancel', color: 'text-amber-600' };
    }
    if (planTier === 'professional' && currentPeriodEnd) {
      try {
        return { text: `Renews on ${format(new Date(currentPeriodEnd), 'MMM d, yyyy')}`, color: 'text-slate-500' };
      } catch {
        // fall through
      }
    }
    if (planTier === 'early_access' && billing?.trial_ends_at) {
      try {
        return { text: `Trial ends on ${format(new Date(billing.trial_ends_at), 'MMM d, yyyy')}`, color: 'text-blue-600' };
      } catch {
        // fall through
      }
    }
    return null;
  })();

  const previewName = directoryVisibility.displayName ||
    'Your full name will appear here in the public directory';
  const previewTitle = normalizeText(formData.title) || 'Add your title / role';
  const previewIndustry = normalizeText(formData.industry) || 'Select an industry';
  const previewLocation = normalizeText(formData.location) || 'City, Country';
  const previewTagline = normalizeText(formData.tagline) || 'Add a short tagline to strengthen your listing.';

  const setField = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const setSocialLink = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      social_links: {
        ...prev.social_links,
        [field]: value,
      },
    }));
  };

  const handleSave = () => {
    if (!isDirty) {
      return;
    }

    if (hasValidationErrors) {
      toast.error('Fix validation errors before saving.');
      return;
    }

    saveMutation.mutate(payload);
  };

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!isDirty) {
          return;
        }

        event.preventDefault();
        event.returnValue = '';
      },
      [isDirty],
    ),
  );

  useEffect(() => {
    if (!isDirty) {
      return undefined;
    }

    const handleDocumentClick = (event) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      if (!(event.target instanceof Element)) {
        return;
      }

      const link = event.target.closest('a[href]');
      if (!link || link.hasAttribute('download') || link.getAttribute('target') === '_blank') {
        return;
      }

      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      let nextUrl;
      try {
        nextUrl = new URL(link.href, window.location.href);
      } catch {
        return;
      }

      if (nextUrl.origin !== window.location.origin) {
        return;
      }

      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const next = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      if (current === next) {
        return;
      }

      const shouldLeave = window.confirm('You have unsaved changes. Leave this page?');
      if (!shouldLeave) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [isDirty]);

  if (isLoadingAuth || isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4">
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">My Profile</h1>
              <p className="text-slate-500">Manage your professional identity and directory presence.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
              <Badge
                data-testid="verifiedBadge"
                className={isVerified ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}
              >
                {isVerified ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                {isVerified ? 'Verified' : 'Unverified'}
              </Badge>
              {!isVerified ? (
                <Button
                  type="button"
                  data-testid="verifyButton"
                  onClick={() => navigate(createPageUrl('Verification'))}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Verify account
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-slate-600">
            Verification adds a Verified badge to your public directory listing.
          </p>
        </div>

        <Tabs value="profile" className="space-y-4">
          <TabsList className="bg-white border border-slate-200 p-1 w-fit">
            <TabsTrigger value="profile" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <User className="w-4 h-4 mr-2" />
              Profile
            </TabsTrigger>
          </TabsList>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">Subscription</p>
                  <p className="text-sm text-slate-600 mt-0.5">{subscriptionLabel}</p>
                  {subscriptionDetail ? (
                    <p className={`text-xs ${subscriptionDetail.color} mt-0.5`}>{subscriptionDetail.text}</p>
                  ) : null}
                </div>
                <Link to={createPageUrl('Billing')}>
                  <Button variant="outline" size="sm">Manage</Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <TabsList className="bg-white border border-slate-200 p-1 w-fit">
            <TabsTrigger value="profile" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <User className="w-4 h-4 mr-2" />
              Profile
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-0">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle>Profile</CardTitle>
                <CardDescription>Update your profile details, bio, and social links.</CardDescription>
              </CardHeader>

              <CardContent className="space-y-8">
                <section className="space-y-4" aria-labelledby="profile-basic-info-heading">
                  <h2 id="profile-basic-info-heading" className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                    Basic Information
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <Label htmlFor="profile-full-name">Full Name</Label>
                      <Input id="profile-full-name" value={accountProfileName} disabled className="bg-slate-50" />
                      <p className="text-xs text-slate-500">Managed by your account settings and used for public directory listings.</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-user-type">User Type</Label>
                      <Select
                        value={formData.user_type}
                        onValueChange={(value) => setField('user_type', value)}
                      >
                        <SelectTrigger id="profile-user-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="individual">Individual</SelectItem>
                          <SelectItem value="business">Business User</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-privacy-mode">Privacy Mode</Label>
                      <Select
                        value={formData.privacy_mode}
                        onValueChange={(value) => setField('privacy_mode', value)}
                      >
                        <SelectTrigger id="profile-privacy-mode" data-testid="profilePrivacyModeTrigger">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="public">Public</SelectItem>
                          <SelectItem value="pseudonymous">Pseudonymous</SelectItem>
                          <SelectItem value="private">Private</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-slate-500">{getPrivacyModeDescription()}</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-pseudonym">Display Name (Pseudonym)</Label>
                      <Input
                        id="profile-pseudonym"
                        data-testid="profilePseudonymInput"
                        value={formData.pseudonym}
                        onChange={(event) => setField('pseudonym', event.target.value.slice(0, MAX_PSEUDONYM_LENGTH))}
                        placeholder="Used in pseudonymous product flows"
                        maxLength={MAX_PSEUDONYM_LENGTH}
                      />
                      <p className="text-xs text-slate-500">
                        Used in pseudonymous product flows outside the public directory.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-title-role">Title / Role</Label>
                      <Input
                        id="profile-title-role"
                        value={formData.title}
                        onChange={(event) => setField('title', event.target.value)}
                        placeholder="e.g., Founder, Investor, Product Lead"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-industry">Industry</Label>
                      <Select
                        value={formData.industry || 'none'}
                        onValueChange={(value) => setField('industry', value === 'none' ? '' : value)}
                      >
                        <SelectTrigger id="profile-industry">
                          <SelectValue placeholder="Select industry" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Select industry</SelectItem>
                          {industryOptions.map((industry) => (
                            <SelectItem key={industry} value={industry}>
                              {industry}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-location">Location</Label>
                      <Input
                        id="profile-location"
                        value={formData.location}
                        onChange={(event) => setField('location', event.target.value)}
                        placeholder="City, Country"
                        maxLength={MAX_LOCATION_LENGTH}
                      />
                      {locationError ? <p className="text-xs text-red-600">{locationError}</p> : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-tagline">Tagline</Label>
                      <Input
                        id="profile-tagline"
                        data-testid="taglineInput"
                        value={formData.tagline}
                        onChange={(event) => setField('tagline', event.target.value.slice(0, MAX_TAGLINE_LENGTH))}
                        placeholder="e.g., Helping startups close enterprise pilots"
                        maxLength={MAX_TAGLINE_LENGTH}
                      />
                      <p className="text-xs text-slate-500">{MAX_TAGLINE_LENGTH - formData.tagline.length} characters left</p>
                    </div>
                  </div>
                </section>

                <section className="space-y-4" aria-labelledby="profile-about-heading">
                  <h2 id="profile-about-heading" className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                    About
                  </h2>

                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="profile-bio">Bio</Label>
                      <Textarea
                        id="profile-bio"
                        value={formData.bio}
                        onChange={(event) => setField('bio', event.target.value)}
                        placeholder="A brief professional description..."
                        className="min-h-[100px]"
                      />
                      <p className="text-xs text-slate-500">2-3 sentences: what you do and who you work with.</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="profile-website">Website</Label>
                      <Input
                        id="profile-website"
                        value={formData.website}
                        onChange={(event) => setField('website', event.target.value)}
                        placeholder="example.com or https://example.com"
                      />
                      {websiteValidation.error ? (
                        <p className="text-xs text-red-600">{websiteValidation.error}</p>
                      ) : (
                        <p className="text-xs text-slate-500">We normalize websites to secure 'https://' URLs on save.</p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="space-y-4" aria-labelledby="profile-social-links-heading">
                  <h2 id="profile-social-links-heading" className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                    Social Links
                  </h2>
                  <p className="text-sm text-slate-600">
                    Optional. Helps others verify your profile and provides context in opportunities.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {SOCIAL_LINK_FIELDS.map((field) => {
                      const Icon = field.icon;
                      return (
                        <div key={field.key} className="rounded-lg border border-slate-200 bg-white p-3 flex items-center gap-3">
                          <Icon className={`w-5 h-5 flex-shrink-0 ${field.iconClassName}`} />
                          <div className="flex-1 space-y-1">
                            <Label htmlFor={field.inputId} className="text-xs text-slate-600">{field.label}</Label>
                            <Input
                              id={field.inputId}
                              value={formData.social_links[field.key]}
                              onChange={(event) => setSocialLink(field.key, event.target.value)}
                              placeholder={field.placeholder}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section data-testid="profilePreview" className="space-y-4" aria-labelledby="profile-preview-heading">
                  <h2 id="profile-preview-heading" className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                    Profile Preview
                  </h2>
                  <p className="text-sm text-slate-600">Public directory card preview (not auto-saved)</p>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3 text-sm">
                    <div className="space-y-2">
                      <p className="font-semibold text-slate-900 text-base">{previewName}</p>
                      <Badge className={isVerified ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}>
                        {isVerified ? 'Verified' : 'Unverified'}
                      </Badge>
                    </div>

                    <div className="space-y-2 text-slate-600">
                      <div className="flex items-start gap-2">
                        <Briefcase className="w-4 h-4 mt-0.5" />
                        <span>{previewTitle}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Badge variant="outline" className="font-normal">{previewIndustry}</Badge>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 mt-0.5" />
                        <span>{previewLocation}</span>
                      </div>
                      <p className="text-slate-700">{previewTagline}</p>
                    </div>
                  </div>
                </section>

                <section className="space-y-4" aria-labelledby="profile-public-directory-heading">
                  <h2 id="profile-public-directory-heading" className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                    Public Directory
                  </h2>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="profile-public-directory" className="font-medium text-slate-900">Public Directory</Label>
                      <p className="text-sm text-slate-600">List this profile in the public directory.</p>
                      <p className="text-xs text-slate-500">
                        Your full name will be shown in the directory. Turn this off if you do not want your profile publicly discoverable.
                      </p>
                      {formData.is_public_directory ? (
                        directoryVisibility.isEligible ? (
                          <p data-testid="profilePublicDirectoryStatus" className="text-xs text-emerald-700">
                            Visible in the directory as {directoryVisibility.displayName}.
                          </p>
                        ) : (
                          <p data-testid="profilePublicDirectoryStatus" className="text-xs text-amber-700">
                            Not visible yet. {directoryVisibility.message}
                          </p>
                        )
                      ) : (
                        <p className="text-xs text-slate-500">Shows your name, title, industry, location, and tagline.</p>
                      )}
                    </div>
                    <Switch
                      id="profile-public-directory"
                      data-testid="profilePublicDirectoryToggle"
                      checked={formData.is_public_directory}
                      onCheckedChange={(checked) => setField('is_public_directory', checked)}
                    />
                  </div>
                </section>
              </CardContent>

              <CardFooter className="border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-sm text-slate-500">
                  {hasValidationErrors
                    ? 'Fix validation errors before saving.'
                    : isDirty
                      ? 'You have unsaved changes.'
                      : 'No changes to save.'}
                </p>
                <Button
                  type="button"
                  data-testid="saveButton"
                  onClick={handleSave}
                  disabled={!canSave}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>

        {saveMutation.isSuccess && !isDirty && !saveMutation.isPending ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 text-green-700">
            <CheckCircle2 className="w-5 h-5" />
            Profile saved successfully.
          </div>
        ) : null}
      </div>
    </div>
  );
}
