import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBeforeUnload } from 'react-router-dom';
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
import { Switch } from '@/components/ui/switch';
import {
  Building2,
  Save,
  Linkedin,
  Github,
  Twitter,
  Link2,
  MapPin,
  CheckCircle2,
  Globe,
} from 'lucide-react';
import { toast } from 'sonner';

const MAX_TAGLINE_LENGTH = 80;
const MAX_LOCATION_LENGTH = 120;
const MAX_WEBSITE_LENGTH = 280;
const MAX_SOCIAL_URL_LENGTH = 280;

const EMPTY_SOCIAL_LINKS = {
  linkedin: '',
  twitter: '',
  github: '',
  crunchbase: '',
};

const EMPTY_ORGANIZATION_FORM = {
  name: '',
  type: 'startup',
  industry: '',
  location: '',
  website: '',
  tagline: '',
  bio: '',
  is_public_directory: false,
  social_links: { ...EMPTY_SOCIAL_LINKS },
};

const ORGANIZATION_TYPES = [
  { value: 'startup', label: 'Startup' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'investment_firm', label: 'Investment Firm' },
  { value: 'consulting', label: 'Consulting Firm' },
  { value: 'legal', label: 'Legal Firm' },
  { value: 'other', label: 'Other' },
];

const SOCIAL_LINK_FIELDS = [
  {
    key: 'linkedin',
    label: 'LinkedIn',
    icon: Linkedin,
    iconClassName: 'text-[#0077b5]',
    placeholder: 'https://linkedin.com/company/yourcompany',
    inputId: 'organization-social-linkedin',
  },
  {
    key: 'twitter',
    label: 'X',
    icon: Twitter,
    iconClassName: 'text-slate-700',
    placeholder: 'https://x.com/yourcompany',
    inputId: 'organization-social-twitter',
  },
  {
    key: 'github',
    label: 'GitHub',
    icon: Github,
    iconClassName: 'text-slate-900',
    placeholder: 'https://github.com/yourorg',
    inputId: 'organization-social-github',
  },
  {
    key: 'crunchbase',
    label: 'Crunchbase',
    icon: Link2,
    iconClassName: 'text-orange-500',
    placeholder: 'https://crunchbase.com/organization/yourcompany',
    inputId: 'organization-social-crunchbase',
  },
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUrlInput(rawValue, maxLength) {
  const raw = normalizeText(rawValue);
  if (!raw) {
    return { normalized: '', error: '' };
  }

  if (raw.length > maxLength) {
    return {
      normalized: '',
      error: `URL must be ${maxLength} characters or fewer.`,
    };
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      return {
        normalized: '',
        error: 'Enter a valid URL.',
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
      error: 'Enter a valid URL.',
    };
  }
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

function mapOrganizationToForm(organization) {
  if (!organization) {
    return {
      ...EMPTY_ORGANIZATION_FORM,
      social_links: { ...EMPTY_SOCIAL_LINKS },
    };
  }

  return {
    name: organization.name || '',
    type: organization.type || 'startup',
    industry: organization.industry || '',
    location: organization.location || '',
    website: organization.website || '',
    tagline: organization.tagline || '',
    bio: organization.bio || '',
    is_public_directory: Boolean(organization.is_public_directory),
    social_links: {
      ...EMPTY_SOCIAL_LINKS,
      ...(organization.social_links || {}),
    },
  };
}

function buildOrganizationPayload(formData) {
  const websiteValidation = normalizeUrlInput(formData.website, MAX_WEBSITE_LENGTH);
  const socialLinks = normalizeSocialLinks(formData.social_links);

  const normalizedSocialLinks = {};
  Object.entries(socialLinks).forEach(([key, value]) => {
    const linkValidation = normalizeUrlInput(value, MAX_SOCIAL_URL_LENGTH);
    normalizedSocialLinks[key] = linkValidation.error ? value : linkValidation.normalized;
  });

  return {
    name: normalizeText(formData.name),
    type: normalizeText(formData.type) || 'startup',
    industry: normalizeText(formData.industry),
    location: normalizeText(formData.location),
    website: websiteValidation.error ? normalizeText(formData.website) : websiteValidation.normalized,
    tagline: normalizeText(formData.tagline),
    bio: normalizeText(formData.bio),
    is_public_directory: Boolean(formData.is_public_directory),
    social_links: normalizedSocialLinks,
  };
}

export default function Organization() {
  const { user, isLoadingAuth, navigateToLogin } = useAuth();
  const queryClient = useQueryClient();

  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [formData, setFormData] = useState(() => ({
    ...EMPTY_ORGANIZATION_FORM,
    social_links: { ...EMPTY_SOCIAL_LINKS },
  }));
  const [initialFormData, setInitialFormData] = useState(() => ({
    ...EMPTY_ORGANIZATION_FORM,
    social_links: { ...EMPTY_SOCIAL_LINKS },
  }));
  const [serverFieldErrors, setServerFieldErrors] = useState({});
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);

  const industryLoadErrorToastShownRef = useRef(false);
  const createModeRequestedRef = useRef(false);

  useEffect(() => {
    if (!isLoadingAuth && !user) {
      navigateToLogin('/organization');
    }
  }, [isLoadingAuth, navigateToLogin, user]);

  const { data: orgData, isLoading } = useQuery({
    queryKey: ['accountOrganizations', user?.email],
    queryFn: () => accountClient.getOrganizations(),
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
    toast.error('Unable to load industry options. You can still save other organization changes.');
  }, [industryFacetError]);

  const memberships = orgData?.memberships || [];
  const organizations = orgData?.organizations || [];

  const manageableOrganizations = useMemo(() => {
    const membershipByOrgId = new Map();
    memberships.forEach((membership) => {
      membershipByOrgId.set(membership.organization_id, membership);
    });

    return organizations.filter((organization) => {
      if (user?.role === 'admin') {
        return true;
      }

      const membership = membershipByOrgId.get(organization.id);
      const role = normalizeText(membership?.role).toLowerCase();
      return role === 'owner' || role === 'admin';
    });
  }, [memberships, organizations, user?.role]);

  useEffect(() => {
    if (manageableOrganizations.length === 0) {
      setSelectedOrganizationId('__new__');
      return;
    }

    setSelectedOrganizationId((previous) => {
      if (previous === '__new__' && createModeRequestedRef.current) {
        return previous;
      }

      const exists = manageableOrganizations.some((organization) => organization.id === previous);
      if (exists) {
        return previous;
      }

      return manageableOrganizations[0].id;
    });
  }, [manageableOrganizations]);

  const isCreateMode = selectedOrganizationId === '__new__' || manageableOrganizations.length === 0;

  const activeOrganization = useMemo(() => {
    if (isCreateMode) {
      return null;
    }

    return manageableOrganizations.find((organization) => organization.id === selectedOrganizationId) || null;
  }, [isCreateMode, manageableOrganizations, selectedOrganizationId]);

  useEffect(() => {
    const next = mapOrganizationToForm(activeOrganization || null);
    setFormData(next);
    setInitialFormData(next);
    setServerFieldErrors({});
    setHasAttemptedSave(false);
  }, [activeOrganization?.id, activeOrganization?.updated_date, isCreateMode]);

  const saveMutation = useMutation({
    mutationFn: async ({ orgId, payload }) => {
      if (orgId) {
        const organization = await accountClient.updateOrganization(orgId, payload);
        return { organization, created: false };
      }

      const created = await accountClient.createOrganization(payload);
      return { organization: created.organization, created: true };
    },
    onSuccess: async ({ organization, created }) => {
      const next = mapOrganizationToForm(organization || null);
      setFormData(next);
      setInitialFormData(next);
      setServerFieldErrors({});
      setHasAttemptedSave(false);

      if (organization?.id) {
        createModeRequestedRef.current = false;
        setSelectedOrganizationId(organization.id);
      }

      await queryClient.invalidateQueries({ queryKey: ['accountOrganizations'] });
      toast.success(created ? 'Organization created successfully' : 'Organization updated successfully');
    },
    onError: (error) => {
      const field = error?.body?.error?.field;
      if (field) {
        setServerFieldErrors((previous) => ({
          ...previous,
          [field]: error?.message || 'Invalid value',
        }));
      }

      toast.error(error?.message || 'Failed to save organization');
    },
  });

  const setField = (field, value) => {
    setFormData((previous) => ({
      ...previous,
      [field]: value,
    }));
    setServerFieldErrors((previous) => {
      if (!previous[field]) {
        return previous;
      }

      const next = { ...previous };
      delete next[field];
      return next;
    });
  };

  const setSocialLink = (field, value) => {
    setFormData((previous) => ({
      ...previous,
      social_links: {
        ...previous.social_links,
        [field]: value,
      },
    }));

    const fieldKey = `social_links.${field}`;
    setServerFieldErrors((previous) => {
      if (!previous[fieldKey]) {
        return previous;
      }

      const next = { ...previous };
      delete next[fieldKey];
      return next;
    });
  };

  const websiteValidation = useMemo(
    () => normalizeUrlInput(formData.website, MAX_WEBSITE_LENGTH),
    [formData.website],
  );

  const socialLinkValidations = useMemo(() => {
    return SOCIAL_LINK_FIELDS.reduce((accumulator, field) => {
      accumulator[field.key] = normalizeUrlInput(formData.social_links[field.key], MAX_SOCIAL_URL_LENGTH);
      return accumulator;
    }, {});
  }, [formData.social_links]);

  const locationError = useMemo(() => {
    const location = normalizeText(formData.location);
    if (location.length > MAX_LOCATION_LENGTH) {
      return `Location must be ${MAX_LOCATION_LENGTH} characters or fewer.`;
    }

    return '';
  }, [formData.location]);

  const payload = useMemo(() => buildOrganizationPayload(formData), [formData]);
  const initialPayload = useMemo(() => buildOrganizationPayload(initialFormData), [initialFormData]);

  const isDirty = useMemo(
    () => JSON.stringify(payload) !== JSON.stringify(initialPayload),
    [payload, initialPayload],
  );

  const nameError = normalizeText(formData.name) ? '' : 'Organization name is required.';
  const hasSocialValidationErrors = Object.values(socialLinkValidations).some((validation) => Boolean(validation.error));
  const hasRequiredFieldErrors = Boolean(nameError) && (isDirty || hasAttemptedSave);
  const hasValidationErrors = Boolean(
    locationError || websiteValidation.error || hasSocialValidationErrors || hasRequiredFieldErrors,
  );
  const canSave = isDirty && !hasValidationErrors && !saveMutation.isPending;

  const industryOptions = useMemo(
    () => createIndustryOptions([...(industryFacets || []), formData.industry]),
    [industryFacets, formData.industry],
  );

  const previewName = normalizeText(formData.name) || 'Organization name';
  const previewIndustry = normalizeText(formData.industry) || 'Select an industry';
  const previewLocation = normalizeText(formData.location) || 'City, Country';
  const previewTagline = normalizeText(formData.tagline) || 'Add a short tagline to strengthen your listing.';
  const previewWebsite = websiteValidation.error
    ? normalizeText(formData.website)
    : websiteValidation.normalized || normalizeText(formData.website);
  const organizationVerified = normalizeText(activeOrganization?.verification_status).toLowerCase() === 'verified';

  const handleSave = () => {
    setHasAttemptedSave(true);

    if (!isDirty) {
      return;
    }

    if (hasValidationErrors) {
      toast.error('Fix validation errors before saving.');
      return;
    }

    saveMutation.mutate({
      orgId: activeOrganization?.id,
      payload,
    });
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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Organization</h1>
            <p className="text-slate-500">Manage your organization profile and directory presence.</p>
          </div>
          {!isCreateMode ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                createModeRequestedRef.current = true;
                setSelectedOrganizationId('__new__');
              }}
            >
              Create Organization
            </Button>
          ) : manageableOrganizations.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                createModeRequestedRef.current = false;
                setSelectedOrganizationId(manageableOrganizations[0].id);
              }}
            >
              Edit Existing Organization
            </Button>
          ) : null}
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-4 space-y-4">
            <div>
              <CardTitle>{isCreateMode ? 'Create Organization' : 'Organization Profile'}</CardTitle>
              <CardDescription>
                {isCreateMode
                  ? 'Set up your organization profile for directory visibility and proposal context.'
                  : 'Update your organization details, social links, and directory settings.'}
              </CardDescription>
            </div>

            {!isCreateMode && manageableOrganizations.length > 1 ? (
              <div className="max-w-sm space-y-2">
                <Label htmlFor="organization-selector">Organization</Label>
                <Select value={selectedOrganizationId} onValueChange={setSelectedOrganizationId}>
                  <SelectTrigger id="organization-selector">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {manageableOrganizations.map((organization) => (
                      <SelectItem key={organization.id} value={organization.id}>
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </CardHeader>

          <CardContent className="space-y-8">
            <section className="space-y-4" aria-labelledby="organization-basic-information-heading">
              <h2 id="organization-basic-information-heading" className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                Basic Information
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="organization-name">Organization Name</Label>
                  <Input
                    id="organization-name"
                    value={formData.name}
                    onChange={(event) => setField('name', event.target.value)}
                    placeholder="Acme Corporation"
                    maxLength={160}
                  />
                  {nameError && hasAttemptedSave ? <p className="text-xs text-red-600">{nameError}</p> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="organization-type">Organization Type</Label>
                  <Select value={formData.type} onValueChange={(value) => setField('type', value)}>
                    <SelectTrigger id="organization-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORGANIZATION_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="organization-industry">Industry</Label>
                  <Select
                    value={formData.industry || 'none'}
                    onValueChange={(value) => setField('industry', value === 'none' ? '' : value)}
                  >
                    <SelectTrigger id="organization-industry">
                      <SelectValue placeholder="Select industry" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select industry</SelectItem>
                      {industryOptions.map((industry) => (
                        <SelectItem key={industry} value={industry}>{industry}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="organization-location">Location</Label>
                  <Input
                    id="organization-location"
                    value={formData.location}
                    onChange={(event) => setField('location', event.target.value)}
                    placeholder="City, Country"
                    maxLength={MAX_LOCATION_LENGTH}
                  />
                  {locationError ? <p className="text-xs text-red-600">{locationError}</p> : null}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="organization-website">Website</Label>
                  <Input
                    id="organization-website"
                    value={formData.website}
                    onChange={(event) => setField('website', event.target.value)}
                    placeholder="example.com or https://example.com"
                  />
                  {websiteValidation.error ? (
                    <p className="text-xs text-red-600">{websiteValidation.error}</p>
                  ) : serverFieldErrors.website ? (
                    <p className="text-xs text-red-600">{serverFieldErrors.website}</p>
                  ) : (
                    <p className="text-xs text-slate-500">We normalize websites to secure 'https://' URLs on save.</p>
                  )}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="organization-tagline">Tagline</Label>
                  <Input
                    id="organization-tagline"
                    value={formData.tagline}
                    onChange={(event) => setField('tagline', event.target.value.slice(0, MAX_TAGLINE_LENGTH))}
                    placeholder="e.g., Helping enterprises move from pilot to scale"
                    maxLength={MAX_TAGLINE_LENGTH}
                  />
                  <p className="text-xs text-slate-500">{MAX_TAGLINE_LENGTH - formData.tagline.length} characters left</p>
                </div>
              </div>
            </section>

            <section className="space-y-4" aria-labelledby="organization-about-heading">
              <h2 id="organization-about-heading" className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                About
              </h2>
              <div className="space-y-2">
                <Label htmlFor="organization-bio">Description</Label>
                <Textarea
                  id="organization-bio"
                  value={formData.bio}
                  onChange={(event) => setField('bio', event.target.value)}
                  placeholder="Brief description of your organization..."
                  className="min-h-[110px]"
                  maxLength={2000}
                />
                <p className="text-xs text-slate-500">2-3 sentences: what you do and who you serve.</p>
              </div>
            </section>

            <section className="space-y-4" aria-labelledby="organization-social-links-heading">
              <h2 id="organization-social-links-heading" className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                Social Links
              </h2>
              <p className="text-sm text-slate-600">
                Optional. Helps others verify your organization and provides context in proposals.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SOCIAL_LINK_FIELDS.map((field) => {
                  const Icon = field.icon;
                  const fieldError = socialLinkValidations[field.key]?.error || serverFieldErrors[`social_links.${field.key}`] || '';

                  return (
                    <div key={field.key} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-3">
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
                      {fieldError ? <p className="text-xs text-red-600 mt-2">{fieldError}</p> : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-4" aria-labelledby="organization-public-directory-heading">
              <h2 id="organization-public-directory-heading" className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                Public Directory
              </h2>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="organization-public-directory" className="font-medium text-slate-900">Public Directory</Label>
                  <p className="text-sm text-slate-600">List this organization in the public directory.</p>
                  {formData.is_public_directory ? (
                    <p className="text-xs text-slate-500">Shows name, industry, location, tagline, and website.</p>
                  ) : null}
                </div>
                <Switch
                  id="organization-public-directory"
                  checked={formData.is_public_directory}
                  onCheckedChange={(checked) => setField('is_public_directory', checked)}
                />
              </div>

              {formData.is_public_directory ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3" data-testid="organizationDirectoryPreview">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900 text-base">{previewName}</p>
                    {organizationVerified ? (
                      <Badge className="bg-green-100 text-green-700">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Verified
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Building2 className="w-4 h-4" />
                    <span>{previewIndustry}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <MapPin className="w-4 h-4" />
                    <span>{previewLocation}</span>
                  </div>
                  <p className="text-sm text-slate-700 truncate">{previewTagline}</p>
                  {previewWebsite ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Globe className="w-3.5 h-3.5" />
                      <span className="truncate">{previewWebsite}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
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
              onClick={handleSave}
              disabled={!canSave}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="organizationSaveButton"
            >
              <Save className="w-4 h-4 mr-2" />
              {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
