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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import {
  User, Shield, Globe, Linkedin, Github, Twitter, Link2,
  Save, CheckCircle2, AlertCircle, Eye, EyeOff
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';

export default function Profile() {
  const { user, isLoadingAuth, navigateToLogin } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isLoadingAuth && !user) {
      navigateToLogin('/profile');
    }
  }, [isLoadingAuth, navigateToLogin, user]);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => accountClient.getProfile(),
    enabled: !!user?.email
  });

  const [formData, setFormData] = useState({
    pseudonym: '',
    user_type: 'individual',
    title: '',
    industry: '',
    location: '',
    bio: '',
    website: '',
    privacy_mode: 'pseudonymous',
    social_links: {
      linkedin: '',
      twitter: '',
      github: '',
      crunchbase: ''
    },
    social_links_ai_consent: false
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        pseudonym: profile.pseudonym || '',
        user_type: profile.user_type || 'individual',
        title: profile.title || '',
        industry: profile.industry || '',
        location: profile.location || '',
        bio: profile.bio || '',
        website: profile.website || '',
        privacy_mode: profile.privacy_mode || 'pseudonymous',
        social_links: profile.social_links || {
          linkedin: '',
          twitter: '',
          github: '',
          crunchbase: ''
        },
        social_links_ai_consent: profile.social_links_ai_consent || false
      });
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: (data) => accountClient.saveProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    }
  });

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const industries = [
    'Technology', 'Finance', 'Healthcare', 'Manufacturing', 'Retail',
    'Real Estate', 'Energy', 'Media', 'Education', 'Legal', 'Consulting', 'Other'
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
            <h1 className="text-2xl font-bold text-slate-900">My Profile</h1>
            <p className="text-slate-500">Manage your professional identity and privacy settings.</p>
          </div>
          <div className="flex items-center gap-2">
            {profile?.verification_status === 'verified' ? (
              <Badge className="bg-green-100 text-green-700">
                <CheckCircle2 className="w-3 h-3 mr-1" />Verified
              </Badge>
            ) : (
              <Link to={createPageUrl('Verification')}>
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  Unverified - Click to Verify
                </Button>
              </Link>
            )}
          </div>
        </div>

        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="bg-white border border-slate-200 p-1">
            <TabsTrigger value="profile" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <User className="w-4 h-4 mr-2" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="privacy" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Shield className="w-4 h-4 mr-2" />
              Privacy
            </TabsTrigger>
            <TabsTrigger value="social" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Globe className="w-4 h-4 mr-2" />
              Social Links
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>This information will be shared based on your privacy settings.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Full Name</Label>
                    <Input value={user?.full_name || ''} disabled className="bg-slate-50" />
                    <p className="text-xs text-slate-500">Managed by your account settings</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Pseudonym / Display Name</Label>
                    <Input 
                      value={formData.pseudonym}
                      onChange={(e) => setFormData({ ...formData, pseudonym: e.target.value })}
                      placeholder="e.g., TechFounder_2024"
                    />
                    <p className="text-xs text-slate-500">Used when in pseudonymous mode</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>User Type</Label>
                    <Select 
                      value={formData.user_type}
                      onValueChange={(v) => setFormData({ ...formData, user_type: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="individual">Individual</SelectItem>
                        <SelectItem value="business">Business User</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Professional Title</Label>
                    <Input 
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="e.g., CEO, Investor, Consultant"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Industry</Label>
                    <Select 
                      value={formData.industry}
                      onValueChange={(v) => setFormData({ ...formData, industry: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select industry" />
                      </SelectTrigger>
                      <SelectContent>
                        {industries.map(ind => (
                          <SelectItem key={ind} value={ind.toLowerCase()}>{ind}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Location</Label>
                    <Input 
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      placeholder="City, Country"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Bio</Label>
                  <Textarea 
                    value={formData.bio}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                    placeholder="A brief professional description..."
                    className="min-h-[100px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Website</Label>
                  <Input 
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    placeholder="https://example.com"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="privacy">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Privacy Settings</CardTitle>
                <CardDescription>Control how your identity appears to others.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <Label>Default Privacy Mode</Label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { value: 'public', label: 'Public', icon: Eye, desc: 'Full identity visible to all' },
                      { value: 'pseudonymous', label: 'Pseudonymous', icon: User, desc: 'Use display name until reveal' },
                      { value: 'private', label: 'Private', icon: EyeOff, desc: 'Hidden until explicit reveal' }
                    ].map(mode => (
                      <button
                        key={mode.value}
                        onClick={() => setFormData({ ...formData, privacy_mode: mode.value })}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          formData.privacy_mode === mode.value
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <mode.icon className={`w-5 h-5 mb-2 ${
                          formData.privacy_mode === mode.value ? 'text-blue-600' : 'text-slate-400'
                        }`} />
                        <p className="font-medium text-slate-900">{mode.label}</p>
                        <p className="text-xs text-slate-500 mt-1">{mode.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <h4 className="font-medium text-slate-900 mb-3">Privacy Settings</h4>
                  <p className="text-sm text-slate-600 mb-4">
                    Control how your identity appears to others:
                  </p>
                  <ul className="space-y-2 text-sm text-slate-600">
                    <li className="flex items-start gap-2">
                      <Eye className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <strong>Public:</strong> Visible in the public directory with full identity
                      </div>
                    </li>
                    <li className="flex items-start gap-2">
                      <User className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <strong>Pseudonymous:</strong> Visible in directory but identity masked until reveal
                      </div>
                    </li>
                    <li className="flex items-start gap-2">
                      <EyeOff className="w-4 h-4 text-slate-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <strong>Private:</strong> Hidden from directory until explicit reveal
                      </div>
                    </li>
                  </ul>
                </div>

                <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                  <h4 className="font-medium text-amber-900 mb-2">Progressive Reveal Gates</h4>
                  <p className="text-sm text-amber-700 mb-4">
                    Control what information is revealed at each gate level in proposals.
                  </p>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-3">
                      <Badge className="bg-slate-100 text-slate-700">Gate 1</Badge>
                      <span className="text-slate-600">Basic profile + fit score</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge className="bg-blue-100 text-blue-700">Gate 2</Badge>
                      <span className="text-slate-600">Selected fields after mutual interest</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge className="bg-green-100 text-green-700">Gate 3</Badge>
                      <span className="text-slate-600">Full identity + contact after mutual reveal</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="social">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Social Links</CardTitle>
                <CardDescription>These links are used for AI evaluation and social signals.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Linkedin className="w-5 h-5 text-[#0077b5]" />
                    <div className="flex-1">
                      <Input 
                        value={formData.social_links.linkedin}
                        onChange={(e) => setFormData({
                          ...formData,
                          social_links: { ...formData.social_links, linkedin: e.target.value }
                        })}
                        placeholder="https://linkedin.com/in/username"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Twitter className="w-5 h-5 text-slate-700" />
                    <div className="flex-1">
                      <Input 
                        value={formData.social_links.twitter}
                        onChange={(e) => setFormData({
                          ...formData,
                          social_links: { ...formData.social_links, twitter: e.target.value }
                        })}
                        placeholder="https://x.com/username"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Github className="w-5 h-5 text-slate-900" />
                    <div className="flex-1">
                      <Input 
                        value={formData.social_links.github}
                        onChange={(e) => setFormData({
                          ...formData,
                          social_links: { ...formData.social_links, github: e.target.value }
                        })}
                        placeholder="https://github.com/username"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Link2 className="w-5 h-5 text-orange-500" />
                    <div className="flex-1">
                      <Input 
                        value={formData.social_links.crunchbase}
                        onChange={(e) => setFormData({
                          ...formData,
                          social_links: { ...formData.social_links, crunchbase: e.target.value }
                        })}
                        placeholder="https://crunchbase.com/person/name"
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-4">
                  <p className="text-sm text-blue-700">
                    <strong>AI Evaluation:</strong> Social links are analyzed by AI to provide additional context 
                    and trust signals in proposal evaluations. More complete profiles lead to higher confidence scores.
                  </p>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-4 bg-white rounded-lg border border-blue-200">
                      <div className="flex-1">
                        <p className="font-medium text-blue-900 text-sm">AI Analysis Consent</p>
                        <p className="text-xs text-blue-600 mt-1">
                          I consent to my social links being used by AI evaluations
                        </p>
                      </div>
                      <Switch 
                        checked={formData.social_links_ai_consent}
                        onCheckedChange={(v) => setFormData({ ...formData, social_links_ai_consent: v })}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      You can change this anytime. Consent affects future evaluations. Your social links remain 
                      stored but will not be used by AI if consent is disabled.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Save Button */}
        <div className="mt-6 flex justify-end">
          <Button 
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

        {saveMutation.isSuccess && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 text-green-700"
          >
            <CheckCircle2 className="w-5 h-5" />
            Profile saved successfully!
          </motion.div>
        )}
      </div>
    </div>
  );
}
