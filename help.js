(function () {
  'use strict';
  function el(tag,text){var e=document.createElement(tag);if(text)e.textContent=text;return e;}
  var active=null;
  window.RS_HELP=function(role,email,automatic){
    if(active)return;
    var key='rice-stacker-help-v1:'+email.toLowerCase()+':'+role;
    if(automatic){try{if(localStorage.getItem(key))return;}catch(e){}}
    var yard=role==='yard',admin=role==='admin';
    var steps=yard?[
      ['Start with Daily view','To prepare shows prep due today, overdue work, and undated prep assignments. Stack today shows stacking due today or carried forward. Open a load to see its drawing and details.'],
      ['Check the stack and paperwork','The drawing is read-only. Use +, − and Fit to inspect it; scroll to the details below. Read the load notes, paperwork and parts list before starting. If a drawing or schedule needs changing, contact the office.'],
      ['Record the work','Enter each tire type, TIN and quantity under Tires. Use Parts location / prep notes to record where parts are staged. Add photos from your device to document preparation or the finished stack.'],
      ['Finish preparation','When preparation is complete, select Mark as prepped. The office handles the next stage. Check the save indicator before leaving; wait for saving to finish. If a save fails, keep the page open and retry when connected.'],
      ['Look ahead in Schedule','Browse the week or month to see upcoming work. Yard scheduling is view-only. Carried forward means unfinished work is overdue; it does not change the original date. Confirm overdue semi arrivals with the office.']
    ]:[
      ['Create or open a load','Start from the Load dashboard. Choose + New load, enter the customer and load details, and select Stack or Semi. Use the paperwork import controls to bring in the ERP information, then review it for accuracy.'],
      ['Plan the drawing','Open the Stacking tab. Add trailers from the library and arrange the stack. Use Fit and zoom to inspect the drawing. Review an auto-stacked layout before using it. The library can be hidden to give the drawing more room.'],
      ['Keep the details together','Use Load info for paperwork, parts, tire types/TINs and quantities, parts location/prep notes, and photos. Maintain common tire TINs under Settings & tools → Tire types & TINs; older loads keep their recorded TINs.'],
      ['Schedule preparation and stacking','Use Schedule to plan prep, stacking and pickup. Single stacks use their stacking date and can wait for pickup. Semi loads use the truck appointment for stacking and ship with that truck. Check the carrier and arrival date.'],
      ['Follow the load through the yard','Review prep completion, move the load through its stages, and record pickup when it leaves. Overdue work carries forward without changing its original dates. Keep an eye on the save indicator and wait for saving to finish before closing.']
    ];
    if(admin)steps.push(['Manage your team','Open Settings & tools → Manage team. Invite each person by email and choose Admin, User or Yard. Admins manage people; Users do all load work; Yard can view stacks and update work records. Uncheck Active to disable access. Another admin must change your own access.']);
    var opener=document.activeElement,scrim=el('div');scrim.className='modal-scrim';active=scrim;
    var dialog=el('div');dialog.className='modal small';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','help-title');dialog.style.maxWidth='640px';
    var head=el('div');head.className='modal-head';var title=el('h2','Welcome to Rice Stacker');title.id='help-title';head.appendChild(title);
    var close=el('button','×');close.className='iconbtn';close.setAttribute('aria-label','Close guide');head.appendChild(close);dialog.appendChild(head);
    var body=el('div');body.className='modal-body';body.style.maxHeight='65vh';body.style.overflowY='auto';
    body.appendChild(el('p',(admin?'Admin':yard?'Yard':'User')+' guide · '+(yard?'View the plan and record your work.':'Plan loads and keep the yard informed.')));
    var list=el('ol');list.style.paddingLeft='24px';
    steps.forEach(function(step){var li=el('li');li.style.marginBottom='18px';li.appendChild(el('strong',step[0]));var p=el('p',step[1]);p.style.margin='6px 0';li.appendChild(p);list.appendChild(li);});body.appendChild(list);
    body.appendChild(el('p','You can reopen this guide anytime using Help at the top right of the app.'));
    dialog.appendChild(body);var foot=el('div');foot.className='modal-foot';var done=el('button','Got it — start working');done.className='btn primary';foot.appendChild(done);dialog.appendChild(foot);scrim.appendChild(dialog);document.body.appendChild(scrim);
    function dismiss(){try{localStorage.setItem(key,'seen');}catch(e){}scrim.remove();active=null;document.removeEventListener('keydown',keys,true);if(opener&&opener.isConnected)opener.focus();}
    function keys(e){
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();dismiss();}
      else if(e.key==='Tab'){var nodes=dialog.querySelectorAll('button');if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes[nodes.length-1].focus();}else if(!e.shiftKey&&document.activeElement===nodes[nodes.length-1]){e.preventDefault();nodes[0].focus();}}
      else e.stopPropagation();
    }
    close.onclick=dismiss;done.onclick=dismiss;document.addEventListener('keydown',keys,true);done.focus();
  };
})();
