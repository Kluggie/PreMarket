import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Shield } from 'lucide-react';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-slate-50 py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <Shield className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Privacy Policy</h1>
          <p className="text-slate-600">Last updated: {new Date().toLocaleDateString()}</p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 prose prose-slate max-w-none">
            <h2>Introduction</h2>
            <p>
              PreMarket ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our pre-qualification platform.
            </p>

            <h2>Information We Collect</h2>
            <h3>Information You Provide</h3>
            <ul>
              <li><strong>Account Information:</strong> Name, email address, professional details</li>
              <li><strong>Profile Information:</strong> Professional title, industry, location, bio</li>
              <li><strong>Proposal Data:</strong> Information submitted in pre-qualification proposals</li>
              <li><strong>Social Links:</strong> Optional social media profiles (with explicit consent for AI evaluation)</li>
              <li><strong>Organization Details:</strong> Company information for business users</li>
            </ul>

            <h3>Automatically Collected Information</h3>
            <ul>
              <li>Device information, IP address, browser type</li>
              <li>Usage data and analytics</li>
              <li>Cookies and similar tracking technologies</li>
            </ul>

            <h2>How We Use Your Information</h2>
            <p>We use collected information to:</p>
            <ul>
              <li>Provide and maintain the PreMarket platform</li>
              <li>Generate AI-powered compatibility evaluations (only with explicit consent)</li>
              <li>Facilitate pre-qualification proposals between parties</li>
              <li>Send service-related communications</li>
              <li>Improve our services and develop new features</li>
              <li>Ensure security and prevent fraud</li>
            </ul>

            <h2>Privacy Controls</h2>
            <p>You have control over your data privacy:</p>
            <ul>
              <li><strong>Privacy Modes:</strong> Choose between Public, Pseudonymous, or Private</li>
              <li><strong>Progressive Reveal:</strong> Control what information is shared at each stage</li>
              <li><strong>Social Links AI Consent:</strong> Explicitly opt-in to AI analysis of social profiles</li>
              <li><strong>Visibility Settings:</strong> Granular control over individual data fields</li>
            </ul>

            <h2>Data Sharing and Disclosure</h2>
            <p>We do not sell your personal information. We may share data:</p>
            <ul>
              <li>With other users as part of the mutual pre-qualification process (according to your privacy settings)</li>
              <li>With AI service providers for evaluation purposes (only with explicit consent)</li>
              <li>To comply with legal obligations</li>
              <li>To protect rights, property, or safety</li>
            </ul>

            <h2>Data Security</h2>
            <p>
              We implement appropriate technical and organizational measures to protect your personal information. However, no method of transmission over the Internet is 100% secure.
            </p>

            <h2>Your Rights</h2>
            <p>Depending on your location, you may have the right to:</p>
            <ul>
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Object to or restrict processing</li>
              <li>Data portability</li>
              <li>Withdraw consent</li>
            </ul>

            <h2>Children's Privacy</h2>
            <p>
              PreMarket is not intended for users under 18 years of age. We do not knowingly collect personal information from children.
            </p>

            <h2>Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.
            </p>

            <h2>Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us through our Contact Us page or email privacy@premarket.com.
            </p>

            <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800 font-medium">
                ⚠️ Important Disclaimer: PreMarket is a pre-qualification information platform only. We do not act as brokers, provide financial advice, or handle transactions. All decisions and agreements are solely between participating parties.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}