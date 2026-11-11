import React, {useId} from 'react';

const FEATURES = [
  ['covered','Covered / garage'],
  ['cctv','CCTV / security camera'],
  ['lighting','Well-lit at night'],
  ['snowRemoval','Snow removal in winter'],
  ['evCharging','EV charging available'],
  ['gated','Gated access'],
];

export default function ListingFeatureFields({form,onChange,C}) {
  const groupId=useId();
  return <fieldset style={{border:0,padding:0,margin:0,minWidth:0}}>
    <legend style={{fontSize:12,color:C.muted,display:'block',marginBottom:6,fontWeight:600}}>Features</legend>
    {FEATURES.map(([key,label])=>{
      const inputId=`${groupId}-${key}`,labelId=`${inputId}-label`;
      return <label key={key} htmlFor={inputId} className="ps-tap-target" style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',marginBottom:8}}>
        <input id={inputId} name={key} type="checkbox" aria-labelledby={labelId} checked={Boolean(form[key])} onChange={event=>onChange(key,event.target.checked)} />
        <span id={labelId} style={{fontSize:14,color:C.navy}}>{label}</span>
      </label>;
    })}
  </fieldset>;
}
