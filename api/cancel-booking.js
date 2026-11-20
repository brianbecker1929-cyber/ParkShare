import {requireUser,stripe,supabaseAdmin} from './_lib.js';
import {createRefundHandler} from './_booking-refund-handler.js';
export {createRefundHandler} from './_booking-refund-handler.js';
export default createRefundHandler({db:supabaseAdmin,payments:stripe,authenticate:requireUser,live:/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '')});
