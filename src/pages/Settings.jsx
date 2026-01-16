import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Bell, Lock, Mail, Shield, Trash2, AlertTriangle, LogOut
} from 'lucide-react';

export default function Settings() {
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState({
    email_proposals: true,
    email_evaluations: true,
    email_reveals: true,
    email_marketing: false
  });
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [showActiveSessions, setShowActiveSessions] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  const handleSignOutEverywhere = async () => {
    if (confirm('Are you sure you want to sign out of all devices?')) {
      await base44.auth.logout();
    }
  };

  const handleDeleteAccount = async () => {
    if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
      if (confirm('This will permanently delete all your data. Type DELETE to confirm.')) {
        // In production, this would trigger account deletion
        alert('Account deletion is currently unavailable. Please contact support.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-slate-500 mt-1">Manage your account preferences and security.</p>
        </div>

        <div className="space-y-6">
          {/* Account */}
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

          {/* Notifications */}
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
                  <p className="font-medium">New Proposals</p>
                  <p className="text-sm text-slate-500">Get notified when you receive a proposal.</p>
                </div>
                <Switch 
                  checked={notifications.email_proposals}
                  onCheckedChange={(v) => setNotifications({ ...notifications, email_proposals: v })}
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
                  onCheckedChange={(v) => setNotifications({ ...notifications, email_evaluations: v })}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Reveal Requests</p>
                  <p className="text-sm text-slate-500">Get notified when someone requests a reveal.</p>
                </div>
                <Switch 
                  checked={notifications.email_reveals}
                  onCheckedChange={(v) => setNotifications({ ...notifications, email_reveals: v })}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Marketing Emails</p>
                  <p className="text-sm text-slate-500">Receive product updates and tips.</p>
                </div>
                <Switch 
                  checked={notifications.email_marketing}
                  onCheckedChange={(v) => setNotifications({ ...notifications, email_marketing: v })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Security */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-slate-400" />
                Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Change Password</p>
                  <p className="text-sm text-slate-500">Update your account password.</p>
                </div>
                <Button variant="outline" disabled className="opacity-50">
                  Coming Soon
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Two-Factor Authentication</p>
                  <p className="text-sm text-slate-500">Add an extra layer of security.</p>
                </div>
                <Button variant="outline" disabled className="opacity-50">
                  Coming Soon
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Active Sessions</p>
                  <p className="text-sm text-slate-500">Manage your logged-in devices.</p>
                </div>
                <Button variant="outline" disabled className="opacity-50">
                  Coming Soon
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
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
                  <p className="text-sm text-slate-500">Log out of all devices.</p>
                </div>
                <Button 
                  variant="outline" 
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={handleSignOutEverywhere}
                >
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
                <Button 
                  variant="outline" 
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={handleDeleteAccount}
                >
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