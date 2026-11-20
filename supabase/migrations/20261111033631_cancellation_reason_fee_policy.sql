-- Additive QA-first migration. All money operations are server-only.
create table public.booking_refund_operations (
 id uuid primary key default gen_random_uuid(), booking_id bigint not null references public.bookings(id),
 request_key text not null, requested_by uuid not null, actor text not null check(actor in ('driver','host','staff')),
 action text not null check(action in ('cancel','refund')), reason_code text not null, explanation text not null,
 fee_payer text not null check(fee_payer in ('host','parkshare')),
 connected_account_id text not null, payment_intent_id text not null, charge_id text not null, livemode boolean not null,
 currency text not null default 'cad' check(currency='cad'), gross_cents bigint not null check(gross_cents>0),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=gross_cents),
 processing_fee_cents bigint not null check(processing_fee_cents>=0 and processing_fee_cents<=gross_cents),
 fee_credit_cents bigint check(fee_credit_cents>=0 and fee_credit_cents<=processing_fee_cents),
 refund_id text, refund_status text, transfer_id text,
 state text not null default 'queued' check(state in ('queued','complete','review')),
 created_at timestamptz not null default now(), refund_attempt_at timestamptz, transfer_attempt_at timestamptz,
 lease_until timestamptz not null default now(), lease_token uuid, review_code text,
 unique(booking_id,request_key), unique(connected_account_id,livemode,refund_id), unique(transfer_id)
);
alter table public.booking_refund_operations enable row level security;
revoke all on public.booking_refund_operations from public,anon,authenticated;
grant select,insert,update on public.booking_refund_operations to service_role;
create index booking_refund_operations_pending on public.booking_refund_operations(livemode,lease_until) where state='queued';

create table public.booking_cancellation_reviews (
 id uuid primary key default gen_random_uuid(), booking_id bigint not null references public.bookings(id),
 requested_by uuid not null, reason_code text not null check(reason_code='driver_access'),
 explanation text not null, created_at timestamptz not null default now(),
 unique(booking_id,requested_by)
);
alter table public.booking_cancellation_reviews enable row level security;
revoke all on public.booking_cancellation_reviews from public,anon,authenticated;
grant select,insert on public.booking_cancellation_reviews to service_role;

create function public.reserve_booking_refund(p_operation jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.bookings%rowtype; existing public.booking_refund_operations%rowtype; op public.booking_refund_operations%rowtype;
begin
 select * into strict b from public.bookings where id=(p_operation->>'booking_id')::bigint for update;
 select * into existing from public.booking_refund_operations where booking_id=b.id and request_key=p_operation->>'request_key';
 if found then return to_jsonb(existing); end if;
 if b.status not in ('confirmed','completed') or b.paid_at is null
 or b.stripe_charge_id is distinct from p_operation->>'charge_id'
 or b.stripe_payment_intent_id is distinct from p_operation->>'payment_intent_id'
 or b.stripe_connected_account_id is distinct from p_operation->>'connected_account_id'
 or round(b.total*100)<>(p_operation->>'gross_cents')::bigint
 or coalesce(b.refund_pending_amount,0)>0
 or (p_operation->>'amount_cents')::bigint>round((b.total-coalesce(b.refund_total_amount,0))*100)
 then raise exception 'booking_payment_changed'; end if;
 if exists(select 1 from public.booking_refund_operations where booking_id=b.id and state<>'complete'
 and coalesce(refund_status,'') not in ('failed','canceled')) then raise exception 'refund_operation_pending_review'; end if;
 insert into public.booking_refund_operations(booking_id,request_key,requested_by,actor,action,reason_code,explanation,fee_payer,
 connected_account_id,payment_intent_id,charge_id,livemode,gross_cents,amount_cents,processing_fee_cents)
 values(b.id,p_operation->>'request_key',(p_operation->>'requested_by')::uuid,p_operation->>'actor',p_operation->>'action',
 p_operation->>'reason_code',p_operation->>'explanation',p_operation->>'fee_payer',p_operation->>'connected_account_id',
 p_operation->>'payment_intent_id',p_operation->>'charge_id',(p_operation->>'livemode')::boolean,
 (p_operation->>'gross_cents')::bigint,(p_operation->>'amount_cents')::bigint,(p_operation->>'processing_fee_cents')::bigint) returning * into op;
 if op.action='cancel' then
 update public.bookings set cancellation_requested_at=now(),cancelled_by=case when op.actor='staff' then 'support' else op.actor end,
 cancellation_reason=op.reason_code||case when op.explanation<>'' then ': '||op.explanation else '' end where id=b.id;
 end if;
 return to_jsonb(op);
end $$;

create function public.claim_booking_refund(p_id uuid,p_token uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare op public.booking_refund_operations%rowtype;
begin
 update public.booking_refund_operations set lease_token=p_token,lease_until=now()+interval '2 minutes',
 refund_attempt_at=coalesce(refund_attempt_at,now())
 where id=p_id and state='queued' and lease_until<=now() returning * into op;
 return case when found then to_jsonb(op) else null end;
end $$;

create function public.allocate_refund_fee_credit(p_id uuid,p_token uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare op public.booking_refund_operations%rowtype; eligible bigint; credited bigint; target bigint;
begin
 -- Same lock as reservation; concurrent partials share one cumulative ceiling.
 perform 1 from public.bookings where id=(select booking_id from public.booking_refund_operations where id=p_id) for update;
 select * into strict op from public.booking_refund_operations where id=p_id and lease_token=p_token for update;
 if op.refund_status is distinct from 'succeeded' then raise exception 'refund_not_succeeded'; end if;
 if op.fee_credit_cents is not null then return to_jsonb(op); end if;
 if op.fee_payer='host' then target:=0;
 else
 select coalesce(sum(amount_cents),0),coalesce(sum(fee_credit_cents),0) into eligible,credited
 from public.booking_refund_operations where connected_account_id=op.connected_account_id and livemode=op.livemode
 and charge_id=op.charge_id and id<>op.id and fee_payer='parkshare' and fee_credit_cents is not null;
 target:=greatest(0,least(op.processing_fee_cents,round(op.processing_fee_cents::numeric*least(op.gross_cents,eligible+op.amount_cents)/op.gross_cents)::bigint)-credited);
 end if;
 update public.booking_refund_operations set fee_credit_cents=target where id=op.id returning * into op;
 return to_jsonb(op);
end $$;
revoke all on function public.reserve_booking_refund(jsonb),public.claim_booking_refund(uuid,uuid),public.allocate_refund_fee_credit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_booking_refund(jsonb),public.claim_booking_refund(uuid,uuid),public.allocate_refund_fee_credit(uuid,uuid) to service_role;
