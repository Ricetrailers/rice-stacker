(function () {
  'use strict';
  var gate=document.getElementById('authGate');
  function message(text){document.getElementById('authMsg').textContent=text;}
  var forgot=document.createElement('button');forgot.className='btn';forgot.textContent='Forgot password';
  forgot.onclick=function(){
    var email=document.getElementById('authEmail');
    if(!email.value.trim()){message('Enter your email or username first.');return;}
    if(!email.value.includes('@')){message('For username accounts, ask your admin to set a new password in Manage team.');return;}
    forgot.disabled=true;
    RS_STORAGE.resetPassword(email.value.trim()).then(function(){message('If your account exists, a password reset email has been requested.');}).catch(function(e){message(e.message);}).finally(function(){forgot.disabled=false;});
  };
  if(!RS_STORAGE.mock)gate.querySelector('.authcard').appendChild(forgot);
  window.RS_SHOW_PASSWORD_SETUP=function(){
    gate.hidden=false;document.querySelector('.app').style.display='none';
    var card=gate.querySelector('.authcard');card.innerHTML='';
    var title=document.createElement('h2');title.textContent='Set your password';card.appendChild(title);
    var pass=document.createElement('input');pass.type='password';pass.placeholder='New password (at least 12 characters)';pass.autocomplete='new-password';pass.minLength=12;pass.required=true;card.appendChild(pass);
    var confirm=document.createElement('input');confirm.type='password';confirm.placeholder='Confirm password';confirm.autocomplete='new-password';card.appendChild(confirm);
    var feedback=document.createElement('p');card.appendChild(feedback);
    var save=document.createElement('button');save.className='btn primary';save.textContent='Save password';card.appendChild(save);
    save.onclick=function(){
      if(!pass.reportValidity())return;
      if(pass.value!==confirm.value){feedback.textContent='Passwords do not match.';return;}
      save.disabled=true;
      RS_STORAGE.setPassword(pass.value).then(function(){location.replace(location.origin+'/');}).catch(function(e){feedback.textContent=e.message;save.disabled=false;});
    };
    var back=document.createElement('button');back.className='btn';back.textContent='Back to sign in';card.appendChild(back);
    back.onclick=function(){RS_STORAGE.signOut().then(function(){location.replace(location.origin+'/');});};
  };
})();
