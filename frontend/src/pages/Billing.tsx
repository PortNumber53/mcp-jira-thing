import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import CheckoutForm from '../components/CheckoutForm';
import { useState, useEffect } from 'react';

const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_51RNrRAB6cvhL4KKMOTYhjbmh2RY4ePS6TKbmMcq4Ce0sPAqux7yHGU2Rdh3K1HgjGT1qA1KiOYI6rVI9mERizd3Z00FRjlBT8X';

const stripePromise = stripeKey ? loadStripe(stripeKey).catch(err => {
  console.error('Failed to load Stripe:', err);
  return null;
}) : Promise.resolve(null);

const Billing = () => {
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  useEffect(() => {
    // Check if user has an active subscription
    const storedSubId = localStorage.getItem('stripe_subscription_id');
    if (storedSubId) {
      setSubscriptionId(storedSubId);
    }
  }, []);

  const handleCancelSubscription = async () => {
    if (!subscriptionId) return;

    if (!confirm('Are you sure you want to cancel your subscription? You will retain access until the end of your current billing period.')) {
      return;
    }

    setIsCanceling(true);
    setCancelMessage(null);

    try {
      const response = await fetch('/api/billing/cancel-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          subscriptionId,
        }),
      });

      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        throw new Error('Invalid response from server');
      }

      if (!response.ok) {
        // Handle subscription not found (already canceled)
        if (response.status === 404 && data.code === 'subscription_not_found') {
          setCancelMessage('This subscription has already been canceled. You can clear it from your account.');
          // Clear localStorage since subscription is gone
          localStorage.removeItem('stripe_subscription_id');
          setSubscriptionId(null);
          return;
        }

        throw new Error(data.error || 'Failed to cancel subscription');
      }

      // Handle already canceled subscriptions
      if (data.message && data.message.toLowerCase().includes('already canceled')) {
        setCancelMessage('This subscription has already been canceled. Refreshing...');
        localStorage.removeItem('stripe_subscription_id');
        // Reload page after a brief delay to show the message
        setTimeout(() => {
          window.location.reload();
        }, 1500);
        return;
      }

      // Handle cancel at period end
      if (data.message && data.message.toLowerCase().includes('cancel at the end')) {
        setCancelMessage('Your subscription will be canceled at the end of the current billing period.');
        return;
      }

      setCancelMessage(data.message || 'Subscription canceled successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      setCancelMessage(errorMessage);
      console.error('Cancel subscription error:', error);
    } finally {
      setIsCanceling(false);
    }
  };
  return (
        <div className="billing-page">
      <h2 className="app__section-title">Billing & Payments</h2>
      <p className="app__status" style={{ marginBottom: '24px' }}>
        Manage your subscription and payment methods. All transactions are securely processed through Stripe.
      </p>

      {subscriptionId ? (
        // Show subscription management
        <div>
          <div style={{
            padding: '20px',
            backgroundColor: '#d4edda',
            border: '1px solid #c3e6cb',
            borderRadius: '8px',
            marginBottom: '24px'
          }}>
            <h3 style={{ margin: '0 0 8px 0', color: '#155724' }}>Active Subscription</h3>
            <p style={{ margin: '0 0 16px 0', color: '#155724' }}>
              You have an active Pro Plan subscription ($29/month).
            </p>
            <button
              type="button"
              onClick={handleCancelSubscription}
              disabled={isCanceling}
              style={{
                padding: '8px 16px',
                backgroundColor: isCanceling ? '#ccc' : '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: isCanceling ? 'not-allowed' : 'pointer',
                fontSize: '14px'
              }}
            >
              {isCanceling ? 'Canceling...' : 'Cancel Subscription'}
            </button>
          </div>

          {cancelMessage && (
            <div style={{
              padding: '12px',
              backgroundColor: cancelMessage.includes('already') ? '#fff3cd' : '#cfe2ff',
              border: `1px solid ${cancelMessage.includes('already') ? '#ffc107' : '#b6d4fe'}`,
              borderRadius: '6px',
              marginBottom: '24px',
              color: cancelMessage.includes('already') ? '#856404' : '#084298'
            }}>
              <p style={{ margin: 0 }}>{cancelMessage}</p>
              {cancelMessage.toLowerCase().includes('already') && cancelMessage.toLowerCase().includes('canceled') && (
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('stripe_subscription_id');
                    setSubscriptionId(null);
                    setCancelMessage(null);
                  }}
                  style={{
                    marginTop: '8px',
                    padding: '6px 12px',
                    backgroundColor: '#856404',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  Clear Subscription
                </button>
              )}
            </div>
          )}

          {/* Payment History Placeholder */}
          <div>
            <h3 style={{ fontSize: '18px', marginBottom: '16px' }}>Payment History</h3>
            <div style={{
              padding: '16px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              border: '1px solid #e9ecef',
              textAlign: 'center',
              color: '#6b7280'
            }}>
              <p style={{ margin: 0 }}>Payment history will be displayed here.</p>
              <p style={{ margin: '8px 0 0 0', fontSize: '14px' }}>
                Visit your <a href={`https://dashboard.stripe.com/test/subscriptions/${subscriptionId}`} target="_blank" rel="noopener noreferrer" style={{ color: '#5469d4' }}>Stripe Dashboard</a> to view detailed payment history.
              </p>
            </div>
          </div>
        </div>
      ) : stripeKey ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'start' }}>
          {/* Pricing Information */}
          <div style={{
            padding: '20px',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px',
            border: '1px solid #e9ecef'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', color: '#1a1a1a', fontWeight: 'bold' }}>Pro Plan</h3>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#1a1a1a' }}>
                $29
                <span style={{ fontSize: '16px', fontWeight: 'normal', color: '#6b7280' }}>/month</span>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#374151' }}>
                Includes:
              </h4>
              <ul style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                fontSize: '14px',
                color: '#4b5563'
              }}>
                <li style={{ marginBottom: '8px', paddingLeft: '24px', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0 }}>✓</span>
                  Unlimited Jira instances
                </li>
                <li style={{ marginBottom: '8px', paddingLeft: '24px', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0 }}>✓</span>
                  Multi-tenant support
                </li>
                <li style={{ marginBottom: '8px', paddingLeft: '24px', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0 }}>✓</span>
                  Priority support
                </li>
                <li style={{ marginBottom: '8px', paddingLeft: '24px', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0 }}>✓</span>
                  Advanced MCP features
                </li>
                <li style={{ marginBottom: '8px', paddingLeft: '24px', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0 }}>✓</span>
                  99.9% uptime SLA
                </li>
              </ul>
            </div>

            <p style={{
              fontSize: '12px',
              color: '#6b7280',
              marginTop: '20px',
              paddingTop: '16px',
              borderTop: '1px solid #e5e7eb'
            }}>
              Cancel anytime. No long-term commitments.
            </p>
          </div>

          {/* Payment Form */}
          <div>
            <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px' }}>Payment Details</h3>
            <Elements stripe={stripePromise}>
              <CheckoutForm />
            </Elements>

            <div style={{
              marginTop: '24px',
              padding: '16px',
              backgroundColor: '#eff6ff',
              borderRadius: '6px',
              border: '1px solid #bfdbfe',
              fontSize: '13px',
              color: '#1e40af'
            }}>
              <strong>Test Card Numbers:</strong>
              <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                <li>Success: 4242 4242 4242 4242</li>
                <li>Decline: 4000 0000 0000 0002</li>
              </ul>
              <p style={{ margin: '8px 0 0 0', fontSize: '12px' }}>
                Use any future expiry date and any 3-digit CVC
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          padding: '20px',
          backgroundColor: '#fee2e2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          color: '#991b1b'
        }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>Configuration Error</p>
          <p style={{ margin: 0, fontSize: '14px' }}>
            Stripe publishable key is missing. Please check your .env file and ensure VITE_STRIPE_PUBLISHABLE_KEY is set.
          </p>
        </div>
      )}
    </div>
  );
};

export default Billing;
