const Privacy = () => {
  return (
    <div className="card legal-page">
      <h1 style={{ marginTop: 0, fontSize: '2.5rem' }}>Privacy Policy</h1>
      <p style={{ color: 'var(--app-muted-color)', marginBottom: '2rem' }}>
        Last updated: November 14, 2025
      </p>

      <div className="legal-content">
        <section className="legal-section">
          <h2>1. Introduction</h2>
          <p>
            MCP Jira Thing ("we", "our", or "us") is committed to protecting your privacy. This Privacy
            Policy explains how we collect, use, disclose, and safeguard your information when you use
            our Service.
          </p>
          <p>
            Please read this Privacy Policy carefully. By using the Service, you agree to the collection
            and use of information in accordance with this policy.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Information We Collect</h2>

          <h3>2.1 Information You Provide</h3>
          <p>We collect information that you voluntarily provide when using our Service:</p>
          <ul>
            <li><strong>Account Information:</strong> Name, email address, and profile information from GitHub or Google OAuth</li>
            <li><strong>Jira Configuration:</strong> Jira instance URLs, Jira email addresses, and API credentials</li>
            <li><strong>Billing Information:</strong> Payment details processed securely through Stripe (we do not store credit card numbers)</li>
          </ul>

          <h3>2.2 Automatically Collected Information</h3>
          <p>We automatically collect certain information when you use the Service:</p>
          <ul>
            <li><strong>Usage Data:</strong> API requests, timestamps, and usage patterns</li>
            <li><strong>Device Information:</strong> Browser type, operating system, and device identifiers</li>
            <li><strong>Log Data:</strong> IP addresses, access times, and pages viewed</li>
            <li><strong>Cookies:</strong> Session cookies for authentication and preference storage</li>
          </ul>

          <h3>2.3 Third-Party Data</h3>
          <p>We receive information from third-party services you connect:</p>
          <ul>
            <li><strong>OAuth Providers:</strong> Profile information from GitHub and Google</li>
            <li><strong>Jira:</strong> Access to your Jira data through API credentials you provide</li>
            <li><strong>Stripe:</strong> Payment transaction information</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. How We Use Your Information</h2>
          <p>We use the collected information for the following purposes:</p>
          <ul>
            <li><strong>Service Delivery:</strong> To provide MCP server access to your Jira instances</li>
            <li><strong>Account Management:</strong> To create, maintain, and secure your account</li>
            <li><strong>Billing:</strong> To process payments and manage subscriptions</li>
            <li><strong>Communication:</strong> To send service-related notifications and updates</li>
            <li><strong>Improvement:</strong> To analyze usage patterns and improve the Service</li>
            <li><strong>Security:</strong> To detect, prevent, and address technical issues and fraud</li>
            <li><strong>Legal Compliance:</strong> To comply with legal obligations and enforce our terms</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. Data Storage and Security</h2>

          <h3>4.1 Data Storage</h3>
          <p>
            Your data is stored securely using industry-standard practices:
          </p>
          <ul>
            <li>Encrypted databases for sensitive information</li>
            <li>Secure cloud infrastructure with regular backups</li>
            <li>Access controls and authentication mechanisms</li>
          </ul>

          <h3>4.2 Security Measures</h3>
          <p>
            We implement appropriate technical and organizational measures to protect your data:
          </p>
          <ul>
            <li>HTTPS/TLS encryption for data in transit</li>
            <li>Encryption at rest for sensitive data</li>
            <li>Regular security audits and updates</li>
            <li>Restricted access to personal information</li>
            <li>OAuth-based authentication (we never store your Jira passwords)</li>
          </ul>

          <h3>4.3 Data Retention</h3>
          <p>
            We retain your information for as long as your account is active or as needed to provide
            the Service. When you delete your account, we permanently remove:
          </p>
          <ul>
            <li>All personal information</li>
            <li>Jira configuration and API credentials</li>
            <li>OAuth connections</li>
            <li>Usage logs and request history</li>
            <li>Payment history (except as required for legal/tax purposes)</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>5. Information Sharing and Disclosure</h2>
          <p>
            We do not sell, trade, or rent your personal information. We may share information only in
            the following circumstances:
          </p>
          <ul>
            <li>
              <strong>Service Providers:</strong> With trusted third parties who assist in operating
              the Service (Stripe for payments, hosting providers, etc.)
            </li>
            <li>
              <strong>Legal Requirements:</strong> When required by law, subpoena, or other legal process
            </li>
            <li>
              <strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale
              of assets (users would be notified)
            </li>
            <li>
              <strong>With Your Consent:</strong> When you explicitly authorize us to share information
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>6. Third-Party Services</h2>
          <p>
            The Service integrates with third-party platforms. Each has its own privacy policy:
          </p>
          <ul>
            <li><strong>Jira (Atlassian):</strong> We access your Jira data using credentials you provide</li>
            <li><strong>GitHub OAuth:</strong> For authentication - see GitHub's Privacy Policy</li>
            <li><strong>Google OAuth:</strong> For authentication - see Google's Privacy Policy</li>
            <li><strong>Stripe:</strong> For payment processing - see Stripe's Privacy Policy</li>
          </ul>
          <p>
            We are not responsible for the privacy practices of these third-party services.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Cookies and Tracking</h2>
          <p>
            We use cookies and similar tracking technologies:
          </p>
          <ul>
            <li><strong>Session Cookies:</strong> Required for authentication and service functionality</li>
            <li><strong>Preference Cookies:</strong> To remember your settings and preferences</li>
            <li><strong>Security Cookies:</strong> To detect and prevent security threats</li>
          </ul>
          <p>
            You can control cookie settings through your browser, but disabling cookies may affect
            Service functionality.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Your Rights and Choices</h2>
          <p>
            You have the following rights regarding your personal information:
          </p>
          <ul>
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Correction:</strong> Update or correct inaccurate information through Settings</li>
            <li><strong>Deletion:</strong> Delete your account and all associated data</li>
            <li><strong>Export:</strong> Request a machine-readable copy of your data</li>
            <li><strong>Opt-Out:</strong> Unsubscribe from marketing communications</li>
            <li><strong>Objection:</strong> Object to certain data processing activities</li>
          </ul>
          <p>
            To exercise these rights, contact us through our support channels or use the account
            management features in Settings.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. Children's Privacy</h2>
          <p>
            The Service is not intended for users under the age of 18. We do not knowingly collect
            personal information from children. If you believe we have collected information from a
            child, please contact us immediately.
          </p>
        </section>

        <section className="legal-section">
          <h2>10. International Data Transfers</h2>
          <p>
            Your information may be transferred to and processed in countries other than your country
            of residence. These countries may have different data protection laws. By using the Service,
            you consent to such transfers.
          </p>
        </section>

        <section className="legal-section">
          <h2>11. Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material changes by:
          </p>
          <ul>
            <li>Posting the updated policy on this page</li>
            <li>Updating the "Last updated" date</li>
            <li>Sending an email notification for significant changes</li>
          </ul>
          <p>
            Your continued use of the Service after changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <section className="legal-section">
          <h2>12. Contact Us</h2>
          <p>
            If you have questions or concerns about this Privacy Policy or our data practices, please
            contact us through our support channels. We will respond to all requests within a reasonable
            timeframe.
          </p>
        </section>

        <section className="legal-section">
          <h2>13. Data Protection Officer</h2>
          <p>
            For questions specifically related to data protection and privacy compliance, you may
            contact our Data Protection Officer through our support channels.
          </p>
        </section>
      </div>
    </div>
  );
};

export default Privacy;
