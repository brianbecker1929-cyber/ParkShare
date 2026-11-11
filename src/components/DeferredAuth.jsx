import React, {useEffect, useState} from 'react';
import {loadAuthValidation} from '../lib/authValidation.js';

// The child account form cannot mount or accept a secret before its complete
// validation module is ready. Loading and failure retain a named, closable dialog.
export default function DeferredAuth({Dialog, children}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    loadAuthValidation().then(() => { if (active) setReady(true); }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [revision]);
  if (ready) return children;
  const close = children.props.onClose;
  return <Dialog title="Loading ParkShare account" onClose={close} className="ps-auth-dialog"
    style={{position: 'fixed', inset: 0, margin: 'auto', width: 'calc(100% - 40px)', maxWidth: 400, maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto', padding: 24, border: 0, borderRadius: 20, background: '#fff', color: '#0E1B2E'}}>
    <h2>ParkShare account</h2>
    <p role={error ? 'alert' : 'status'}>{error ? 'The account form could not load. Please retry or close it and refresh the page.' : 'Loading your secure account form…'}</p>
    <div style={{display: 'flex', flexWrap: 'wrap', gap: 12}}>
      {error && <button type="button" onClick={() => setRevision(value => value + 1)} style={{minHeight: 44, padding: '10px 18px'}}>Retry account form</button>}
      <button type="button" onClick={close} style={{minHeight: 44, padding: '10px 18px'}}>Close</button>
    </div>
  </Dialog>;
}
