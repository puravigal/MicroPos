# Razorpay Standard Checkout — Test Mode

This implementation is deliberately restricted to Razorpay Test Mode. It does not enable paid plans or activate subscriptions.

## Render/backend environment variables

Set the following on the backend service in Render (never in client-side code):

- `RAZORPAY_KEY_ID`: your Razorpay Test Key ID, starting with `rzp_test_`
- `RAZORPAY_KEY_SECRET`: the matching Razorpay Test Key Secret

The server refuses to create orders unless a Test Key ID is configured. Do not paste credentials into GitHub or commit a real `.env` file. The included `server/.env.example` contains placeholders only.

## What the UI does

- The owner sees an **Upgrade** button in the top bar.
- The modal starts a fixed ₹1 / 100-paise INR test order from the backend.
- Razorpay Standard Checkout opens in Test Mode.
- The backend validates the HMAC-SHA256 signature using constant-time comparison, then confirms that the order belongs to the authenticated organization and that the payment belongs to the expected test order.
- A verified test is reported as successful, but **no subscription is activated and no live money is collected**.

## Testing

1. Add the two Razorpay Test credentials to Render's backend environment variables and redeploy the service.
2. Sign in to Puravigal POS as the owner and click **Upgrade**.
3. Click **Pay ₹1 test amount** and use the test payment details from Razorpay's official documentation: https://razorpay.com/docs/payments/payments/test-card-upi-details/
4. Confirm a successful test displays the verified message. Also test checkout dismissal, failed payment, and signature-verification failures.
5. Check Render logs for backend errors. Never use Live API keys with this test-only integration.

## API endpoints

- `POST /api/create-order` — authenticated owner/admin; creates a server-controlled 100-paise INR order.
- `POST /api/verify-payment` — authenticated owner/admin; verifies the Standard Checkout signature and validates the associated Razorpay test order/payment.

The test endpoints intentionally do not write subscription entitlements or mark any organization as a paid subscriber. Plan pricing, persistence, renewal, refunds, and paid-feature enforcement are later work.
