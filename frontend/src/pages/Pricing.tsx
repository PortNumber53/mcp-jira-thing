import { Link } from 'react-router-dom';

const Pricing = () => {
  return (
    <div className="card card--center">
      <h1 style={{ marginTop: 0, fontSize: '2.5rem' }}>Simple, Transparent Pricing</h1>
      <p style={{ color: 'var(--app-muted-color)', marginBottom: '3rem', maxWidth: '600px' }}>
        Access your multi-tenant Jira instances through MCP with a single affordable plan.
      </p>

      <div className="pricing-card">
        <div className="pricing-card__header">
          <h2 className="pricing-card__title">Pro Plan</h2>
          <div className="pricing-card__price">
            <span className="pricing-card__currency">$</span>
            <span className="pricing-card__amount">29</span>
            <span className="pricing-card__period">/month</span>
          </div>
        </div>

        <div className="pricing-card__features">
          <div className="pricing-card__feature">
            <span className="pricing-card__check">✓</span>
            <span>Full MCP server access to your Jira instances</span>
          </div>
          <div className="pricing-card__feature">
            <span className="pricing-card__check">✓</span>
            <span>Multi-tenant support for unlimited Jira workspaces</span>
          </div>
          <div className="pricing-card__feature">
            <span className="pricing-card__check">✓</span>
            <span>Secure OAuth authentication with GitHub & Google</span>
          </div>
          <div className="pricing-card__feature">
            <span className="pricing-card__check">✓</span>
            <span>Real-time sync with your Jira data</span>
          </div>
          <div className="pricing-card__feature">
            <span className="pricing-card__check">✓</span>
            <span>Cancel anytime - no long-term commitment</span>
          </div>
        </div>

        <div className="pricing-card__actions">
          <Link to="/billing" className="button button--primary" style={{ fontSize: '1.1rem', padding: '0.75rem 2rem' }}>
            Get Started
          </Link>
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--app-muted-color)', marginTop: '1.5rem' }}>
          No setup fees. Cancel anytime.
        </p>
      </div>

      <div style={{ marginTop: '3rem', maxWidth: '700px' }}>
        <h3 style={{ fontSize: '1.3rem', marginBottom: '1rem' }}>Frequently Asked Questions</h3>

        <div className="faq-item">
          <h4 className="faq-question">What is MCP?</h4>
          <p className="faq-answer">
            MCP (Model Context Protocol) allows AI assistants to connect to external data sources.
            Our service provides MCP server access to your Jira instances, enabling seamless integration
            with AI tools.
          </p>
        </div>

        <div className="faq-item">
          <h4 className="faq-question">How many Jira instances can I connect?</h4>
          <p className="faq-answer">
            You can connect unlimited Jira workspaces with our multi-tenant architecture. Perfect for
            agencies, consultants, and teams managing multiple Jira instances.
          </p>
        </div>

        <div className="faq-item">
          <h4 className="faq-question">Can I cancel anytime?</h4>
          <p className="faq-answer">
            Yes! You can cancel your subscription at any time from the Billing page. You'll retain
            access until the end of your current billing period.
          </p>
        </div>

        <div className="faq-item">
          <h4 className="faq-question">Is my data secure?</h4>
          <p className="faq-answer">
            Absolutely. We use industry-standard OAuth authentication and never store your Jira passwords.
            Read our <Link to="/privacy" style={{ color: 'var(--app-accent-color)', textDecoration: 'underline' }}>Privacy Policy</Link> for details.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
