import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Users, Building2, FileText, Shield, Search, MoreVertical,
  ChevronRight, AlertTriangle, CheckCircle2, Clock, TrendingUp, Mail
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Admin() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  const { data: allUsers = [] } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => base44.entities.User.list('-created_date', 100)
  });

  const { data: organizations = [] } = useQuery({
    queryKey: ['admin', 'organizations'],
    queryFn: () => base44.entities.Organization.list('-created_date', 100)
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['admin', 'templates'],
    queryFn: () => base44.entities.Template.list('-created_date', 100)
  });

  const { data: proposals = [] } = useQuery({
    queryKey: ['admin', 'proposals'],
    queryFn: () => base44.entities.Proposal.list('-created_date', 100)
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => base44.entities.AuditLog.list('-created_date', 50)
  });

  const { data: contactRequests = [] } = useQuery({
    queryKey: ['admin', 'contacts'],
    queryFn: () => base44.entities.ContactRequest.list('-created_date', 100)
  });

  // Check if user is admin
  if (user && user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-50 py-16 flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h2>
            <p className="text-slate-500 mb-6">You don't have permission to access the admin panel.</p>
            <Link to={createPageUrl('Dashboard')}>
              <Button>Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const publishedTemplates = templates.filter(t => t.status === 'published');
  
  const stats = [
    { label: 'Total Users', value: allUsers.length, icon: Users, color: 'from-blue-500 to-blue-600' },
    { label: 'Organizations', value: organizations.length, icon: Building2, color: 'from-indigo-500 to-indigo-600' },
    { label: 'Published Templates', value: publishedTemplates.length, icon: FileText, color: 'from-purple-500 to-purple-600' },
    { label: 'Total Proposals', value: proposals.length, icon: TrendingUp, color: 'from-green-500 to-green-600' }
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>
          <p className="text-slate-500 mt-1">Manage users, organizations, and platform settings.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="border-0 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-500">{stat.label}</p>
                      <p className="text-3xl font-bold text-slate-900 mt-1">{stat.value}</p>
                    </div>
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                      <stat.icon className="w-5 h-5 text-white" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200 p-1 mb-6">
            <TabsTrigger value="overview" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              Overview
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Users className="w-4 h-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="organizations" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Building2 className="w-4 h-4 mr-2" />
              Organizations
            </TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="contacts" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Mail className="w-4 h-4 mr-2" />
              Contacts ({contactRequests.length})
            </TabsTrigger>
            <TabsTrigger value="audit" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Shield className="w-4 h-4 mr-2" />
              Audit Log
            </TabsTrigger>
            <TabsTrigger value="dedupe" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Template Dedupe
            </TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Recent Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {allUsers.slice(0, 5).map(u => (
                      <div key={u.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-sm font-medium text-blue-600">
                              {u.full_name?.charAt(0) || u.email?.charAt(0)?.toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-sm">{u.full_name || 'No name'}</p>
                            <p className="text-xs text-slate-500">{u.email}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {u.role || 'user'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Recent Proposals</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {proposals.slice(0, 5).map(p => (
                      <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div>
                          <p className="font-medium text-sm">{p.title || 'Untitled'}</p>
                          <p className="text-xs text-slate-500">{p.template_name}</p>
                        </div>
                        <Badge className={
                          p.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                          p.status === 'mutual_interest' ? 'bg-green-100 text-green-700' :
                          'bg-slate-100 text-slate-700'
                        }>
                          {p.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Users */}
          <TabsContent value="users">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>All Users</CardTitle>
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input placeholder="Search users..." className="pl-10" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allUsers.map(u => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                              {u.full_name?.charAt(0) || '?'}
                            </div>
                            <span className="font-medium">{u.full_name || 'No name'}</span>
                          </div>
                        </TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{u.role || 'user'}</Badge>
                        </TableCell>
                        <TableCell className="text-slate-500">
                          {new Date(u.created_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>View Profile</DropdownMenuItem>
                              <DropdownMenuItem>Edit Role</DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600">Suspend</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Organizations */}
          <TabsContent value="organizations">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>All Organizations</CardTitle>
              </CardHeader>
              <CardContent>
                {organizations.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">No organizations yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Industry</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {organizations.map(org => (
                        <TableRow key={org.id}>
                          <TableCell className="font-medium">{org.name}</TableCell>
                          <TableCell className="capitalize">{org.type?.replace('_', ' ')}</TableCell>
                          <TableCell>{org.industry || '-'}</TableCell>
                          <TableCell>
                            <Badge className={
                              org.verification_status === 'verified' 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-slate-100 text-slate-700'
                            }>
                              {org.verification_status || 'unverified'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-500">
                            {new Date(org.created_date).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Templates */}
          <TabsContent value="templates">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Template Management</CardTitle>
                  <Button>
                    <FileText className="w-4 h-4 mr-2" />
                    Create Template
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {templates.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">No custom templates yet. Default templates are available.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Template</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templates.map(t => (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.name}</TableCell>
                          <TableCell className="capitalize">{t.category?.replace('_', ' ')}</TableCell>
                          <TableCell>
                            <Badge className={
                              t.status === 'active' ? 'bg-green-100 text-green-700' :
                              t.status === 'coming_soon' ? 'bg-amber-100 text-amber-700' :
                              'bg-slate-100 text-slate-700'
                            }>
                              {t.status}
                            </Badge>
                          </TableCell>
                          <TableCell>v{t.version || 1}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm">Edit</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contact Requests */}
          <TabsContent value="contacts">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Contact Requests</CardTitle>
                <CardDescription>All user inquiries and sales requests.</CardDescription>
              </CardHeader>
              <CardContent>
                {contactRequests.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">No contact requests yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contactRequests.map(req => (
                        <TableRow key={req.id}>
                          <TableCell className="font-medium">{req.name || '-'}</TableCell>
                          <TableCell>{req.email}</TableCell>
                          <TableCell className="capitalize">{req.reason?.replace('_', ' ')}</TableCell>
                          <TableCell>
                            <Badge className={
                              req.type === 'sales' 
                                ? 'bg-purple-100 text-purple-700' 
                                : 'bg-blue-100 text-blue-700'
                            }>
                              {req.type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={
                              req.status === 'resolved' ? 'bg-green-100 text-green-700' :
                              req.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                              'bg-slate-100 text-slate-700'
                            }>
                              {req.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-500">
                            {new Date(req.created_date).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit Log */}
          <TabsContent value="audit">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Audit Log</CardTitle>
                <CardDescription>Track all platform activity for compliance and security.</CardDescription>
              </CardHeader>
              <CardContent>
                {auditLogs.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">No audit logs recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {auditLogs.map(log => (
                      <div key={log.id} className="flex items-start gap-4 p-4 bg-slate-50 rounded-lg">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                          <Shield className="w-4 h-4 text-slate-600" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">
                            {log.action} on {log.entity_type}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(log.created_date).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Template Dedupe */}
          <TabsContent value="dedupe">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Template Deduplication</CardTitle>
                <CardDescription>
                  Manage duplicate templates and fix rendering issues.
                  <Link to={createPageUrl('TemplateDedupe')} className="ml-4 text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
                    Open Full Page
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-slate-600 mb-4">
                  The Template Dedupe tool helps you identify and resolve duplicate templates based on question counts.
                  Click "Open Full Page" above to access the full deduplication interface.
                </p>
                <Link to={createPageUrl('TemplateDedupe')}>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <FileText className="w-4 h-4 mr-2" />
                    Go to Template Dedupe
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}