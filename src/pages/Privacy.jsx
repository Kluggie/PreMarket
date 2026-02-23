import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Shield } from 'lucide-react';

const LAST_UPDATED = 'February 23, 2026';

const tocItems = [
  { id: 'overview', label: 'Overview' },
  { id: 'information-collected', label: 'Information We Collect' },
  { id: 'use-of-information', label: 'How We Use Information' },
  { id: 'privacy-controls', label: 'Privacy Controls' },
  { id: 'sharing-disclosure', label: 'Sharing and Disclosure' },
  { id: 'security-retention', label: 'Security and Retention' },
  { id: 'rights', label: 'Your Rights' },
  { id: 'children', label: 'Children' },
  { id: 'policy-updates', label: 'Policy Updates' },
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

export default function Privacy() {
  return (
    <div className="min-h-screen bg-slate-50 py-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <Shield className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">Privacy Policy</h1>
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
              <Section id="overview" title="Overview">
                <p>
                  PreMarket is a pre-qualification information platform. This Privacy Policy explains
                  what data we collect, how we use it, and the controls available to you.
                </p>
                <p>
                  We design product workflows around controlled disclosure. Identity and sensitive
                  proposal details are shared according to your visibility settings and reveal choices.
                </p>
              </Section>

              <Section id="information-collected" title="Information We Collect">
                <p>We collect information you provide directly and technical information collected automatically.</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <span className="font-medium text-slate-900">Account and profile data:</span> name,
                    email address, role, organization details, and profile attributes you choose to add.
                  </li>
                  <li>
                    <span className="font-medium text-slate-900">Proposal data:</span> structured
                    responses, comments, and visibility settings associated with proposals.
                  </li>
                  <li>
                    <span className="font-medium text-slate-900">Optional social links:</span> links
                    only when provided by you, including explicit consent before use in AI analysis.
                  </li>
                  <li>
                    <span className="font-medium text-slate-900">Usage and device data:</span> IP
                    address, browser, device signals, and interaction logs used for reliability and security.
                  </li>
                </ul>
              </Section>

              <Section id="use-of-information" title="How We Use Information">
                <p>We use information to operate and improve PreMarket, including to:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>Provide core account, proposal, directory, and organization features.</li>
                  <li>Generate AI-assisted compatibility evaluations when consent is provided.</li>
                  <li>Deliver service notifications, support responses, and security alerts.</li>
                  <li>Monitor abuse, enforce platform rules, and protect users and systems.</li>
                  <li>Measure product quality and guide feature improvements.</li>
                </ul>
              </Section>

              <Section id="privacy-controls" title="Privacy Controls">
                <p>You retain control over disclosure and evaluation behavior:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>Choose privacy modes such as Public, Pseudonymous, or Private.</li>
                  <li>Set field-level visibility and staged reveal preferences.</li>
                  <li>Provide or revoke consent for optional social-link analysis.</li>
                  <li>Update account and profile details through account settings.</li>
                </ul>
              </Section>

              <Section id="sharing-disclosure" title="Sharing and Disclosure">
                <p>We do not sell your personal information.</p>
                <p>We may disclose data in the following situations:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>To counterparties, according to proposal visibility and reveal decisions.</li>
                  <li>To service providers supporting infrastructure, analytics, and communications.</li>
                  <li>To comply with legal obligations or lawful requests.</li>
                  <li>To protect rights, safety, and platform security.</li>
                </ul>
              </Section>

              <Section id="security-retention" title="Security and Retention">
                <p>
                  We apply administrative, technical, and organizational safeguards designed to protect
                  information in transit and at rest.
                </p>
                <p>
                  Data is retained for as long as necessary to operate the service, satisfy legal obligations,
                  resolve disputes, and enforce agreements.
                </p>
              </Section>

              <Section id="rights" title="Your Rights">
                <p>Depending on applicable law, you may have rights to:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>Access, correct, or delete your personal information.</li>
                  <li>Object to or restrict certain processing activities.</li>
                  <li>Request export of data you provided to us.</li>
                  <li>Withdraw consent where processing is based on consent.</li>
                </ul>
              </Section>

              <Section id="children" title="Children">
                <p>
                  PreMarket is not intended for users under 18 years of age, and we do not knowingly collect
                  personal data from children.
                </p>
              </Section>

              <Section id="policy-updates" title="Policy Updates">
                <p>
                  We may update this Privacy Policy from time to time. When updates are made, we will revise
                  the last updated date on this page.
                </p>
              </Section>

              <Section id="contact" title="Contact">
                <p>
                  Questions about privacy can be sent through our <Link to="/contact" className="text-blue-600 hover:text-blue-700">Contact page</Link> or by email at{' '}
                  <a href="mailto:privacy@premarket.com" className="text-blue-600 hover:text-blue-700">
                    privacy@premarket.com
                  </a>.
                </p>
              </Section>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                PreMarket is an information platform for pre-qualification workflows. We are not a broker,
                advisor, or transaction processor.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
