const $ = (s) => document.querySelector(s);
const state = { token: localStorage.getItem('kidsviral_token'), user: null, projects: [], current: null, authMode: 'login' };
const authView = $('#auth-view'), appView = $('#app-view');
function escapeHtml(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),3200); }
async function api(url, options={}) {
  const headers = { 'Content-Type':'application/json', ...(options.headers||{}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const response = await fetch(url, {...options, headers});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
}
function showAuth() { authView.classList.remove('hidden'); appView.classList.add('hidden'); $('#account-area').innerHTML=''; }
function showApp() { authView.classList.add('hidden'); appView.classList.remove('hidden'); $('#account-area').innerHTML='<span class="account-name">'+escapeHtml(state.user?.name || '')+'</span><button id="logout" class="ghost-button">Sair ↗</button>'; $('#logout').onclick=logout; }
function setAuthMode(mode) {
  state.authMode=mode;
  document.querySelectorAll('[data-auth]').forEach(b=>b.classList.toggle('active',b.dataset.auth===mode));
  const reg=mode==='register'; $('#name-wrap').classList.toggle('hidden',!reg);
  $('#auth-title').textContent=reg?'Crie sua conta':'Bem-vindo de volta!';
  $('#auth-subtitle').textContent=reg?'Seu estúdio criativo começa agora.':'Entre para continuar criando.';
  $('#auth-submit').innerHTML=reg?'Criar minha conta <span>→</span>':'Entrar no estúdio <span>→</span>';
  $('#auth-error').textContent='';
}
document.querySelectorAll('[data-auth]').forEach(b=>b.addEventListener('click',()=>setAuthMode(b.dataset.auth)));
$('#auth-form').addEventListener('submit',async e=>{
  e.preventDefault(); const form=new FormData(e.currentTarget); const payload=Object.fromEntries(form.entries());
  $('#auth-submit').disabled=true; $('#auth-error').textContent='';
  try {
    const data=await api('/api/auth/'+state.authMode,{method:'POST',body:JSON.stringify(payload)});
    state.token=data.token; state.user=data.user; localStorage.setItem('kidsviral_token',state.token); await loadProjects(); showApp();
  } catch(err) { $('#auth-error').textContent=err.message; }
  finally { $('#auth-submit').disabled=false; }
});
function logout(){ state.token=null; state.user=null; localStorage.removeItem('kidsviral_token'); showAuth(); }
async function loadProjects(){
  const data=await api('/api/projects'); state.projects=data.projects;
  $('#project-count').textContent=state.projects.length;
  $('#script-count').textContent=state.projects.filter(p=>p.script).length;
  $('#video-count').textContent='—';
  $('#empty-state').classList.toggle('hidden',state.projects.length>0);
  $('#projects').innerHTML=state.projects.map(p=>'<article class="project-card"><div class="project-art">✦</div><div class="project-info"><span class="project-tag">'+escapeHtml(p.style||'Projeto')+'</span><h3>'+escapeHtml(p.title)+'</h3><p>'+escapeHtml(p.concept||'Uma nova história está esperando para nascer.')+'</p><div class="project-footer"><span>'+(p.script?'✧ Roteiro criado':'○ Em desenvolvimento')+'</span><button class="text-button" data-open="'+p.id+'">Abrir projeto →</button></div></div></article>').join('');
  document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openProject(b.dataset.open)));
}
function openCreate(){ $('#project-modal').classList.remove('hidden'); $('#project-error').textContent=''; }
function closeModal(id){ $(id).classList.add('hidden'); }
$('#new-project').onclick=openCreate; $('#empty-new').onclick=openCreate; $('#modal-close').onclick=()=>closeModal('#project-modal'); $('#detail-close').onclick=()=>closeModal('#detail-modal');
$('#project-modal').addEventListener('click',e=>{if(e.target.id==='project-modal')closeModal('#project-modal')});
$('#detail-modal').addEventListener('click',e=>{if(e.target.id==='detail-modal')closeModal('#detail-modal')});
$('#project-form').addEventListener('submit',async e=>{
  e.preventDefault(); const payload=Object.fromEntries(new FormData(e.currentTarget).entries());
  try { await api('/api/projects',{method:'POST',body:JSON.stringify(payload)}); closeModal('#project-modal'); e.currentTarget.reset(); await loadProjects(); toast('Projeto criado com sucesso!'); }
  catch(err){ $('#project-error').textContent=err.message; }
});
async function openProject(id){
  state.current=state.projects.find(p=>p.id===id); if(!state.current)return;
  $('#detail-title').textContent=state.current.title; $('#detail-concept').textContent=state.current.concept||'Sem descrição por enquanto.';
  $('#script-result').innerHTML=state.current.script?renderScript(state.current.script):'<p class="muted">Seu roteiro aparecerá aqui. Clique em “Criar roteiro com IA”.</p>';
  $('#video-controls').classList.toggle('hidden',!state.current.script);
  if(state.current.script) $('#video-prompt').value=state.current.script.scenes?.[0]?.visual_prompt||'';
  $('#detail-modal').classList.remove('hidden');
}
function renderScript(s){
  return '<div class="script-head"><span class="project-tag">ROTEIRO ORIGINAL</span><h3>'+escapeHtml(s.title||'Nova história')+'</h3><p>'+escapeHtml(s.synopsis||'')+'</p><p><b>Mensagem:</b> '+escapeHtml(s.moral||'')+'</p></div><div class="scene-list">'+(s.scenes||[]).map(scene=>'<article class="scene"><span class="scene-number">CENA '+escapeHtml(scene.number)+'</span><p>'+escapeHtml(scene.narration||'')+'</p><small>'+escapeHtml(scene.visual_prompt||'')+'</small></article>').join('')+'</div>';
}
$('#generate-script').onclick=async()=>{
  if(!state.current)return; const btn=$('#generate-script'); btn.disabled=true; btn.textContent='Criando roteiro...';
  try {
    const data=await api('/api/projects/'+state.current.id+'/script',{method:'POST',body:JSON.stringify({provider:'auto'})});
    state.current.script=data.script; $('#script-result').innerHTML=renderScript(data.script); $('#video-controls').classList.remove('hidden'); $('#video-prompt').value=data.script.scenes?.[0]?.visual_prompt||'';
    await loadProjects(); toast('Roteiro criado com '+data.provider.toUpperCase()+'!');
  } catch(err){ toast(err.message); }
  finally{btn.disabled=false;btn.textContent='✧ Criar roteiro com IA';}
};
$('#generate-video').onclick=async()=>{
  const btn=$('#generate-video'); btn.disabled=true; $('#video-status').textContent='Enviando solicitação para MiniMax...';
  try{
    const data=await api('/api/projects/'+state.current.id+'/video',{method:'POST',body:JSON.stringify({prompt:$('#video-prompt').value,duration:$('#video-duration').value})});
    $('#video-status').textContent='Cena enviada! ID da tarefa: '+data.taskId+'. Acompanhe o processamento.';
    const result=await api('/api/generations/'+data.id+'/refresh',{method:'POST',body:'{}'});
    $('#video-status').textContent=result.status==='completed'&&result.resultUrl?'Vídeo pronto: '+result.resultUrl:'Geração em andamento. Atualize a consulta em alguns instantes.';
    toast('Solicitação de vídeo enviada.');
  }catch(err){$('#video-status').textContent=err.message;}
  finally{btn.disabled=false;}
};
$('#delete-project').onclick=async()=>{
  if(!state.current||!confirm('Tem certeza de que deseja excluir este projeto?'))return;
  try{await api('/api/projects/'+state.current.id,{method:'DELETE'});closeModal('#detail-modal');await loadProjects();toast('Projeto excluído.');}
  catch(err){toast(err.message);}
};
async function boot(){
  if(!state.token){showAuth();return;}
  try{const me=await api('/api/me');state.user=me.user;await loadProjects();showApp();}
  catch{logout();}
}
boot();
