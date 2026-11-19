// Pure local preview. No API clients, environment secrets, network or sends.
import {buildPaymentAlert} from '../api/_payment-alerts.js';

const config = {environment: 'qa', live: false, from: 'ParkShare <alerts@myparkshare.ca>', to: 'operator@example.invalid'};
for (const kind of ['webhook_processing_failed', 'paid_checkout_needs_review', 'paid_checkout_rejected', 'refund_needs_review', 'refund_retry_required', 'refund_failed']) {
  const alert = buildPaymentAlert(kind, {eventId: 'evt_synthetic_offline', sessionId: 'cs_test_synthetic_offline',
    operationId: '00000000-0000-4000-8000-000000000001', connectedAccountId: 'acct_synthetic_offline',
    refundId: 're_synthetic_offline', bookingId: 1, livemode: false}, config);
  process.stdout.write(JSON.stringify({mode: 'OFFLINE_PREVIEW_NO_SEND', kind, ...alert}) + '\n');
}
