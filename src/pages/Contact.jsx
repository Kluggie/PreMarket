import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { contactClient } from '@/api/contactClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2 } from 'lucide-react';

export default function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    organization: '',
    reason: 'support',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async (data) => {
      return contactClient.submit({
        ...data,
        type: 'general',
        status: 'new',
      });
    },
    onSuccess: () => {
      setSubmitted(true);
      setFormData({
        name: '',
        email: '',
        organization: '',
        reason: 'support',
        message: '',
      });
    },
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    submitMutation.mutate(formData);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 py-16 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full mx-4"
        >
          <Card className="border-0 shadow-sm">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Message Sent!</h2>
              <p className="text-slate-600 mb-6">
                Thank you for contacting us. We'll get back to you as soon as possible.
              </p>
              <Button onClick={() => setSubmitted(false)} variant="outline">
                Send Another Message
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Contact Us</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Have a question or need assistance? We're here to help.
          </p>
        </div>

        <div className="max-w-3xl mx-auto">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2 w-full items-center">
              <div className="w-full flex flex-col items-center text-center">
                <CardTitle className="w-full text-center">Send us a message</CardTitle>
                <CardDescription className="w-full max-w-xl mx-auto text-center">
                  Fill out the form below and we'll respond within 24 hours.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      required
                      value={formData.name}
                      onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                      placeholder="Your name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="organization">Organization</Label>
                  <Input
                    id="organization"
                    value={formData.organization}
                    onChange={(event) =>
                      setFormData({ ...formData, organization: event.target.value })
                    }
                    placeholder="Your company (optional)"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reason">Reason for Contact *</Label>
                  <Select
                    value={formData.reason}
                    onValueChange={(value) => setFormData({ ...formData, reason: value })}
                  >
                    <SelectTrigger id="reason">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="support">Support</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="request">Feature Request</SelectItem>
                      <SelectItem value="customer_review">Customer Review</SelectItem>
                      <SelectItem value="complaint">Complaint</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Message *</Label>
                  <Textarea
                    id="message"
                    required
                    value={formData.message}
                    onChange={(event) => setFormData({ ...formData, message: event.target.value })}
                    placeholder="How can we help you?"
                    className="min-h-[150px]"
                  />
                </div>

                {submitMutation.error ? (
                  <p className="text-sm text-red-600">
                    {submitMutation.error.message || 'Unable to send your message right now.'}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  disabled={submitMutation.isPending}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {submitMutation.isPending ? 'Sending...' : 'Send Message'}
                </Button>

                <Card className="border-0 shadow-sm bg-blue-50 mt-4">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-blue-900 mb-2 text-sm">Response Time</h3>
                    <p className="text-xs text-blue-700">
                      We typically respond to all inquiries within 24 hours during business days.
                      For urgent matters, please mention "URGENT" in your message subject.
                    </p>
                  </CardContent>
                </Card>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
