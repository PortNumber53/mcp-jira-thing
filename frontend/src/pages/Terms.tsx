const Terms = () => {
  return (
    <div className="card legal-page">
      <h1 style={{ marginTop: 0, fontSize: '2.5rem' }}>Terms of Service</h1>
      <p style={{ color: 'var(--app-muted-color)', marginBottom: '2rem' }}>
        Last updated: November 14, 2025
      </p>

      <div className="legal-content">
        <section className="legal-section">
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing and using MCP Jira Thing ("the Service"), you accept and agree to be bound by
            the terms and provisions of this agreement. If you do not agree to these Terms of Service,
            please do not use the Service.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Description of Service</h2>
          <p>
            MCP Jira Thing provides MCP (Model Context Protocol) server access to your Jira instances,
            enabling integration with AI tools and assistants. The Service allows you to:
          </p>
          <ul>
            <li>Connect multiple Jira workspaces through a multi-tenant architecture</li>
            <li>Authenticate securely via OAuth (GitHub and Google)</li>
            <li>Access your Jira data through the MCP protocol</li>
            <li>Manage your account and subscription settings</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. Account Registration</h2>
          <p>
            To use the Service, you must create an account by authenticating with GitHub or Google.
            You are responsible for:
          </p>
          <ul>
            <li>Maintaining the security of your account credentials</li>
            <li>All activities that occur under your account</li>
            <li>Notifying us immediately of any unauthorized use</li>
            <li>Providing accurate and complete information</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. Subscription and Payment</h2>
          <p>
            The Service is provided on a subscription basis at $29 per month. By subscribing, you agree to:
          </p>
          <ul>
            <li>Pay all fees associated with your subscription</li>
            <li>Provide accurate billing information</li>
            <li>Authorize automatic recurring payments</li>
            <li>The billing cycle starting from your subscription date</li>
          </ul>
          <p>
            You may cancel your subscription at any time. Upon cancellation, you will retain access
            until the end of your current billing period. No refunds will be provided for partial months.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Acceptable Use</h2>
          <p>
            You agree not to use the Service to:
          </p>
          <ul>
            <li>Violate any laws or regulations</li>
            <li>Infringe on intellectual property rights</li>
            <li>Transmit malicious code or viruses</li>
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Interfere with or disrupt the Service</li>
            <li>Use the Service for any illegal or unauthorized purpose</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>6. Data and Privacy</h2>
          <p>
            We take your privacy seriously. Our collection, use, and protection of your personal
            information is governed by our Privacy Policy. By using the Service, you consent to
            the collection and use of your information as described in the Privacy Policy.
          </p>
          <p>
            You retain all rights to your Jira data. We do not claim ownership of any content or
            data you access through the Service.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Service Availability</h2>
          <p>
            We strive to maintain high availability but do not guarantee uninterrupted access. The
            Service may be temporarily unavailable due to:
          </p>
          <ul>
            <li>Scheduled maintenance</li>
            <li>Technical issues or emergencies</li>
            <li>Factors beyond our control</li>
          </ul>
          <p>
            We are not liable for any loss or damage resulting from Service unavailability.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Termination</h2>
          <p>
            We reserve the right to suspend or terminate your account if you:
          </p>
          <ul>
            <li>Violate these Terms of Service</li>
            <li>Engage in fraudulent or illegal activities</li>
            <li>Fail to pay subscription fees</li>
            <li>Abuse or misuse the Service</li>
          </ul>
          <p>
            You may terminate your account at any time through the account deletion feature in Settings.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, MCP Jira Thing shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages, or any loss of profits or revenues,
            whether incurred directly or indirectly, or any loss of data, use, goodwill, or other
            intangible losses resulting from:
          </p>
          <ul>
            <li>Your use or inability to use the Service</li>
            <li>Any unauthorized access to or use of our servers</li>
            <li>Any interruption or cessation of the Service</li>
            <li>Any bugs, viruses, or other harmful code</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>10. Disclaimer of Warranties</h2>
          <p>
            The Service is provided "as is" and "as available" without warranties of any kind, either
            express or implied, including but not limited to implied warranties of merchantability,
            fitness for a particular purpose, or non-infringement.
          </p>
        </section>

        <section className="legal-section">
          <h2>11. Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms of Service at any time. We will notify users
            of material changes via email or through the Service. Your continued use of the Service
            after changes constitutes acceptance of the modified terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>12. Third-Party Services</h2>
          <p>
            The Service integrates with third-party services including:
          </p>
          <ul>
            <li>Jira (Atlassian)</li>
            <li>GitHub OAuth</li>
            <li>Google OAuth</li>
            <li>Stripe (payment processing)</li>
          </ul>
          <p>
            Your use of these third-party services is subject to their respective terms and policies.
            We are not responsible for the actions or policies of third-party services.
          </p>
        </section>

        <section className="legal-section">
          <h2>13. Governing Law</h2>
          <p>
            These Terms of Service shall be governed by and construed in accordance with the laws
            of the jurisdiction in which we operate, without regard to its conflict of law provisions.
          </p>
        </section>

        <section className="legal-section">
          <h2>14. Contact Information</h2>
          <p>
            If you have any questions about these Terms of Service, please contact us through our
            support channels.
          </p>
        </section>
      </div>
    </div>
  );
};

export default Terms;
