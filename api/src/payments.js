'use strict';
/* Saving a company's card, on Stripe's own secure page (Checkout, in setup mode), so card numbers never reach this site.
   Nothing is charged here. All we keep is who they are at Stripe and what to show: the card's brand, last 4 digits and expiry.
   Setting: STRIPE_SECRET_KEY. Without it, createPayments returns null and the console says cards aren't switched on yet. */
const API = 'https://api.stripe.com/v1';

function createPayments({ secretKey, siteUrl, fetchFn = fetch }) {
  if (!secretKey || !siteUrl) return null;
  async function stripe(method, path, fields) {
    const r = await fetchFn(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(fields ? { body: new URLSearchParams(fields) } : {}),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Stripe said ${r.status}: ${String(out.error?.message || '').slice(0, 200)}`);
    return out;
  }
  return {
    /** -> { url: Stripe's page to send them to, customerId } */
    async startSetup({ companyId, companyName, email, customerId }) {
      const customer = customerId || (await stripe('POST', '/customers', { name: companyName, ...(email ? { email } : {}), 'metadata[company]': companyId })).id;
      const page = await stripe('POST', '/checkout/sessions', {
        mode: 'setup', customer, 'payment_method_types[0]': 'card', 'metadata[company]': companyId,
        success_url: `${siteUrl}/console.html?payment={CHECKOUT_SESSION_ID}`, cancel_url: `${siteUrl}/console.html?payment=cancelled`,
      });
      return { url: page.url, customerId: customer };
    },
    /** Asks Stripe itself what happened, as the address they came back on proves nothing. Throws unless this company's card was saved. */
    async finishSetup(sessionId, companyId) {
      const s = await stripe('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=setup_intent.payment_method`);
      if (s.metadata?.company !== companyId) throw new Error('That sign-up is for another company');
      if (s.status !== 'complete' || s.setup_intent?.status !== 'succeeded') throw new Error('The card wasn\'t saved');
      const pm = s.setup_intent.payment_method, card = pm?.card;
      if (!card) throw new Error('Stripe didn\'t say which card');
      return { customerId: s.customer, paymentMethodId: pm.id, brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
    },
  };
}

module.exports = { createPayments };
