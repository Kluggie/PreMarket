import React, { useState, useEffect } from 'react';
import { accountClient } from '@/api/accountClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import ManageOrgDialog from '../components/organization/ManageOrgDialog';
import {
  Building2, Plus, Save, Crown
} from 'lucide-react';
import { toast } from 'sonner';

export default function Organization() {
  const { user, isLoadingAuth, navigateToLogin } = useAuth();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isLoadingAuth && !user) {
      navigateToLogin('/organization');
    }
  }, [isLoadingAuth, navigateToLogin, user]);

  const { data: orgData, isLoading } = useQuery({
    queryKey: ['accountOrganizations', user?.email],
    queryFn: () => accountClient.getOrganizations(),
    enabled: !!user?.email
  });

  const memberships = orgData?.memberships || [];
  const organizations = orgData?.organizations || [];

  const [newOrg, setNewOrg] = useState({
    name: '',
    pseudonym: '',
    type: 'startup',
    industry: '',
    location: '',
    website: '',
    bio: '',
    is_public_directory: false,
    social_links: {
      linkedin: '',
      twitter: '',
      crunchbase: ''
    }
  });

  const createOrgMutation = useMutation({
    mutationFn: (data) => accountClient.createOrganization(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountOrganizations'] });
      setShowCreateForm(false);
      setNewOrg({
        name: '',
        pseudonym: '',
        type: 'startup',
        industry: '',
        location: '',
        website: '',
        bio: '',
        is_public_directory: false,
        social_links: { linkedin: '', twitter: '', crunchbase: '' }
      });
      toast.success('Organization created successfully');
    }
  });

  const updateOrgMutation = useMutation({
    mutationFn: ({ orgId, data }) => accountClient.updateOrganization(orgId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountOrganizations'] });
      toast.success('Organization updated successfully');
    },
    onError: () => {
      toast.error('Failed to update organization');
    }
  });

  const orgTypes = [
    { value: 'startup', label: 'Startup' },
    { value: 'corporation', label: 'Corporation' },
    { value: 'investment_firm', label: 'Investment Firm' },
    { value: 'consulting', label: 'Consulting Firm' },
    { value: 'legal', label: 'Legal Firm' },
    { value: 'other', label: 'Other' }
  ];

  if (isLoadingAuth || isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Organization</h1>
            <p className="text-slate-500">Manage your business profile and team members.</p>
          </div>
          {!showCreateForm && (
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Organization
            </Button>
          )}
        </div>

        {/* Create Form */}
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="border-0 shadow-sm mb-8">
              <CardHeader>
                <CardTitle>Create Organization</CardTitle>
                <CardDescription>Set up your business profile for pre-qualification proposals.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Organization Name *</Label>
                    <Input 
                      value={newOrg.name}
                      onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                      placeholder="Acme Corporation"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Name (Pseudonym)</Label>
                    <Input 
                      value={newOrg.pseudonym}
                      onChange={(e) => setNewOrg({ ...newOrg, pseudonym: e.target.value })}
                      placeholder="For pseudonymous mode"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Organization Type</Label>
                    <Select 
                      value={newOrg.type}
                      onValueChange={(v) => setNewOrg({ ...newOrg, type: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {orgTypes.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Industry</Label>
                    <Input 
                      value={newOrg.industry}
                      onChange={(e) => setNewOrg({ ...newOrg, industry: e.target.value })}
                      placeholder="Technology, Finance, etc."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Location</Label>
                    <Input 
                      value={newOrg.location}
                      onChange={(e) => setNewOrg({ ...newOrg, location: e.target.value })}
                      placeholder="City, Country"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Website</Label>
                    <Input 
                      value={newOrg.website}
                      onChange={(e) => setNewOrg({ ...newOrg, website: e.target.value })}
                      placeholder="https://example.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea 
                    value={newOrg.bio}
                    onChange={(e) => setNewOrg({ ...newOrg, bio: e.target.value })}
                    placeholder="Brief description of your organization..."
                    className="min-h-[100px]"
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                  <div>
                    <p className="font-medium text-slate-900">Public Directory</p>
                    <p className="text-sm text-slate-500">Allow others to find you in the public directory</p>
                  </div>
                  <Switch 
                    checked={newOrg.is_public_directory}
                    onCheckedChange={(v) => setNewOrg({ ...newOrg, is_public_directory: v })}
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-slate-100">
                  <Button 
                    variant="outline" 
                    onClick={() => setShowCreateForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => createOrgMutation.mutate(newOrg)}
                    disabled={!newOrg.name || createOrgMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {createOrgMutation.isPending ? 'Creating...' : 'Create Organization'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Organizations List */}
        {organizations.length > 0 ? (
          <div className="space-y-4">
            {organizations.map(org => {
              const membership = memberships.find(m => m.organization_id === org.id);
              const canManageOrg =
                user?.role === 'admin' ||
                membership?.role === 'owner' ||
                membership?.role === 'admin';
              return (
                <Card key={org.id} className="border-0 shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                        <Building2 className="w-7 h-7 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-semibold text-slate-900">{org.name}</h3>
                          {membership?.role === 'owner' && (
                            <Badge className="bg-amber-100 text-amber-700">
                              <Crown className="w-3 h-3 mr-1" />
                              Owner
                            </Badge>
                          )}
                          <Badge className={
                            org.verification_status === 'verified'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-slate-100 text-slate-600'
                          }>
                            {org.verification_status === 'verified' ? 'Verified' : 'Unverified'}
                          </Badge>
                        </div>
                        <p className="text-slate-500 text-sm mb-2">{org.bio || 'No description'}</p>
                        <div className="flex flex-wrap gap-3 text-sm text-slate-500">
                          {org.industry && <span className="px-2 py-1 bg-slate-100 rounded">{org.industry}</span>}
                          {org.location && <span className="px-2 py-1 bg-slate-100 rounded">{org.location}</span>}
                          {org.type && (
                            <span className="px-2 py-1 bg-slate-100 rounded capitalize">
                              {org.type.replace('_', ' ')}
                            </span>
                          )}
                        </div>
                      </div>
                      {canManageOrg && (
                        <ManageOrgDialog
                          org={org}
                          onSave={(data) => updateOrgMutation.mutate({ orgId: org.id, data })}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : !showCreateForm && (
          <Card className="border-dashed border-2 border-slate-200">
            <CardContent className="py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <Building2 className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No organization yet</h3>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">
                Create an organization to send and receive proposals as a business entity.
              </p>
              <Button onClick={() => setShowCreateForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Organization
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
