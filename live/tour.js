(function(){
 'use strict';
 var running=false;
 function node(tag,text){var n=document.createElement(tag);if(text)n.textContent=text;return n;}
 window.RS_TOUR=function(api){
  if(running)return;running=true;api.begin();
  var layer=node('div');layer.className='rs-tour';
  var ring=node('div');ring.className='rs-tour-ring';layer.appendChild(ring);
  var card=node('section');card.className='rs-tour-card';card.setAttribute('role','dialog');card.setAttribute('aria-label','Guided practice');
  var count=node('p'),title=node('h2'),copy=node('p'),feedback=node('p'),next=node('button','Continue');next.className='btn primary';
  var restart=node('button','Restart tour');restart.className='btn small';var skip=node('button','Skip tour');skip.className='btn small';
  [count,title,copy,feedback,next,restart,skip].forEach(function(n){card.appendChild(n);});layer.appendChild(card);document.body.appendChild(layer);
  var i=0,target=null,done=false,timer=null,frame=null,lastRect="";
  function button(text){return Array.from(document.querySelectorAll('#view button,header button')).find(function(b){return b.textContent.trim()===text;});}
  var steps=[
   {title:'Learn by doing',text:'This is a practice workspace. Nothing you do here changes real loads. Follow the highlighted controls to learn the workflow. You can skip this tour and reopen it from Help anytime.',find:function(){return document.querySelector('.stage-summary');}},
   {title:'Look at the schedule',text:'Click Schedule. This is where you plan preparation, stacking and truck appointments.',find:function(){return button('Schedule');},event:'click'},
   {title:'Return to your loads',text:'Click Overview to return to the load dashboard. Its columns show each load’s stage.',find:function(){return button('Overview');},event:'click'},
   {title:'Open a load',text:'Click the PRACTICE load. Real loads open the same way.',find:function(){return document.querySelector('[data-tour-load]');},event:'click'},
   {title:'Choose a trailer',text:'Check the highlighted practice trailer in the library. This selects it for your load.',find:function(){var panel=document.querySelector('.editor > .panel');if(panel)panel.classList.add('open');return document.querySelector('.palrow[data-tour-trailer] input[type="checkbox"]');},event:'click'},
   {title:'Add the selected trailer',text:'Click Add 1 to load to place the selected trailer on your drawing. Always review a real layout before stacking.',find:function(){return button('Add 1 to load');},event:'click'},
   {title:'Fit the drawing',text:'Click Fit to bring the whole drawing into view. The + and − buttons adjust zoom. You can move trailers on real loads when planning a stack.',find:function(){return button('⛶ Fit');},event:'click'},
   {title:'Open Load info',text:'Click Load info. Paperwork, parts, tires, photos and load details are kept here.',find:function(){return button('Load info');},event:'click'},
   {title:'Enter customer details',text:'Type Practice customer in the highlighted field, then click Continue. Use the actual customer or destination on a real load.',find:function(){return document.querySelector('[aria-label="Customer / destination"]');},check:function(){return target.value.trim().toLowerCase()==='practice customer';}},
   {title:'Record where parts are staged',text:'Type Stack 2, 2nd trailer in Parts location / prep notes, then click Continue. Yard staff can update this field too.',find:function(){return document.querySelector('[aria-label="Parts location / prep notes"]');},check:function(){return target.value.trim().toLowerCase()==='stack 2, 2nd trailer';}},
   {title:'Record tire traceability',text:'Type PRACTICE in the TIN field, then click Continue. On a real load, enter the actual tire identification number and confirm the type and quantity.',find:function(){return document.querySelector('[aria-label="TIN"]');},check:function(){return target.value.trim().toUpperCase()==='PRACTICE';}},
   {title:'Add photos on real loads',text:'This is the Add photos control. Use it for prep or finished-stack pictures. No upload is needed in practice. Click Continue to finish the walkthrough.',find:function(){return button('+ Add photos');},observe:true},
   {title:'You’re ready',text:'On real loads, schedule prep and stacking, check the save indicator, and record pickup when the load leaves. Single stacks can wait for pickup; semi stacking follows the truck arrival. Click Finish to return to your real workspace. Replay this tour anytime from Help.',finish:true}
  ];
  function position(){if(!target||!target.isConnected)return;var spot=target.closest('[data-tour-trailer]')||target;var r=spot.getBoundingClientRect();var signature=[r.left,r.top,r.width,r.height].join(',');if(signature===lastRect)return;lastRect=signature;ring.style.cssText='left:'+(r.left-5)+'px;top:'+(r.top-5)+'px;width:'+(r.width+10)+'px;height:'+(r.height+10)+'px;';}
  function track(){position();frame=requestAnimationFrame(track);}
  function show(){
   clearTimeout(timer);if(target)target.classList.remove('rs-tour-target');target=null;done=false;lastRect="";
   var s=steps[i];count.textContent='GUIDED PRACTICE · '+(i+1)+' OF '+steps.length;title.textContent=s.title;copy.textContent=s.text;feedback.textContent='';
   next.textContent=s.finish?'Finish — start working':'Continue';next.hidden=!!s.event;next.disabled=false;ring.hidden=!!s.finish;
   if(s.find){target=s.find();if(!target){feedback.textContent='The screen did not open correctly. Use Restart tour to try again.';next.disabled=true;return;}if(s.event&&!target.matches('button,input')){target.tabIndex=0;target.setAttribute('role','button');}target.classList.add('rs-tour-target');target.scrollIntoView({block:'center',behavior:'instant'});position();}
   card.style.top=target&&target.getBoundingClientRect().top>window.innerHeight/2?'16px':'auto';card.style.bottom=card.style.top==='auto'?'16px':'auto';
   if(target&&s.check)target.focus({preventScroll:true});else next.hidden?card.setAttribute('tabindex','-1'):next.focus({preventScroll:true});
   requestAnimationFrame(position);
  }
  function advance(){if(done)return;done=true;timer=setTimeout(function(){i++;show();},160);}
  function block(e){
   if(card.contains(e.target))return;
   var s=steps[i],allowed=target&&target.contains(e.target)&&(s.event||s.check)&&!s.observe&&!s.finish;
   if(!allowed){e.preventDefault();e.stopImmediatePropagation();return;}
   if(s.event==='click'&&e.type==='click'){advance();}
  }
  function keys(e){
   if(steps[i].event&&e.target===target&&(e.key==='Enter'||e.key===' ')&&!target.matches('button')){e.preventDefault();e.stopImmediatePropagation();target.click();return;}
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cleanup();return;}
   if(e.key==='Tab'){var focusable=[target&&target.matches('button,input,textarea,select')?target:null,next.hidden?null:next,restart,skip].filter(Boolean);var index=focusable.indexOf(document.activeElement);e.preventDefault();e.stopImmediatePropagation();focusable[(index+(e.shiftKey?-1:1)+focusable.length)%focusable.length].focus();return;}
   if(!card.contains(e.target)&&!(steps[i].check&&e.target===target)&&!(steps[i].event&&e.target===target&&(e.key==='Enter'||e.key===' '))){e.preventDefault();e.stopImmediatePropagation();}
  }
  function cleanup(){cancelAnimationFrame(frame);clearTimeout(timer);if(target)target.classList.remove('rs-tour-target');['pointerdown','click'].forEach(function(e){document.removeEventListener(e,block,true);});document.removeEventListener('keydown',keys,true);window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);layer.remove();running=false;api.end();}
  next.onclick=function(){var s=steps[i];if(s.check&&!s.check()){feedback.textContent='Complete the highlighted field as instructed to continue.';target.focus();return;}if(s.finish){next.disabled=true;api.complete().then(cleanup).catch(function(){feedback.textContent='Could not save training completion. Check your connection and try Finish again.';next.disabled=false;});}else advance();};
  skip.onclick=cleanup;
  restart.onclick=function(){api.end();api.begin();i=0;show();};
  ['pointerdown','click'].forEach(function(e){document.addEventListener(e,block,true);});document.addEventListener('keydown',keys,true);window.addEventListener('resize',position);window.addEventListener('scroll',position,true);show();track();
 };
})();


