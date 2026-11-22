import {supabaseAdmin,stripe,requireUser,getOrigin} from './_lib.js';
import {buildEmailPayload,sendEmailPayload} from './_email.js';
import {createHostApplicationsHandler} from './_host-applications.js';
export default createHostApplicationsHandler({db:supabaseAdmin,stripe,requireUser,getOrigin,buildEmailPayload,sendEmailPayload,storageUrl:process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL});
