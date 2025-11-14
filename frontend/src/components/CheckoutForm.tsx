import React, { useState } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const CheckoutForm = () => {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const cardElement = elements.getElement(CardElement);

      if (!cardElement) {
        throw new Error('Card element not found');
      }

      // Create a payment method
      const { error: stripeError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (stripeError) {
        throw new Error(stripeError.message);
      }

      console.log('Payment method created:', paymentMethod?.id);

      // Send payment method to backend to create subscription
      const response = await fetch('/api/billing/create-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          paymentMethodId: paymentMethod?.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create subscription');
      }

      const { subscriptionId, clientSecret } = await response.json();

      console.log('Subscription created:', subscriptionId);

      // If there's a client secret, confirm the payment
      if (clientSecret) {
        const { error: confirmError } = await stripe.confirmCardPayment(clientSecret);
        if (confirmError) {
          throw new Error(confirmError.message);
        }
      }

      // Store subscription ID in localStorage for subscription management
      localStorage.setItem('stripe_subscription_id', subscriptionId);

      setSuccess(true);

      // Reset form
      cardElement.clear();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      console.error('Payment error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (success) {
    return (
      <div style={{
        padding: '20px',
        backgroundColor: '#d4edda',
        border: '1px solid #c3e6cb',
        borderRadius: '4px',
        color: '#155724'
      }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Subscription Successful!</h3>
        <p style={{ margin: '0 0 20px 0' }}>Thank you for subscribing! Your Pro Plan subscription is now active.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 24px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold'
          }}
        >
          Next
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      <div style={{
        padding: '12px',
        border: '1px solid #ccc',
        borderRadius: '4px',
        backgroundColor: 'white',
        marginBottom: '15px'
      }}>
        <CardElement
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: '#424770',
                fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
                '::placeholder': {
                  color: '#aab7c4',
                },
              },
              invalid: {
                color: '#fa755a',
                iconColor: '#fa755a',
              },
            },
          }}
        />
      </div>

      {error && (
        <div style={{
          padding: '12px',
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '4px',
          color: '#721c24',
          marginBottom: '15px',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || isProcessing}
        style={{
          width: '100%',
          padding: '12px 24px',
          backgroundColor: !stripe || isProcessing ? '#ccc' : '#5469d4',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '16px',
          fontWeight: 'bold',
          cursor: !stripe || isProcessing ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s'
        }}
        onMouseEnter={(e) => {
          if (stripe && !isProcessing) {
            e.currentTarget.style.backgroundColor = '#3c54c4';
          }
        }}
        onMouseLeave={(e) => {
          if (stripe && !isProcessing) {
            e.currentTarget.style.backgroundColor = '#5469d4';
          }
        }}
      >
        {isProcessing ? 'Processing...' : 'Subscribe Now'}
      </button>

      <p style={{
        marginTop: '15px',
        fontSize: '12px',
        color: '#6b7280',
        textAlign: 'center'
      }}>
        Powered by Stripe. Your payment information is secure.
      </p>
    </form>
  );
};

export default CheckoutForm;
