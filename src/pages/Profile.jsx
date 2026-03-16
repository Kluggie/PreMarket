import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBeforeUnload, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountClient } from '@/api/accountClient';
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

const MAX_TAGLINE_LENGTH = 80;
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

function getDisplayName(user) {
  const name = normalizeText(user?.full_name || user?.fullName || user?.name);
  if (name) {
    return name;
  }

  return normalizeText(user?.email) || 'Your name';
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

  const previewName = getDisplayName(user);
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
                      <Input id="profile-full-name" value={previewName} disabled className="bg-slate-50" />
                      <p className="text-xs text-slate-500">Managed by your account settings</p>
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
                  <p className="text-sm text-slate-600">Directory card preview (not auto-saved)</p>

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
