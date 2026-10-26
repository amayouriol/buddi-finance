const initialTransactions = [
  {id:1,title:'Groceries at Trader Joe’s',category:'Groceries',account:'BofA',date:'2026-10-25',amount:64.28,icon:'🛒',kind:'personal'},
  {id:2,title:'Dinner at Pizzeria Delfina',category:'Eating Out',account:'IBK TC',date:'2026-10-24',amount:86.40,icon:'🍝',kind:'shared',mine:28.8,friends:['Jamie','Sam']},
  {id:3,title:'Monthly internet',category:'Utilities',account:'BofA',date:'2026-10-23',amount:59.99,icon:'⌁',kind:'personal'},
  {id:4,title:'Lyft ride',category:'Transport',account:'Cash',date:'2026-10-22',amount:18.50,icon:'↗',kind:'personal'},
  {id:5,title:'Weekend cabin',category:'Travel',account:'BofA',date:'2026-10-20',amount:240,icon:'⌂',kind:'shared',mine:80,friends:['Jamie','Maya']},
  {id:6,title:'Coffee & pastry',category:'Eating Out',account:'Cash',date:'2026-10-19',amount:12.75,icon:'☕',kind:'personal'},
  {id:7,title:'Household supplies',category:'House',account:'IBK TC',date:'2026-10-18',amount:42.30,icon:'⌂',kind:'personal'},
  {id:8,title:'Movie night tickets',category:'Fun',account:'BofA',date:'2026-10-17',amount:48,icon:'✳',kind:'shared',mine:16,friends:['Sam','Maya']}
];
const initialFriends = [
  {name:'Jamie Chen',initial:'J',color:'coral',note:'Cabin weekend · Oct 20',amount:68.40,owes:true},
  {name:'Sam Rivera',initial:'S',color:'lavender',note:'Dinner · Oct 24',amount:28.80,owes:true},
  {name:'Maya Patel',initial:'M',color:'yellow',note:'Movie night · Oct 17',amount:16.00,owes:true},
  {name:'Jordan Lee',initial:'J',color:'blue',note:'Brunch · Oct 12',amount:15.20,owes:true},
  {name:'Taylor Kim',initial:'T',color:'green',note:'Cab fare · Oct 21',amount:24.00,owes:false},
  {name:'Chris Park',initial:'C',color:'coral',note:'Concert tickets · Oct 18',amount:22.20,owes:false}
];
const categories = [
  {name:'Groceries',value:36,color:'#6eaa7d',icon:'🛒'},
  {name:'Eating Out',value:19,color:'#e8bb64',icon:'🍽'},
  {name:'Transport',value:14,color:'#8da5c9',icon:'↗'},
  {name:'House',value:14,color:'#d8917c',icon:'⌂'},
  {name:'Fun',value:9,color:'#a18dc2',icon:'✳'}
];
const budgets = [
  {name:'Groceries',spent:482.35,total:650,color:'#6eaa7d',icon:'🛒'},
  {name:'Eating out',spent:318.20,total:450,color:'#e8bb64',icon:'🍽'},
  {name:'Transport',spent:148.60,total:250,color:'#8da5c9',icon:'↗'},
  {name:'Fun & experiences',spent:216.10,total:350,color:'#a18dc2',icon:'✳'}
];
const state = {
  transactions: JSON.parse(localStorage.getItem('buddi-transactions') || 'null') || initialTransactions,
  friends: JSON.parse(localStorage.getItem('buddi-friends') || 'null') || initialFriends,
  entryKind:'personal'
};
const money = n => '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const dateLabel = d => {const date=new Date(d+'T12:00:00');return date.toLocaleDateString('en-US',{month:'short',day:'numeric'});};
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function persist(){localStorage.setItem('buddi-transactions',JSON.stringify(state.transactions));localStorage.setItem('buddi-friends',JSON.stringify(state.friends));}
function getPersonalMonthlySpend(){return state.transactions.filter(t=>t.kind==='personal'||t.kind==='shared').reduce((sum,t)=>sum+(t.kind==='shared'?Number(t.mine||t.amount):Number(t.amount)),0);}
function renderAccounts(){document.getElementById('account-list').innerHTML=[['BofA','$4,280'],['IBK TC','$2,163'],['Cash','$386'],['Checking','$1,600']].map(([n,b])=>`<div class="account-item"><span class="account-dot"></span>${n}<small>${b}</small></div>`).join('');}
function rowMarkup(t){const shared=t.kind==='shared';const icons={Groceries:'🛒','Eating Out':'🍽',Utilities:'⌁',Transport:'↗',House:'⌂',Fun:'✳',Travel:'⌂'};let icon=t.icon||icons[t.category]||'•';let cls=shared?'icon-split':t.category==='Groceries'?'icon-food':t.category==='House'||t.category==='Utilities'?'icon-house':t.category==='Transport'?'icon-car':'icon-fun';let amount=shared?Number(t.mine||t.amount):Number(t.amount);return `<div class="transaction-row"><div class="transaction-icon ${cls}">${icon}</div><div class="transaction-info"><strong>${esc(t.title)}${shared?'<span class="shared-tag">SHARED</span>':''}</strong><small>${esc(t.category)} · ${esc(t.account)} · ${dateLabel(t.date)}</small></div><div class="transaction-meta"><strong>−${money(amount)}</strong><small>${shared?`Total ${money(t.amount)}`:esc(t.kind||'Personal')}</small></div></div>`;}
function renderTransactions(){const recent=document.getElementById('recent-transactions');const all=document.getElementById('all-transactions');if(recent)recent.innerHTML=state.transactions.slice(0,7).map(rowMarkup).join('');if(all)all.innerHTML=state.transactions.map(rowMarkup).join('');}
function renderLegend(){const el=document.getElementById('category-legend');el.innerHTML=categories.map(c=>`<div class="legend-row"><span class="legend-dot" style="background:${c.color}"></span>${c.name}<strong>${c.value}%</strong></div>`).join('');}
function renderActivities(){const entries=[['J','coral','Jamie','added the cabin weekend','2 hours ago'],['S','lavender','Sam','settled up for brunch','Yesterday'],['M','yellow','Maya','added movie tickets','2 days ago']];document.getElementById('shared-activity').innerHTML=entries.map(a=>`<div class="activity-item"><span class="activity-avatar ${a[1]}">${a[0]}</span><div class="activity-copy"><strong>${a[2]}</strong> ${a[3]}<small>${a[4]}</small></div></div>`).join('');}
function renderFriends(){document.getElementById('friend-list').innerHTML=state.friends.map(f=>`<div class="friend-row"><span class="friend-avatar ${f.color}">${f.initial}</span><span class="friend-name"><strong>${esc(f.name)}</strong><small>${esc(f.note)}</small></span><span class="friend-balance"><strong class="${f.owes?'positive':''}">${f.owes?'Owes you':'You owe'} ${money(f.amount)}</strong><button class="settle-button" data-friend="${esc(f.name)}">${f.owes?'Remind':'Settle up'}</button></span></div>`).join('');document.getElementById('shared-count').textContent=state.friends.filter(f=>f.owes).length;}
function renderBudgets(){document.getElementById('budget-grid').innerHTML=budgets.map(b=>`<article class="budget-card"><div class="budget-top"><strong>${b.icon} &nbsp;${b.name}</strong><small>${Math.round(b.spent/b.total*100)}% used</small></div><div class="budget-amount">${money(b.spent)} <small>of ${money(b.total)}</small></div><div class="budget-bar"><span style="width:${Math.min(100,b.spent/b.total*100)}%;background:${b.color}"></span></div></article>`).join('');}
function renderAll(){renderAccounts();renderTransactions();renderLegend();renderActivities();renderFriends();renderBudgets();}
document.getElementById('today-label').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).toUpperCase();
function setView(view){document.querySelectorAll('.view-panel').forEach(p=>p.classList.add('hidden'));document.getElementById(view+'-view')?.classList.remove('hidden');document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const labels={overview:'Overview',transactions:'Transactions',shared:'Shared with you',budgets:'Budgets'};document.getElementById('breadcrumb-title').textContent=labels[view]||'Overview';document.getElementById('sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'smooth'});}
function openModal(kind='personal'){document.getElementById('transaction-modal').classList.remove('hidden');document.body.style.overflow='hidden';setKind(kind);document.getElementById('date').value=new Date().toISOString().slice(0,10);setTimeout(()=>document.getElementById('description').focus(),80);}
function closeModal(){document.getElementById('transaction-modal').classList.add('hidden');document.body.style.overflow='';document.getElementById('expense-form').reset();document.getElementById('shared-fields').classList.add('hidden');document.getElementById('form-error').classList.add('hidden');setKind('personal');}
function setKind(k){state.entryKind=k;document.querySelectorAll('.entry-tab').forEach(b=>b.classList.toggle('active',b.dataset.entry===k));document.getElementById('shared-fields').classList.toggle('hidden',k!=='shared');document.getElementById('modal-title').textContent=k==='shared'?'Split an expense':'Add a transaction';}
function showToast(text){const t=document.getElementById('toast');t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600);}
function updateSplitPreview(){const total=Number(document.getElementById('amount').value||0);const mine=Number(document.getElementById('my-share').value||0);const rest=total-mine;document.getElementById('split-preview').textContent=total&&mine<=total?`Your share ${money(mine)} · ${money(Math.max(0,rest))} to Splitwise`:'Enter a total and your share to preview the split.';}
document.querySelectorAll('.nav-item,[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
document.getElementById('mobile-menu').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('add-expense').addEventListener('click',()=>openModal());document.getElementById('add-expense-transactions').addEventListener('click',()=>openModal());document.getElementById('add-shared-expense').addEventListener('click',()=>openModal('shared'));
document.getElementById('close-modal').addEventListener('click',closeModal);document.getElementById('cancel-modal').addEventListener('click',closeModal);document.getElementById('transaction-modal').addEventListener('click',e=>{if(e.target.id==='transaction-modal')closeModal()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
document.querySelectorAll('.entry-tab').forEach(b=>b.addEventListener('click',()=>setKind(b.dataset.entry)));
document.getElementById('amount').addEventListener('input',updateSplitPreview);document.getElementById('my-share').addEventListener('input',updateSplitPreview);
document.getElementById('expense-form').addEventListener('submit',e=>{e.preventDefault();const error=document.getElementById('form-error');error.classList.add('hidden');const amount=Number(document.getElementById('amount').value);const mine=Number(document.getElementById('my-share').value);if(state.entryKind==='shared'&&(!document.getElementById('friends').value.trim()||mine>amount||mine<=0)){error.textContent='Add at least one friend and a valid personal share before saving.';error.classList.remove('hidden');return;}const title=document.getElementById('description').value.trim();const category=document.getElementById('category').value;const account=document.getElementById('account').value;const date=document.getElementById('date').value;const friends=document.getElementById('friends').value.split(',').map(x=>x.trim()).filter(Boolean);state.transactions.unshift({id:Date.now(),title,category,account,date,amount,icon:category==='Groceries'?'🛒':category==='Eating Out'?'🍽':category==='Transport'?'↗':'✳',kind:state.entryKind,mine:state.entryKind==='shared'?mine:amount,friends});if(state.entryKind==='shared'){const sharePerPerson=(amount-mine)/Math.max(friends.length,1);friends.forEach(name=>{const found=state.friends.find(f=>f.name.toLowerCase().startsWith(name.toLowerCase()));if(found){found.amount=Number((found.amount+sharePerPerson).toFixed(2));found.owes=true;found.note=title+' · '+dateLabel(date)}else state.friends.unshift({name,initial:name.charAt(0).toUpperCase(),color:['coral','lavender','yellow','blue','green'][state.friends.length%5],note:title+' · '+dateLabel(date),amount:Number(sharePerPerson.toFixed(2)),owes:true})});}persist();renderAll();closeModal();showToast(state.entryKind==='shared'?'Shared expense saved — balances updated.':'Expense saved. Nice and easy.');});
document.getElementById('transaction-search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.getElementById('all-transactions').innerHTML=state.transactions.filter(t=>(t.title+' '+t.category+' '+t.account).toLowerCase().includes(q)).map(rowMarkup).join('')});
document.getElementById('friend-list').addEventListener('click',e=>{const btn=e.target.closest('[data-friend]');if(!btn)return;const f=state.friends.find(x=>x.name===btn.dataset.friend);if(!f)return;if(f.owes){showToast(`Reminder ready for ${f.name.split(' ')[0]}.`)}else{f.amount=0;f.note='Settled just now';persist();renderFriends();showToast('Marked as settled.');}});
document.getElementById('invite-friend').addEventListener('click',()=>{const name=prompt('Friend’s name');if(name){state.friends.push({name,initial:name[0].toUpperCase(),color:'green',note:'Just joined your circle',amount:0,owes:true});persist();renderFriends();showToast(`${name} added to your circle.`)}});
document.getElementById('add-account').addEventListener('click',()=>showToast('Account setup is coming soon.'));
document.getElementById('add-budget').addEventListener('click',()=>showToast('Budget setup is coming soon.'));
document.getElementById('learn-more').addEventListener('click',()=>showToast('One calm home for your money and your people.'));
document.getElementById('search-toggle').addEventListener('click',()=>{setView('transactions');document.getElementById('transaction-search').focus()});
document.getElementById('help-button').addEventListener('click',()=>showToast('Buddi is a demo concept. No real accounts are connected.'));
document.getElementById('voice-button').addEventListener('click',()=>{const status=document.getElementById('voice-status');const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition){status.textContent='Voice input is not supported in this browser. Type your expense instead.';return;}const recognition=new Recognition();recognition.lang='en-US';recognition.interimResults=false;status.textContent='Listening…';recognition.onresult=e=>{const phrase=e.results[0][0].transcript;status.textContent='Heard: “'+phrase+'” — review the fields before saving.';const amountMatch=phrase.match(/(?:\$\s*)?(\d+(?:\.\d{1,2})?)/);if(amountMatch)document.getElementById('amount').value=amountMatch[1];document.getElementById('description').value=phrase.replace(/(?:\$\s*)?\d+(?:\.\d{1,2})?/,'').replace(/\b(spent|paid|for|on|at|today|yesterday|dollars?)\b/gi,'').replace(/\s+/g,' ').trim()||phrase;updateSplitPreview();};recognition.onerror=()=>status.textContent='Could not hear that clearly. Please type the details.';recognition.start();});
renderAll();

