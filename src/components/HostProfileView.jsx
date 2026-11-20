import React, {useEffect, useRef, useState} from 'react';
import {requestHostProfile, validateHostProfile} from '../lib/hostProfile.js';

export default function HostProfileView({user, client, onProfileUpdated}) {
  const accountId = user?.role === 'host' ? user.id : null;
  const lifetime = useRef({accountId, active: true, read: null, save: null});
  if (lifetime.current.accountId !== accountId) {
    lifetime.current.active = false;
    lifetime.current.read?.controller.abort();
    lifetime.current = {accountId, active: true, read: null, save: null};
  }
  const owner = lifetime.current;
  const canAct = () => Boolean(accountId) && owner.active && lifetime.current === owner;
  const [model, setModel] = useState({owner: null, loading: true, profile: null, saving: false, error: '', errors: {}, saved: false});
  const nameInput = useRef(null), phoneInput = useRef(null);
  const load = async () => {
    if (!canAct() || owner.save) return;
    owner.read?.controller.abort();
    const work = {controller: new AbortController()};
    owner.read = work;
    const current = () => canAct() && owner.read === work && !work.controller.signal.aborted;
    setModel({owner, loading: true, profile: null, saving: false, error: '', errors: {}, saved: false});
    try {
      const profile = await requestHostProfile(client, {accountId, isCurrent: current, signal: work.controller.signal});
      if (profile && current()) {
        setModel({owner, loading: false, profile, saving: false, error: '', errors: {}, saved: false});
        onProfileUpdated(profile);
      }
    } catch (error) {
      if (current()) setModel({owner, loading: false, profile: null, saving: false, error: error.message, errors: {}, saved: false});
    }
  };
  useEffect(() => {
    owner.active = true;
    void load();
    return () => {owner.active = false; owner.read?.controller.abort(); owner.read = null; owner.save = null;};
  }, [accountId]);
  const view = model.owner === owner ? model : {loading: true, profile: null, saving: false, error: '', errors: {}, saved: false};
  const update = (field, value) => {
    if (!canAct() || owner.save || !view.profile) return;
    setModel(current => ({...current, profile: {...current.profile, [field]: value}, errors: {...current.errors, [field]: ''}, saved: false, error: ''}));
  };
  const save = async event => {
    event.preventDefault();
    if (!canAct() || owner.save || !view.profile) return;
    const validation = validateHostProfile(view.profile);
    if (!validation.valid) {
      setModel(current => ({...current, errors: validation.errors, saved: false}));
      (validation.errors.name ? nameInput : phoneInput).current?.focus();
      return;
    }
    const work = {};
    owner.save = work;
    const current = () => canAct() && owner.save === work;
    setModel(model => ({...model, saving: true, saved: false, error: '', errors: {}}));
    try {
      const profile = await requestHostProfile(client, {accountId, isCurrent: current, profile: validation.normalised});
      if (!profile || !current()) return;
      setModel({owner, loading: false, profile, saving: false, error: '', errors: {}, saved: true});
      onProfileUpdated(profile);
    } catch (error) {
      if (current()) setModel(model => ({...model, saving: false, error: error.message, errors: error.fieldErrors || {}, saved: false}));
    } finally {if (current()) owner.save = null;}
  };
  if (!accountId) return <p role="alert">Sign in as a Host to open your account profile.</p>;
  return <div className="ps-driver-profile-page ps-host-profile-page">
    <section className="ps-driver-profile-intro"><div><div className="ps-profile-eyebrow">HOST PROFILE</div>
      <h1>Your Host profile</h1><p>Keep your name and contact details up to date.</p></div></section>
    {view.loading && <p role="status">Loading your Host profile…</p>}
    {view.error && <p className="ps-profile-message is-error" role="alert">{view.error}</p>}
    {!view.loading && <div className="ps-host-profile-actions"><button type="button" disabled={view.saving} onClick={() => void load()}>Reload profile</button></div>}
    {view.profile && <form className="ps-driver-profile-card" noValidate onSubmit={save} aria-busy={view.saving}>
      <div className="ps-driver-profile-fields">
        <div className="ps-profile-field"><label htmlFor="host-profile-name">Full name <span>Required</span></label>
          <input ref={nameInput} id="host-profile-name" name="name" autoComplete="name" value={view.profile.name} onChange={event => update('name', event.target.value)} required maxLength={80} disabled={view.saving} aria-invalid={Boolean(view.errors.name)} aria-describedby={view.errors.name ? 'host-profile-name-error' : undefined}/>
          {view.errors.name && <small id="host-profile-name-error" role="alert">{view.errors.name}</small>}</div>
        <div className="ps-profile-field"><label htmlFor="host-profile-email">Sign-in email</label>
          <input id="host-profile-email" type="email" autoComplete="email" value={view.profile.email} readOnly aria-readonly="true"/><em>Your sign-in email is shown for reference.</em></div>
        <div className="ps-profile-field"><label htmlFor="host-profile-phone">Phone number <span>Optional</span></label>
          <input ref={phoneInput} id="host-profile-phone" name="phone" type="tel" autoComplete="tel" value={view.profile.phone} onChange={event => update('phone', event.target.value)} maxLength={30} disabled={view.saving} aria-invalid={Boolean(view.errors.phone)} aria-describedby={view.errors.phone ? 'host-profile-phone-error' : 'host-profile-phone-help'}/>
          <em id="host-profile-phone-help">Include your area code.</em>{view.errors.phone && <small id="host-profile-phone-error" role="alert">{view.errors.phone}</small>}</div>
        <div className="ps-host-profile-actions"><button type="submit" disabled={view.saving}>{view.saving ? 'Saving profile…' : 'Save profile'}</button></div>
        {view.saved && <p className="ps-profile-message is-success" role="status">Profile saved successfully.</p>}
      </div>
      <aside className="ps-profile-checklist"><h2>Your private account</h2><p>This page is available only in your signed-in account. Your display name is used in the Host Dashboard and booking conversations.</p><p>Your phone number is not added to public parking listings. Stripe payout details are managed separately.</p></aside>
    </form>}
  </div>;
}
