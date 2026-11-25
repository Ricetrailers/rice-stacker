(function(){
 'use strict';
 var enabled=false,markers=[],flyout=null;
 function el(tag,text){var n=document.createElement(tag);if(text)n.textContent=text;return n;}
 var toggle=el('button','? Help');toggle.className='btn small';toggle.id='contextHelpToggle';toggle.setAttribute('aria-pressed','false');toggle.style.order='100';toggle.style.marginLeft='auto';document.querySelector('header.top').appendChild(toggle);
 var panel=el('div');panel.className='context-help-menu';panel.hidden=true;
 panel.appendChild(el('strong','Help is on'));
 panel.appendChild(el('p','Click a question mark to learn what a control does. Turn Help off to hide the question marks.'));
 var guide=el('button','Page & role guide');guide.className='btn small';guide.onclick=function(){window.RS_HELP_ACTIONS.guide();};panel.appendChild(guide);
 var tour=el('button','Redo guided tour');tour.className='btn small';tour.onclick=function(){setEnabled(false);window.RS_HELP_ACTIONS.tour();};panel.appendChild(tour);
 document.body.appendChild(panel);
 var layer=el('div');layer.className='context-help-markers';document.body.appendChild(layer);
 var descriptions={
 'Loads':'Return to the load dashboard. Open a load to plan or review its work.',
 'Library':'Browse and manage the trailer drawings used in stacking plans. Yard access is read-only through load drawings.',
 'Trailer library':'Open the drawing library to find and maintain trailer profiles.',
 '+ New load':'Create a load with its customer, shipping method and paperwork. Review imported information before planning the stack.',
 'Overview':'Show loads grouped by their current stage, from new loads through pickup.',
 'Daily view':'Show assigned prep and stacking due today or overdue. Unscheduled new loads are excluded.',
 'Schedule':'View prep, stacking and truck appointments. Office users can schedule work; Yard users can only view it.',
 'Week':'Show the schedule one week at a time.','Month':'Show the schedule one month at a time.',
 'Today':'Return the calendar to today.','This week':'Return the schedule to the current week.',
 '◀':'Move to the previous week or month.','▶':'Move to the next week or month.',
 'Stacking':'Open the drawing workspace. Add trailers, arrange the stack and inspect its dimensions.',
 'Load info':'Open customer details, paperwork, parts, tire records, parts locations and photos for this load.',
 'Load #':'The load reference number used to identify this shipment.',
 'Customer / destination':'The customer or destination for this load.',
 'Ship date':'The planned shipping date. Prep, stacking and truck appointments are scheduled separately.',
 'Address':'The delivery or customer address for this load.',
 'Notes for the yard':'Office instructions for the yard team. Yard accounts can read these instructions.',
 'Parts location / prep notes':'Record where parts are located on the load, for example “Stack 2, 2nd trailer.” Yard staff can update this field.',
 'Tire style / size':'Record the tire type or size. Keep one row for each tire type on the load.',
 'TIN':'Enter the actual tire identification number for this tire type. Existing loads retain their historical TINs.',
 'Qty':'The quantity of this tire type on the load.',
 '+ Add tire style':'Add a tire type to this load, then confirm its TIN and quantity.',
 '+ Attach PDF':'Attach load paperwork. Pick-list PDFs can supply parts information; review the imported results.',
 '+ Add photos':'Choose pictures from your device to document prep, parts or the finished stack.',
 '⛶ Fit':'Fit the whole drawing into the available drawing area.',
 '+':'Zoom in on the drawing.','−':'Zoom out on the drawing.',
 'Hide library':'Hide the trailer library to give the drawing more room.','Show library':'Show the trailer library again.',
 '⚡ Auto stack':'Automatically arrange the trailers. Check the resulting layout before using it for real work.',
 '↔ Flip':'Mirror the selected trailer horizontally.','↕ Roll over':'Turn the selected trailer over vertically.',
 'Duplicate':'Make another copy of the selected drawing item.','Remove':'Remove the selected drawing item from this load.',
 'Save':'Save outstanding changes. The save indicator reports whether the changes reached storage.',
 'Save now':'Save outstanding changes now. Wait for the save indicator to confirm completion.',
 'Print sheet':'Print the drawing and load information for this load.',
 'Manage team':'Admins can invite people, assign Admin/User/Yard roles and disable access.',
 'Tire types & TINs':'Maintain common tire sizes and current TIN defaults. Previously recorded loads keep their historical values.',
 'Export backup':'Download a backup of the current app data. Keep it in a secure location.',
 'Restore backup':'Replace current library and load data from a backup. Review the confirmation carefully.',
 'Search profiles…':'Filter the trailer library by model name. Check the required trailers, then use Add to load.',
 'Load status':'Change the load’s workflow stage after confirming that work is complete.',
 'Close panel ×':'Close this side panel to return to the drawing.',
 'Sign out':'Sign out of your account on this browser.'
 };
 function describe(n){
  var label=n.getAttribute('aria-label')||n.getAttribute('placeholder')||n.getAttribute('title')||n.textContent.trim();
  if(descriptions[label])return {label:label,text:descriptions[label]};
  if(n.matches('input[type=checkbox]')&&n.closest('.palrow'))return {label:'Select trailer',text:'Check this trailer, set its quantity, then click Add to load to place it in the drawing.'};
  if(/^Add (\d+ )?to load$/.test(label))return {label:label,text:'Place the checked trailers in this load’s drawing. You can then arrange and inspect them.'};
  if(/^\d+\s/.test(label)&&n.matches('button'))return {label:label,text:'Jump to this workflow stage on the dashboard to review its loads.'};
  if(/prepped/i.test(label)&&n.matches('button'))return {label:'Prep completion',text:'Mark preparation complete, or unmark it if more preparation is needed. This does not mark the load shipped.'};
  if(n.title)return {label:n.textContent.trim()||n.title,text:n.title};
  if(n.matches('input,textarea,select')){var wrap=n.closest('label')||n.parentElement;var l=wrap.querySelector('label');label=l?l.textContent.trim():label;if(label==='TYPE')return {label:'Shipping type',text:'Stack is a single stack that can wait for pickup. Semi stacking follows the truck appointment.'};if(label==='CUSTOMER PICKUP')return {label:'Customer pickup',text:'Indicate that the customer or their driver will collect this load.'};}
  if(n.matches('h3'))return {label:label,text:({'Parts on this load':'The parts imported from the pick list. Check these against the paperwork before marking preparation complete.','Paperwork':'Attached PDF documents for this load.','Tires':'Tire types, TINs and quantities recorded for this load.','Photos of the stack':'Photos documenting preparation and the finished load.','On this load':'A count of the trailers currently placed in the drawing.','Selected':'Position, rotation and actions for the selected drawing item.','Keyboard':'Drawing shortcuts. Click a shortcut button to customize its assigned key.','Library':'Select trailer models and quantities, then add them to the drawing.'})[label]||'This section groups the '+label.toLowerCase()+' information for the current load.'};
  return null;
 }
 function close(){if(flyout){flyout.remove();flyout=null;}}
 function show(info,anchor,control){close();flyout=el('section');flyout.className='context-help-flyout';flyout.setAttribute('role','dialog');flyout.setAttribute('aria-label',info.label+' help');flyout.appendChild(el('strong',info.label));flyout.appendChild(el('p',info.text+(control.disabled?' This control is unavailable in the current view.':'')));var b=el('button','Close');b.className='btn small';b.onclick=function(){close();anchor.focus();};flyout.appendChild(b);document.body.appendChild(flyout);var r=anchor.getBoundingClientRect();flyout.style.left=Math.max(8,Math.min(r.left,innerWidth-320))+'px';flyout.style.top=Math.max(8,Math.min(r.bottom+8,innerHeight-flyout.offsetHeight-8))+'px';b.focus();}
 function scan(){
  if(!enabled)return;
  markers.forEach(function(m){m.badge.remove();});markers=[];
  if(document.querySelector('.rs-tour,.modal-scrim'))return;
  document.querySelectorAll('#view button,#view input,#view textarea,#view select,#view h3,header.top button').forEach(function(n){
   if(n===toggle||n.hidden||!n.getClientRects().length)return;
   var r=n.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return;
   var info=describe(n);if(!info)return;
   var badge=el('button','?');badge.className='context-help-dot';badge.setAttribute('aria-label','Help: '+info.label);badge.style.left=Math.min(innerWidth-24,Math.max(2,r.right-10))+'px';badge.style.top=Math.max(2,r.top-9)+'px';badge.onclick=function(e){e.preventDefault();e.stopPropagation();show(info,badge,n);};layer.appendChild(badge);markers.push({badge:badge,control:n});
  });
 }
 function setEnabled(on){enabled=on;toggle.textContent=on?'? Help: on':'? Help';toggle.setAttribute('aria-pressed',String(on));panel.hidden=!on;tour.hidden=!window.RS_HELP_ACTIONS.canTour();close();if(!on){layer.innerHTML='';markers=[];}else scan();}
 toggle.onclick=function(){setEnabled(!enabled);};
 var pending=false;function schedule(){if(pending)return;pending=true;requestAnimationFrame(function(){pending=false;if(!flyout)scan();});}
 new MutationObserver(schedule).observe(document.getElementById('view'),{childList:true,subtree:true,attributes:true});
 window.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
})();
