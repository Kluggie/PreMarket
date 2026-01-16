import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FileText } from 'lucide-react';

export default function Terms() {
  return (
    <div className="min-h-screen bg-slate-50 py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 mb-4">
            <FileText className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Terms of Service</h1>
          <p className="text-slate-600">Last updated: {new Date().toLocaleDateString()}</p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 prose prose-slate max-w-none">
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing or using PreMarket, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our platform.
            </p>

            <h2>2. Description of Service</h2>
            <p>
              PreMarket is a pre-qualification information platform that enables parties to:
            </p>
            <ul>
              <li>Create structured pre-qualification proposals</li>
              <li>Exchange information with privacy controls</li>
              <li>Receive AI-powered compatibility evaluations</li>
              <li>Manage progressive identity reveal</li>
            </ul>

            <div className="p-4 bg-red-50 border border-red-200 rounded-lg my-6">
              <h3 className="mt-0 text-red-900">CRITICAL DISCLAIMERS</h3>
              <ul className="mb-0">
                <li><strong>No Brokerage Services:</strong> PreMarket does not act as a broker, intermediary, or agent in any transaction</li>
                <li><strong>No Financial Advice:</strong> We do not provide investment, financial, or legal advice</li>
                <li><strong>No Transaction Handling:</strong> We do not facilitate, process, or handle any financial transactions</li>
                <li><strong>Information Only:</strong> All evaluations and recommendations are informational only</li>
              </ul>
            </div>

            <h2>3. User Responsibilities</h2>
            <p>You agree to:</p>
            <ul>
              <li>Provide accurate and truthful information</li>
              <li>Maintain the security of your account</li>
              <li>Comply with all applicable laws and regulations</li>
              <li>Not use the platform for illegal purposes</li>
              <li>Not misrepresent your identity or intentions</li>
              <li>Conduct your own due diligence on all parties and proposals</li>
            </ul>

            <h2>4. Account Registration</h2>
            <p>
              To access certain features, you must register for an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account.
            </p>

            <h2>5. Privacy and Data Protection</h2>
            <p>
              Your use of PreMarket is subject to our Privacy Policy. You acknowledge that:
            </p>
            <ul>
              <li>Information shared in proposals may be visible to counterparties</li>
              <li>AI evaluations require your explicit consent</li>
              <li>You control privacy settings and reveal gates</li>
              <li>We implement security measures but cannot guarantee absolute security</li>
            </ul>

            <h2>6. AI Evaluations</h2>
            <p>
              AI-powered evaluations are provided for informational purposes only. They:
            </p>
            <ul>
              <li>Are not guarantees of compatibility or success</li>
              <li>Should not be solely relied upon for decision-making</li>
              <li>May contain errors or limitations</li>
              <li>Require your explicit consent for social profile analysis</li>
            </ul>

            <h2>7. Intellectual Property</h2>
            <p>
              All content, features, and functionality of PreMarket are owned by us and protected by intellectual property laws. You may not copy, modify, or distribute our platform without permission.
            </p>

            <h2>8. Prohibited Activities</h2>
            <p>You may not:</p>
            <ul>
              <li>Use automated systems to access the platform</li>
              <li>Interfere with or disrupt the platform</li>
              <li>Attempt to gain unauthorized access</li>
              <li>Use the platform to spam or harass others</li>
              <li>Violate any applicable laws or regulations</li>
            </ul>

            <h2>9. Limitation of Liability</h2>
            <p>
              PreMarket and its operators shall not be liable for:
            </p>
            <ul>
              <li>Any decisions made based on platform information</li>
              <li>Losses resulting from proposal interactions</li>
              <li>Accuracy of user-provided information</li>
              <li>Results of AI evaluations</li>
              <li>Actions or conduct of other users</li>
            </ul>
            <p>
              <strong>TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY YOU FOR THE SERVICE IN THE PAST 12 MONTHS.</strong>
            </p>

            <h2>10. Indemnification</h2>
            <p>
              You agree to indemnify and hold PreMarket harmless from any claims, damages, or expenses arising from your use of the platform or violation of these terms.
            </p>

            <h2>11. Termination</h2>
            <p>
              We may suspend or terminate your access to PreMarket at any time, with or without cause. You may terminate your account at any time through your settings.
            </p>

            <h2>12. Changes to Terms</h2>
            <p>
              We reserve the right to modify these Terms of Service at any time. Continued use of the platform after changes constitutes acceptance of the new terms.
            </p>

            <h2>13. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law provisions.
            </p>

            <h2>14. Contact Information</h2>
            <p>
              For questions about these Terms of Service, please contact us through our Contact Us page or email legal@premarket.com.
            </p>

            <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 mb-0">
                By using PreMarket, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service and our Privacy Policy.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}