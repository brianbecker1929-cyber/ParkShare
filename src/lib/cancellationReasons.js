// Shared labels only. The API derives the actor from authenticated ownership.
export const CANCELLATION_REASONS = Object.freeze({
  driver: [
    {code: 'driver_plans', label: 'Change of plans', payer: 'parkshare'},
    {code: 'driver_wrong_time', label: 'Booked the wrong date or time', payer: 'parkshare'},
    {code: 'driver_access', label: 'Problem with the parking space or access', payer: 'review'},
    {code: 'driver_other', label: 'Other', payer: 'parkshare', explanation: true},
  ],
  host: [
    {code: 'host_unavailable', label: 'Space unavailable', payer: 'host'},
    {code: 'host_blocked', label: 'Driveway or access blocked', payer: 'host'},
    {code: 'host_listing_error', label: 'Listing or schedule incorrect', payer: 'host'},
    {code: 'host_emergency', label: 'Personal emergency', payer: 'host'},
    {code: 'host_other', label: 'Other', payer: 'host', explanation: true},
  ],
  staff: [
    {code: 'staff_error', label: 'ParkShare booking or payment error', payer: 'parkshare', explanation: true},
    {code: 'staff_goodwill', label: 'ParkShare-approved goodwill refund', payer: 'parkshare', explanation: true},
    {code: 'staff_exception', label: 'Exceptional circumstances outside both parties’ control', payer: 'parkshare', explanation: true},
    {code: 'staff_host_fault', label: 'Verified Host failure', payer: 'host', explanation: true},
    {code: 'staff_driver_eligible', label: 'Verified eligible Driver cancellation', payer: 'parkshare', explanation: true},
  ],
});
export const HOST_PARTIAL_REFUND = Object.freeze({code: 'host_partial', label: 'Host voluntary or goodwill partial refund', payer: 'host', explanation: true});
export function isParkShareStaff(user) {
  return user?.app_metadata?.parkshare_staff === true;
}
export function cancellationReasonFor(actor, code, action = 'cancel') {
  if (actor === 'host' && action === 'refund') return code === HOST_PARTIAL_REFUND.code ? HOST_PARTIAL_REFUND : null;
  return (CANCELLATION_REASONS[actor] || []).find(reason => reason.code === code) || null;
}
