import React, {useId,useRef} from 'react';
import {AVAILABILITY_DAYS,createAvailabilityPreset} from '../lib/listingAvailability.js';
import {addCalendarDays,validateHostAvailabilityExceptions} from '../lib/availabilityExceptionDates.js';
import {listingScheduleError} from '../lib/listingSettings.js';

function TimeWindows({windows,onChange,label,id,disabled,C}) {
  const input={width:'100%',minWidth:0,minHeight:44,boxSizing:'border-box',border:'1px solid '+C.concrete,borderRadius:8,padding:6,fontFamily:'inherit'};
  return <div style={{display:'flex',flexDirection:'column',gap:8}}>
    {windows.map((window,index)=><div key={index} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) 44px',gap:6,alignItems:'end'}}>
      {['start','end'].map(field=><label key={field} htmlFor={`${id}-${index}-${field}`} style={{fontSize:12,color:C.navy}}>{field==='start'?'From':'To'}
        <input id={`${id}-${index}-${field}`} aria-label={`${label} ${field==='start'?'start':'end'} time ${index+1}`} type="time" step="60" style={input} value={window[field]} onChange={event=>onChange(windows.map((w,i)=>i===index?{...w,[field]:event.target.value}:w))} />
      </label>)}
      <button type="button" className="ps-tap-target" aria-label={`Remove ${label} time window ${index+1}`} disabled={disabled||windows.length===1} onClick={()=>onChange(windows.filter((_,i)=>i!==index))}>×</button>
    </div>)}
    <button type="button" className="ps-tap-target" disabled={disabled||windows.length>=8} onClick={()=>onChange([...windows,{start:'17:00',end:'21:00'}])}>+ Add another time</button>
  </div>;
}

export default function ListingAvailabilityEditor({value,onChange,paused=false,disabled=false,C}) {
  const id=useId(),sequence=useRef(0);
  if(!value)return <p role="status">The property time zone must be verified before its schedule can be changed. You can still pause this listing.</p>;
  const validation=validateHostAvailabilityExceptions(value),error=listingScheduleError(value,value.timezone,paused);
  const change=transform=>{if(!disabled)onChange(current=>transform(current));};
  const dayChange=(key,patch)=>change(current=>({...current,preset:'custom',weekly:{...current.weekly,[key]:{...current.weekly[key],...patch}}}));
  const exceptionChange=(key,patch)=>change(current=>({...current,exceptions:current.exceptions.map(item=>item.id===key?{...item,...patch}:item)}));
  const addException=()=>{
    const key=`${id}-date-${++sequence.current}`,date=addCalendarDays(validation.today,1);
    if(date)change(current=>({...current,exceptions:[...current.exceptions,{id:key,type:'unavailable',startDate:date,endDate:date,windows:[{start:'09:00',end:'17:00'}]}]}));
  };
  return <fieldset disabled={disabled} style={{border:'1px solid '+C.concrete,borderRadius:12,padding:12,minWidth:0,margin:0}}>
    <legend style={{fontWeight:700,color:C.navy}}>Availability and special dates</legend>
    <p style={{fontSize:12,color:C.muted}}>Times use the property's local time zone ({value.timezone}). Existing reservations keep their booked times.</p>
    <div role="group" aria-label="Availability presets" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>
      {[['anytime','Anytime · 24/7'],['weekdays','Weekdays'],['weekends','Weekends'],['business','Business hours · 9–5'],['evenings','Evenings · 5–11'],['custom','Custom schedule']].map(([key,label])=><button key={key} type="button" className="ps-tap-target" aria-pressed={value.preset===key} style={{border:"1px solid "+C.concrete,borderRadius:8,fontFamily:"inherit",fontWeight:700,fontSize:12,background:value.preset===key?C.navy:C.white,color:value.preset===key?C.white:C.navy}} onClick={()=>change(current=>key==='custom'?{...current,preset:key}:{...createAvailabilityPreset(key,current.timezone),exceptions:current.exceptions})}>{label}</button>)}
    </div>
    <div style={{display:'flex',flexDirection:'column',gap:12,marginTop:16}}>
      {AVAILABILITY_DAYS.map(day=><div key={day.key} style={{borderTop:'1px solid '+C.concrete,paddingTop:8}}>
        <label htmlFor={`${id}-${day.key}`} className="ps-tap-target" style={{display:'flex',alignItems:'center',gap:8,color:C.navy,fontWeight:700}}>
          <input id={`${id}-${day.key}`} type="checkbox" checked={value.weekly[day.key].enabled} onChange={event=>dayChange(day.key,{enabled:event.target.checked,windows:value.weekly[day.key].windows.length?value.weekly[day.key].windows:[{start:'09:00',end:'17:00'}]})} />{day.label}
        </label>
        {value.weekly[day.key].enabled&&<TimeWindows windows={value.weekly[day.key].windows} label={day.label} id={`${id}-${day.key}-window`} disabled={disabled} C={C} onChange={windows=>dayChange(day.key,{windows})} />}
      </div>)}
    </div>
    <h4 style={{color:C.navy,marginBottom:4}}>Special dates</h4>
    <p style={{fontSize:12,color:C.muted}}>Only current and upcoming special dates are shown. Add dates through {validation.latest}.</p>
    {!value.exceptions.length&&<p style={{fontSize:12,color:C.muted}}>No special dates added.</p>}
    {value.exceptions.map((item,index)=><fieldset key={item.id} style={{border:'1px solid '+C.concrete,borderRadius:8,padding:8,minWidth:0,marginBottom:12}}>
      <legend>Special date {index+1}</legend>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>
        {['startDate','endDate'].map(field=><label key={field} htmlFor={`${id}-exception-${index}-${field}`} style={{fontSize:12,color:C.navy}}>{field==='startDate'?'From date':'To date'}<input id={`${id}-exception-${index}-${field}`} style={{width:'100%',minWidth:0,minHeight:44,boxSizing:'border-box'}} type="date" min={validation.today||undefined} max={validation.latest||undefined} value={item[field]} onChange={event=>exceptionChange(item.id,{[field]:event.target.value})} /></label>)}
      </div>
      <label htmlFor={`${id}-exception-${index}-type`} style={{display:'block',fontSize:12,color:C.navy,marginTop:8}}>On these dates
        <select id={`${id}-exception-${index}-type`} style={{width:'100%',minHeight:44}} value={item.type} onChange={event=>exceptionChange(item.id,{type:event.target.value,windows:item.windows.length?item.windows:[{start:'09:00',end:'17:00'}]})}>
          <option value="unavailable">Not available</option><option value="available-all-day">Available all day</option><option value="custom">Use special hours</option>
        </select>
      </label>
      {item.type==='custom'&&<TimeWindows windows={item.windows} label={`Special date ${index+1}`} id={`${id}-exception-${index}-window`} disabled={disabled} C={C} onChange={windows=>exceptionChange(item.id,{windows})} />}
      <button type="button" className="ps-tap-target" onClick={()=>change(current=>({...current,exceptions:current.exceptions.filter(e=>e.id!==item.id)}))}>Remove special date</button>
    </fieldset>)}
    <button type="button" className="ps-tap-target" disabled={value.exceptions.length>=100} onClick={addException}>+ Add special date</button>
    {error&&<p role="alert" style={{color:C.red,fontSize:12}}>{error}</p>}
  </fieldset>;
}
