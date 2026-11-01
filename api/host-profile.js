import {requireUser, supabaseAdmin} from './_lib.js';
import {validateHostProfile, hostProfilePayload} from '../src/lib/hostProfile.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({error: 'Method not allowed'});
  }
  let writeAttempted = false;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const owner = await supabaseAdmin.from('profiles').select('id, name, role').eq('id', user.id).maybeSingle();
    if (owner.error) throw owner.error;
    if (owner.data?.id !== user.id || owner.data.role !== 'host') return res.status(403).json({error: 'A Host account is required.'});
    if (req.method === 'GET') return res.status(200).json({profile: hostProfilePayload(owner.data, user)});
    // Never accept identity, role, email, payout or vehicle fields from this editor.
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['name', 'phone'].includes(key))) return res.status(400).json({error: 'Only name and phone number can be changed here.'});
    const validation = validateHostProfile(body);
    if (!validation.valid) return res.status(400).json({error: 'Check the highlighted fields.', errors: validation.errors});
    const {name, phone} = validation.normalised;
    writeAttempted = true;
    const saved = await supabaseAdmin.from('profiles').update({name}).eq('id', user.id).eq('role', 'host').select('id, name, role').maybeSingle();
    if (saved.error || saved.data?.id !== user.id || saved.data.role !== 'host' || saved.data.name !== name) throw new Error('Profile name could not be confirmed');
    // Auth merges these two metadata keys. Do not overwrite cached role/vehicle
    // metadata, change a login phone/email, or touch app_metadata/Stripe identity.
    const auth = await supabaseAdmin.auth.admin.updateUserById(user.id, {user_metadata: {name, phone}});
    const updated = auth.data?.user;
    if (auth.error || updated?.id !== user.id || updated.user_metadata?.name !== name || updated.user_metadata?.phone !== phone) throw new Error('Profile contact details could not be confirmed');
    return res.status(200).json({profile: hostProfilePayload(saved.data, updated)});
  } catch {
    // The two providers are not one transaction. A write failure can leave a
    // partial save; never claim success or retry automatically after uncertainty.
    return res.status(503).json({error: writeAttempted ? "We couldn't confirm your saved profile. Reload the profile to check before saving again." : 'Your Host profile is temporarily unavailable.', saveMayHaveCompleted: writeAttempted});
  }
}
