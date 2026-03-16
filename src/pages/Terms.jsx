import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { FileText } from 'lucide-react';

const LAST_UPDATED = 'February 23, 2026';

const tocItems = [
  { id: 'acceptance', label: 'Acceptance' },
  { id: 'service', label: 'Service Scope' },
  { id: 'disclaimers', label: 'Critical Disclaimers' },
  { id: 'responsibilities', label: 'User Responsibilities' },
  { id: 'accounts', label: 'Accounts and Security' },
  { id: 'ai-evaluations', label: 'AI Evaluations' },
  { id: 'prohibited', label: 'Prohibited Conduct' },
  { id: 'liability', label: 'Liability Limits' },
  { id: 'termination', label: 'Termination' },
  { id: 'changes', label: 'Changes to Terms' },
  { id: 'governing-law', label: 'Governing Law' },
  { id: 'contact', label: 'Contact' },
];

function Section({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-slate-100 pt-8 first:border-0 first:pt-0">
      <h2 className="text-xl font-semibold text-slate-900 mb-3">{title}</h2>
      <div className="space-y-4 text-slate-700 leading-7">{children}</div>
    </section>
  );
}

export default function Terms() {
  return (
    <div className="min-h-screen bg-slate-50 py-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 mb-4">
            <FileText className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">Terms of Service</h1>
          <p className="text-slate-600">Last updated: {LAST_UPDATED}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
          <Card className="border-0 shadow-sm h-fit lg:sticky lg:top-24">
            <CardContent className="p-5">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase mb-3">
                On this page
              </p>
              <nav className="space-y-2">
                {tocItems.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="block text-sm text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 sm:p-8 lg:p-10 space-y-8">
              <Section id="acceptance" title="Acceptance">
                <p>
                  By accessing or using PreMarket, you agree to these Terms of Service. If you do not
                  agree, do not use the platform.
                </p>
              </Section>

              <Section id="service" title="Service Scope">
                <p>
                  PreMarket is a pre-qualification information platform that allows users to exchange
                  structured opportunities, apply visibility controls, and request AI-assisted evaluations.
                </p>
              </Section>

              <Section id="disclaimers" title="Critical Disclaimers">
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <ul className="list-disc pl-5 space-y-2 text-red-900">
                    <li>PreMarket is not a broker, intermediary, or transactional agent.</li>
                    <li>PreMarket does not provide legal, financial, tax, or investment advice.</li>
                    <li>PreMarket does not execute or settle transactions between parties.</li>
                    <li>
                      Compatibility scores and recommendations are informational and must not be treated
                      as guarantees.
                    </li>
                  </ul>
                </div>
              </Section>

              <Section id="responsibilities" title="User Responsibilities">
                <p>You agree to use the service lawfully and responsibly, including by:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>Providing accurate and non-misleading information.</li>
                  <li>Maintaining control and confidentiality of account credentials.</li>
                  <li>Respecting confidentiality and rights of counterparties.</li>
                  <li>Conducting your own diligence before decisions or agreements.</li>
                </ul>
              </Section>

              <Section id="accounts" title="Accounts and Security">
                <p>
                  Certain features require an account. You are responsible for activity under your account
                  and for promptly notifying us of suspected unauthorized use.
                </p>
                <p>
                  Your use of PreMarket is also governed by our{' '}
                  <Link to="/privacy" className="text-blue-600 hover:text-blue-700">
                    Privacy Policy
                  </Link>.
                </p>
              </Section>

              <Section id="ai-evaluations" title="AI Evaluations">
                <p>AI outputs are designed to support pre-qualification workflows, not replace judgment.</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>Outputs may be incomplete, inaccurate, or context-limited.</li>
                  <li>Evaluation results are not promises of fit, performance, or outcomes.</li>
                  <li>Optional social-link analysis requires explicit user consent.</li>
                </ul>
              </Section>

              <Section id="prohibited" title="Prohibited Conduct">
                <p>You may not:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>Access the service through unauthorized automation or scraping.</li>
                  <li>Attempt to bypass security controls or gain unauthorized access.</li>
                  <li>Use the platform for unlawful, abusive, deceptive, or harmful activity.</li>
                  <li>Interfere with platform stability, availability, or integrity.</li>
                </ul>
              </Section>

              <Section id="liability" title="Liability Limits">
                <p>
                  To the maximum extent permitted by law, PreMarket is not liable for user decisions,
                  third-party conduct, or losses resulting from reliance on platform information.
                </p>
                <p className="font-semibold text-slate-900">
                  Our aggregate liability is limited to amounts paid by you for the service in the
                  preceding 12 months.
                </p>
              </Section>

              <Section id="termination" title="Termination">
                <p>
                  We may suspend or terminate access when necessary to protect users, enforce policy,
                  comply with law, or maintain service integrity.
                </p>
              </Section>

              <Section id="changes" title="Changes to Terms">
                <p>
                  We may update these Terms periodically. Continued use after updates are published
                  constitutes acceptance of the revised Terms.
                </p>
              </Section>

              <Section id="governing-law" title="Governing Law">
                <p>
                  These Terms are governed by applicable law, without regard to conflict-of-laws principles.
                </p>
              </Section>

              <Section id="contact" title="Contact">
                <p>
                  Questions regarding these Terms can be sent through our{' '}
                  <Link to="/contact" className="text-blue-600 hover:text-blue-700">
                    Contact page
                  </Link>{' '}
                  or by email at{' '}
                  <a href="mailto:legal@premarket.com" className="text-blue-600 hover:text-blue-700">
                    legal@premarket.com
                  </a>.
                </p>
              </Section>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                By using PreMarket, you confirm that you have read and accepted these Terms and our Privacy
                Policy.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
