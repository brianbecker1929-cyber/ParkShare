// One immutable account/conversation context. Disposing stops reads and UI
// callbacks; an already-submitted POST may still complete on the server.
export function messageConversationKey(userId, listing) {
  return JSON.stringify([userId || null, listing?.id, listing?.bookingId || null, listing?.participantId || null]);
}

function confirmsMessage(data,{userId,listingId,bookingId,participantId,text}) {
  const message=data?.message;
  const positiveId=value=>(typeof value==='number'||typeof value==='string')
    && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
  return message && positiveId(message.id) && positiveId(message.listing_id)
    && String(message.listing_id)===String(listingId)
    && (bookingId==null ? message.booking_id===null
      : positiveId(message.booking_id) && String(message.booking_id)===String(bookingId))
    && message.sender_id===userId && typeof message.recipient_id==='string'
    && Boolean(message.recipient_id.trim()) && message.recipient_id!==userId
    && (!participantId || message.recipient_id===participantId) && message.text===text;
}

export function createMessageConversation({client,userId,listingId,bookingId=null,participantId=null,
  fetcher=fetch,onMessages=()=>{},onError=()=>{},onSending=()=>{}}) {
  let active=true,read=null,sending=false;
  async function sessionToken(){
    if(!userId)throw new Error('Please sign in to view or send messages.');
    const result=await client.auth.getSession();
    if(!active)return null;
    const session=result.data?.session;
    if(result.error || !session?.access_token || session.user?.id!==userId)throw new Error('Your account changed. Reopen the conversation after signing in.');
    return session.access_token;
  }
  async function load(){
    if(!active)return;
    read?.abort();const controller=new AbortController();read=controller;
    const current=()=>active && read===controller && !controller.signal.aborted;
    try{
      const token=await sessionToken();if(!current() || !token)return;
      const params=new URLSearchParams({listingId:String(listingId)});
      if(bookingId)params.set('bookingId',String(bookingId));
      if(participantId)params.set('participantId',participantId);
      const response=await fetcher('/api/messages?'+params,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal});
      const data=await response.json();if(!current())return;
      if(!response.ok)throw new Error(data.error||"Couldn't load messages.");
      if(!Array.isArray(data.messages))throw new Error("Couldn't load messages.");
      onMessages(data.messages);onError('');
    }catch(error){if(current())onError(error.message||"Couldn't load messages.");}
  }
  return {
    load,
    get sending(){return sending;},
    async send(value){
      const text=String(value||'').trim();
      if(!active || sending || !text)return {sent:false};
      // A read started before this send must not later hide its outcome/error.
      read?.abort();read=null;
      if(text.length>4000){
        onError('Messages can be up to 4,000 characters. Shorten your draft before sending.');
        return {sent:false,retryText:text};
      }
      sending=true;onSending(true);onError('');
      let uncertain=false;
      try{
        const token=await sessionToken();if(!active || !token)return {sent:false};
        // Never replay automatically or imply that aborting can unsend a POST.
        uncertain=true;
        const response=await fetcher('/api/messages',{method:'POST',cache:'no-store',
          headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
          body:JSON.stringify({listingId,bookingId,participantId,text})});
        const data=await response.json().catch(()=>({}));if(!active)return {sent:false};
        if(!response.ok){
          uncertain=response.status>=500 || response.status===408;
          throw new Error(data?.error||'Message could not be sent.');
        }
        if(!confirmsMessage(data,{userId,listingId,bookingId,participantId,text})) {
          throw new Error('Missing or mismatching message acknowledgement.');
        }
        uncertain=false;
        await load();return {sent:true};
      }catch(error){
        if(active){
          onError(uncertain
            ? "We couldn't confirm whether your message was sent. Reopen the conversation to check before trying again."
            : error.message||'Message could not be sent.');
          return {sent:false,retryText:text};
        }
        return {sent:false};
      }finally{sending=false;if(active)onSending(false);}
    },
    dispose(){active=false;read?.abort();},
  };
}
