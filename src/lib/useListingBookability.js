import {useEffect, useRef, useState} from 'react';
import {normalizeBookingStatus} from './bookingReadiness.js';

export function useListingBookability(listingId, paused = false) {
  const real = Number.isSafeInteger(listingId) && listingId > 0;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const scope = useRef({id: listingId, revision, active: true, retryPending: false});
  if (scope.current.id !== listingId || scope.current.revision !== revision) {
    scope.current.active = false;
    scope.current = {id: listingId, revision, active: true, retryPending: false};
  }
  const owner = scope.current;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    if (!real) return;
    owner.active = true;
    let active = true, controller, attempt = 0;
    const load = (initial = false) => {
      if (!active || document.visibilityState === 'hidden' || pausedRef.current && !initial) return;
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal, turn = ++attempt;
      const current = () => active && owner.active && scope.current === owner && turn === attempt && !signal.aborted;
      setResult({owner, status: 'checking'});
      fetch(`/api/listing-bookability?listingId=${listingId}`, {cache: 'no-store', signal})
        .then(async response => {
          if (!response.ok) throw new Error('Unavailable');
          const payload = await response.json();
          const status = normalizeBookingStatus(payload?.bookingStatus);
          if (status === 'unknown') throw new Error('Unavailable');
          if (current()) setResult({owner, status});
        }).catch(() => {if (current()) setResult({owner, status: 'unknown'});});
    };
    const refresh = () => load(false);
    load(true);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false; owner.active = false; controller?.abort();
      window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh);
    };
  }, [listingId, revision]);
  const retry = () => {
    if (!real || !owner.active || scope.current !== owner || owner.retryPending || pausedRef.current) return;
    owner.retryPending = true;
    setRevision(value => value + 1);
  };
  return {status: !real ? 'ready' : result?.owner === owner ? result.status : 'checking', retry};
}
