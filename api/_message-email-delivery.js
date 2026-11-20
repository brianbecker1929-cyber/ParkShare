import {createHash} from 'node:crypto';
import {buildEmailPayload, sendEmailPayload, messageNotificationHtml} from './_email.js';

class UnsafeMessage extends Error {}
const checked = (result, step) => {
  if (result.error) throw new Error(`Message notification ${step} failed`);
  return result.data;
};
const safeEmail = value => typeof value === 'string' && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);

async function recipientFor(db, messageId) {
  const message = checked(await db.from('messages').select('id,listing_id,booking_id,sender_id,recipient_id')
    .eq('id', messageId).maybeSingle(), 'message lookup');
  if (!message || !message.sender_id || !message.recipient_id || message.sender_id === message.recipient_id) throw new UnsafeMessage();
  const listing = checked(await db.from('listings').select('id,host_id').eq('id', message.listing_id).maybeSingle(), 'listing lookup');
  if (!listing?.host_id) throw new UnsafeMessage();
  if (message.booking_id != null) {
    const booking = checked(await db.from('bookings').select('listing_id,renter_id').eq('id', message.booking_id).maybeSingle(), 'booking lookup');
    if (!booking || booking.listing_id !== message.listing_id
        || !((message.sender_id === listing.host_id && message.recipient_id === booking.renter_id)
          || (message.sender_id === booking.renter_id && message.recipient_id === listing.host_id))) throw new UnsafeMessage();
  } else if (message.recipient_id !== listing.host_id) {
    if (message.sender_id !== listing.host_id) throw new UnsafeMessage();
    const incoming = checked(await db.from('messages').select('id').eq('listing_id', message.listing_id)
      .eq('sender_id', message.recipient_id).eq('recipient_id', listing.host_id).limit(1), 'conversation lookup');
    if (!incoming?.length) throw new UnsafeMessage();
  }
  const recipient = checked(await db.from('profiles').select('email').eq('id', message.recipient_id).maybeSingle(), 'recipient lookup');
  const email = recipient?.email?.trim();
  if (!safeEmail(email)) throw new UnsafeMessage();
  return {email, bookingId: message.booking_id};
}

export async function processMessageEmail(db, queued, {now = new Date(), send = sendEmailPayload} = {}) {
  const table = () => db.from('message_email_deliveries');
  const job = checked(await table().update({lease_until: new Date(now.getTime() + 120_000).toISOString()})
    .eq('message_id', queued.message_id).is('sent_at', null).is('blocked_at', null).lte('lease_until', now.toISOString())
    .select('message_id,created_at,payload,first_attempt_at').maybeSingle(), 'claim');
  if (!job) return 'busy';
  const block = async reason => {
    checked(await table().update({blocked_at: now.toISOString(), blocked_reason: reason}).eq('message_id', job.message_id), 'suppression');
    return 'blocked';
  };
  // Do not send stale conversations or outlive Resend's 24-hour key cache.
  if (!Number.isFinite(Date.parse(job.created_at)) || now.getTime() - Date.parse(job.created_at) >= 23 * 3600_000) return block('stale');
  let recipient;
  try { recipient = await recipientFor(db, job.message_id); }
  catch (error) { if (error instanceof UnsafeMessage) return block('participant'); throw error; }
  if (!job.payload) {
    const payload = buildEmailPayload({to: recipient.email, subject: 'New ParkShare message', html: messageNotificationHtml(recipient)});
    checked(await table().update({payload, first_attempt_at: now.toISOString()}).eq('message_id', job.message_id).is('payload', null), 'snapshot');
    Object.assign(job, checked(await table().select('payload,first_attempt_at').eq('message_id', job.message_id).single(), 'saved snapshot'));
  }
  const payload = job.payload;
  const populated = value => Array.isArray(value) ? value.length > 0 : Boolean(value);
  if (!Number.isFinite(Date.parse(job.first_attempt_at)) || now.getTime() - Date.parse(job.first_attempt_at) >= 23 * 3600_000
      || !Array.isArray(payload?.to) || payload.to.length !== 1 || payload.to[0] !== recipient.email
      || populated(payload.cc) || populated(payload.bcc) || populated(payload.reply_to)) return block('snapshot');
  const scope = createHash('sha256').update(`${process.env.SUPABASE_URL}|${job.message_id}`).digest('hex');
  let accepted;
  try { accepted = await send(payload, {idempotencyKey: `parkshare-message-${scope}`}); }
  catch (error) {
    const status = Number(error?.message?.match(/Resend API error \((\d+)\)/)?.[1]);
    if (status >= 400 && status < 500 && status !== 429) return block('provider_4xx');
    throw error;
  }
  if (!accepted?.id || accepted.skipped) throw new Error('Message notification was not accepted');
  checked(await table().update({provider_id: accepted.id, sent_at: now.toISOString()}).eq('message_id', job.message_id), 'acceptance marker');
  return 'accepted';
}

export async function processMessageNotifications(db, {now = new Date(), deadline = Date.now() + 100_000, send = sendEmailPayload} = {}) {
  const jobs = checked(await db.from('message_email_deliveries').select('message_id').is('sent_at', null).is('blocked_at', null)
    .lte('lease_until', now.toISOString()).order('message_id').limit(5), 'pending lookup');
  const result = {accepted: 0, failed: 0, blocked: 0};
  for (const job of jobs || []) {
    if (Date.now() >= deadline) break;
    try {
      const outcome = await processMessageEmail(db, job, {now, send});
      if (outcome === 'accepted') result.accepted++;
      if (outcome === 'blocked') result.blocked++;
    } catch {
      console.error('message-notifications: delivery failed for message', job.message_id);
      result.failed++;
    }
  }
  return result;
}
