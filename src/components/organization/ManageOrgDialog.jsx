import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from "@/components/ui/dialog";
import { Save } from 'lucide-react';

export default function ManageOrgDialog({ org, onSave, trigger }) {
  const [formData, setFormData] = useState({
    name: org.name || '',
    pseudonym: org.pseudonym || '',
    type: org.type || 'startup',
    industry: org.industry || '',
    location: org.location || '',
    website: org.website || '',
    bio: org.bio || '',
    is_public_directory: org.is_public_directory || false,
    social_links: org.social_links || { linkedin: '', twitter: '', crunchbase: '' }
  });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const orgTypes = [
    { value: 'startup', label: 'Startup' },
    { value: 'corporation', label: 'Corporation' },
    { value: 'investment_firm', label: 'Investment Firm' },
    { value: 'consulting', label: 'Consulting Firm' },
    { value: 'legal', label: 'Legal Firm' },
    { value: 'other', label: 'Other' }
  ];

  const handleSave = async () => {
    if (!formData.name) return;
    
    setSaving(true);
    try {
      await onSave(formData);
      setOpen(false);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button variant="outline" size="sm">Manage</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Organization</DialogTitle>
          <DialogDescription>Update your organization profile and settings.</DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Organization Name *</Label>
              <Input 
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Acme Corporation"
              />
            </div>
            <div className="space-y-2">
              <Label>Display Name (Pseudonym)</Label>
              <Input 
                value={formData.pseudonym}
                onChange={(e) => setFormData({ ...formData, pseudonym: e.target.value })}
                placeholder="For pseudonymous mode"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Organization Type</Label>
              <Select 
                value={formData.type}
                onValueChange={(v) => setFormData({ ...formData, type: v })}
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
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                placeholder="Technology, Finance, etc."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Location</Label>
              <Input 
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="City, Country"
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
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea 
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
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
              checked={formData.is_public_directory}
              onCheckedChange={(v) => setFormData({ ...formData, is_public_directory: v })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave}
            disabled={!formData.name || saving}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}