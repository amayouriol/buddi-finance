const db = window.buddiSupabase;
const state = { user: null, accounts: [], groups: [], members: [], transactions: [], friends: [], entryKind: 'personal', myShareEdited: false, authStep: 'email', onboardingCompleted: false, onboardingStep: 0, onboardingFinishing: false };
let installPrompt = null;
const categories = [
  { name: 'Groceries', color: '#6eaa7d', icon: '🛒' }, { name: 'Eating Out', color: '#e8bb64', icon: '🍽' },
  { name: 'Transport', color: '#8da5c9', icon: '↗' }, { name: 'House', color: '#d8917c', icon: '⌂' },
  { name: 'Fun', color: '#a18dc2', icon: '✳' }, { name: 'Life style', color: '#94aaa0', icon: '•' },
  { name: 'Utilities', color: '#9aa6b8', icon: '⌁' }, { name: 'Other expense', color: '#b4a28f', icon: '•' }
];
const money = (amount, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount) || 0);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const dateLabel = value => new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' });
const monthKey = value => String(value).slice(0, 7);
const currentMonth = new Date().toISOString().slice(0, 7);
const accountFor = id => state.accounts.find(account => account.id === id);
const groupFor = id => state.groups.find(group => group.id === id);
const memberFor = id => state.members.find(member => member.id === id);
const splitCents = (amount, count) => { const cents = Math.max(0, Math.round(Number(amount) * 100)); const base = Math.floor(cents / count); const rem = cents % count; return Array.from({ length:count }, (_, i) => (base + (i < rem ? 1 : 0)) / 100); };
const participantNames = () => { const seen = new Set(); return document.getElementById('friends').value.split(',').map(v => v.trim()).filter(v => { const k = v.toLowerCase(); if (!v || seen.has(k)) return false; seen.add(k); return true; }); };

function setBusy(button, busy, label) { button.disabled = busy; if (label) button.innerHTML = busy ? 'Please wait…' : label; }
function showAuthError(message) { const box = document.getElementById('auth-error'); box.textContent = message; box.classList.remove('hidden'); }
function showAuth() { document.getElementById('app-shell').classList.add('hidden'); document.getElementById('auth-gate').classList.remove('hidden'); }
function setAuthStep(step) {
  state.authStep = step;
  const codeStep = step === 'code';
  document.getElementById('auth-title').textContent = codeStep ? 'Check your local inbox' : 'Sign in to your space';
  document.getElementById('auth-description').textContent = codeStep ? 'Enter the one-time code sent to ' + document.getElementById('auth-email').value.trim() + '.' : 'Enter your email. We’ll send a one-time code to the local inbox.';
  document.getElementById('auth-email-field').classList.toggle('hidden', codeStep);
  document.getElementById('auth-code-field').classList.toggle('hidden', !codeStep);
  document.getElementById('auth-code').required = codeStep;
  document.getElementById('mailpit-link').classList.toggle('hidden', !codeStep);
  document.getElementById('auth-submit').innerHTML = codeStep ? 'Verify code <span>→</span>' : 'Send sign-in code <span>→</span>';
  document.getElementById('auth-error').classList.add('hidden');
}

async function beginAuthentication(event) {
  event.preventDefault();
  const button = document.getElementById('auth-submit');
  const original = state.authStep === 'email' ? 'Send sign-in code →' : 'Verify code →';
  setBusy(button, true);
  try {
    const email = document.getElementById('auth-email').value.trim().toLowerCase();
    if (state.authStep === 'email') {
      const result = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (result.error) throw result.error;
      setAuthStep('code');
      document.getElementById('auth-code').focus();
    } else {
      const result = await db.auth.verifyOtp({ email, token: document.getElementById('auth-code').value.trim(), type: 'email' });
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error('No session was returned. Check the code and try again.');
      await openWorkspace(result.data.session);
    }
  } catch (error) { showAuthError(error.message || 'Could not sign in. Try again.'); }
  finally { setBusy(button, false, original); }
}

async function openWorkspace(session) {
  document.getElementById('auth-gate').classList.add('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  state.user = session.user;
  try {
    const profile = await db.from('profiles').upsert({ id:session.user.id, locale:navigator.language?.slice(0, 2) || 'en', default_currency:'USD' }, { onConflict:'id', ignoreDuplicates:true });
    if (profile.error) throw profile.error;
    const profileResult = await db.from('profiles').select('onboarding_completed_at').eq('id', session.user.id).single();
    if (profileResult.error) throw profileResult.error;
    state.onboardingCompleted = Boolean(profileResult.data.onboarding_completed_at);
    await loadWorkspaceData();
    if (state.onboardingCompleted && !state.accounts.length) {
      await ensureStarterAccount();
      await loadWorkspaceData();
    }
    const name = (session.user.email || 'Buddi owner').split('@')[0].replace(/[._-]+/g, ' ').trim() || 'Buddi owner';
    const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'B';
    document.getElementById('owner-name').textContent = name.split(' ')[0];
    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-avatar').textContent = initials;
    document.getElementById('top-avatar').textContent = initials;
    document.querySelector('.workspace-avatar').textContent = initials.charAt(0) || 'B';
    document.querySelector('.workspace-name strong').textContent = name + "'s space";
    renderAll();
    document.getElementById('app-shell').classList.remove('hidden');
    if (!state.onboardingCompleted) openSetup(0);
  } catch (error) {
    showAuth();
    showAuthError('Could not load your local workspace: ' + (error.message || error));
  }
}

async function ensureStarterAccount() {
  const result = await db.from('accounts').select('id').limit(1);
  if (result.error) throw result.error;
  if (result.data.length) return;
  const inserted = await db.from('accounts').insert({ name:'Cash', currency:'USD', opening_balance:0 });
  if (inserted.error) throw inserted.error;
}

async function loadWorkspaceData() {
  const results = await Promise.all([
    db.from('accounts').select('*').eq('is_active', true).order('created_at'),
    db.from('groups').select('*').order('created_at', { ascending:false }),
    db.from('group_members').select('*').order('created_at'),
    db.from('transactions').select('*').eq('status', 'posted').order('occurred_at', { ascending:false }),
    db.from('transaction_splits').select('*')
  ]);
  for (const result of results) if (result.error) throw result.error;
  const [accounts, groups, members, transactions, splits] = results.map(result => result.data);
  state.accounts = accounts;
  state.members = members;
  state.groups = groups.map(group => Object.assign({}, group, { members:members.filter(member => member.group_id === group.id) }));
  const splitMap = new Map();
  for (const split of splits) { const rows = splitMap.get(split.transaction_id) || []; rows.push(split); splitMap.set(split.transaction_id, rows); }
  state.transactions = transactions.map(row => {
    const own = accountFor(row.account_id);
    const group = groupFor(row.group_id);
    const payer = memberFor(row.payer_member_id);
    const txSplits = splitMap.get(row.id) || [];
    const ownerSplit = txSplits.find(split => split.is_owner);
    return {
      id:row.id, title:row.description, category:row.category || 'Other expense', account:own?.name || '', accountId:row.account_id,
      currency:row.currency, date:String(row.occurred_at).slice(0, 10), amount:Number(row.amount),
      kind:row.type === 'shared_expense' ? 'shared' : 'personal', mine:Number(ownerSplit?.share_amount ?? row.amount),
      friends:txSplits.filter(split => !split.is_owner).map(split => memberFor(split.group_member_id)?.display_name).filter(Boolean),
      groupName:group?.name || '', payerName:payer?.display_name || 'You', payerMemberId:row.payer_member_id,
      groupId:row.group_id, splits:txSplits.filter(split => !split.is_owner)
    };
  });
  calculateFriendBalances();
}

function calculateFriendBalances() {
  const balances = new Map();
  for (const tx of state.transactions) {
    if (tx.kind !== 'shared') continue;
    if (tx.payerMemberId) {
      const payer = memberFor(tx.payerMemberId);
      if (payer) balances.set(payer.display_name, (balances.get(payer.display_name) || 0) - tx.mine);
    } else {
      for (const split of tx.splits) { const friend = memberFor(split.group_member_id); if (friend) balances.set(friend.display_name, (balances.get(friend.display_name) || 0) + Number(split.share_amount)); }
    }
  }
  const colors = ['coral', 'lavender', 'yellow', 'blue', 'green'];
  state.friends = [...balances].filter(([, balance]) => Math.abs(balance) >= 0.005).map(([name, balance], index) => ({
    name, initial:name.charAt(0).toUpperCase(), color:colors[index % colors.length], note:'Shared expenses',
    amount:Math.abs(balance), owes:balance >= 0, balance
  }));
}

function accountBalance(account) {
  let balance = Number(account.opening_balance || 0);
  for (const tx of state.transactions) if (tx.accountId === account.id) balance -= tx.amount;
  return balance;
}

function renderAccounts() {
  document.getElementById('account-list').innerHTML = state.accounts.map(account =>
    '<div class="account-item"><span class="account-dot"></span>' + esc(account.name) + '<small>' + money(accountBalance(account), account.currency) + '</small></div>'
  ).join('');
  document.getElementById('account').innerHTML = state.accounts.map(account =>
    '<option value="' + esc(account.id) + '">' + esc(account.name) + ' · ' + esc(account.currency) + '</option>'
  ).join('');
}

function renderGroupOptions() {
  document.getElementById('group-options').innerHTML = state.groups.map(group => '<option value="' + esc(group.name) + '"></option>').join('');
}
function renderGroups() {
  const list = document.getElementById('group-list');
  if (!state.groups.length) {
    list.innerHTML = '<div class="group-empty">No groups yet. Create one for a household, trip, or event, then add shared expenses to it. <button type="button" data-create-group>Create your first group</button></div>';
    return;
  }
  list.innerHTML = '<div class="group-list">' + state.groups.map(group =>
    '<article class="group-card"><span class="group-icon">⌂</span><span class="group-card-copy"><strong>' + esc(group.name) + '</strong><small>' + group.members.length + ' ' + (group.members.length === 1 ? 'person' : 'people') + '</small></span><button type="button" class="group-expense-button" data-use-group="' + esc(group.name) + '">Add expense →</button></article>'
  ).join('') + '</div>';
}
function rowMarkup(tx) {
  const shared = tx.kind === 'shared';
  const category = categories.find(item => item.name === tx.category);
  const detail = shared
    ? 'Total ' + money(tx.amount, tx.currency) + ' · ' + esc(tx.groupName || 'Shared') + ' · ' + esc(tx.account ? 'from ' + tx.account : 'no personal account movement') + ' · paid by ' + esc(tx.payerName) + ' · ' + dateLabel(tx.date)
    : esc(tx.account || 'Personal') + ' · ' + dateLabel(tx.date);
  return '<div class="transaction-row"><div class="transaction-icon ' + (shared ? 'icon-split' : 'icon-food') + '">' + (category?.icon || '•') + '</div><div class="transaction-info"><strong>' + esc(tx.title) + (shared ? '<span class="shared-tag">SHARED</span>' : '') + '</strong><small>' + esc(tx.category) + ' · ' + detail + '</small></div><div class="transaction-meta"><strong>−' + money(shared ? tx.mine : tx.amount, tx.currency) + '</strong><small>' + (shared ? 'Your share' : 'Personal') + '</small></div></div>';
}
function renderTransactions() {
  const empty = '<div class="empty-state">No transactions yet. Add one to start your personal ledger.</div>';
  document.getElementById('recent-transactions').innerHTML = state.transactions.length ? state.transactions.slice(0, 7).map(rowMarkup).join('') : empty;
  document.getElementById('all-transactions').innerHTML = state.transactions.length ? state.transactions.map(rowMarkup).join('') : empty;
}
function personalSpend(tx) { return tx.kind === 'shared' ? tx.mine : tx.amount; }

function renderSummary() {
  const totalBalance = state.accounts.reduce((sum, account) => sum + accountBalance(account), 0);
  const monthly = state.transactions.filter(tx => monthKey(tx.date) === currentMonth);
  const spent = monthly.reduce((sum, tx) => sum + personalSpend(tx), 0);
  const owed = state.friends.filter(friend => friend.balance > 0).reduce((sum, friend) => sum + friend.balance, 0);
  const due = state.friends.filter(friend => friend.balance < 0).reduce((sum, friend) => sum + Math.abs(friend.balance), 0);
  const currency = state.accounts[0]?.currency || 'USD';
  document.getElementById('total-balance').textContent = money(totalBalance, currency);
  document.getElementById('spent-total').textContent = money(spent, currency);
  document.getElementById('spend-caption').textContent = money(spent, currency);
  document.getElementById('spend-period').textContent = new Date().toLocaleDateString('en-US', { month:'long', year:'numeric' });
  document.getElementById('owed-total').textContent = money(owed, currency);
  document.getElementById('owed-caption').textContent = state.friends.filter(friend => friend.balance > 0).length + ' people owe you';
  document.getElementById('shared-owed').textContent = money(owed, currency);
  document.getElementById('shared-due').textContent = money(due, currency);
  document.getElementById('shared-owed-count').textContent = state.friends.filter(friend => friend.balance > 0).length + ' people';
  document.getElementById('shared-due-count').textContent = state.friends.filter(friend => friend.balance < 0).length + ' people';
  document.getElementById('spend-progress-bar').style.width = '0%';
}

function renderLegend() {
  const monthly = state.transactions.filter(tx => monthKey(tx.date) === currentMonth);
  const totals = new Map();
  for (const tx of monthly) totals.set(tx.category, (totals.get(tx.category) || 0) + personalSpend(tx));
  const total = [...totals.values()].reduce((sum, amount) => sum + amount, 0);
  const active = categories.filter(category => (totals.get(category.name) || 0) > 0);
  document.getElementById('chart-total').textContent = money(total, state.accounts[0]?.currency || 'USD');
  if (!active.length) {
    document.getElementById('category-legend').innerHTML = '<div class="empty-state">Your category breakdown will appear here.</div>';
    document.getElementById('spend-donut').style.background = 'conic-gradient(#e9eee9 0 100%)';
    return;
  }
  let stop = 0;
  const segments = active.map(category => { const start = stop; stop += totals.get(category.name) / total * 100; return category.color + ' ' + start + '% ' + stop + '%'; });
  document.getElementById('spend-donut').style.background = 'conic-gradient(' + segments.join(',') + ')';
  document.getElementById('category-legend').innerHTML = active.map(category =>
    '<div class="legend-row"><span class="legend-dot" style="background:' + category.color + '"></span>' + esc(category.name) + '<strong>' + Math.round(totals.get(category.name) / total * 100) + '%</strong></div>'
  ).join('');
}
function renderActivities() {
  const entries = state.transactions.filter(tx => tx.kind === 'shared').slice(0, 3);
  document.getElementById('shared-activity').innerHTML = entries.length ? entries.map((tx, index) =>
    '<div class="activity-item"><span class="activity-avatar ' + ['coral', 'lavender', 'yellow'][index] + '">' + esc(tx.payerName.charAt(0).toUpperCase()) + '</span><div class="activity-copy"><strong>' + esc(tx.payerName) + '</strong> recorded ' + esc(tx.title) + '<small>' + esc(tx.groupName) + ' · ' + dateLabel(tx.date) + '</small></div></div>'
  ).join('') : '<div class="empty-state">Shared expenses will show here after you record one.</div>';
}
function renderFriends() {
  const list = document.getElementById('friend-list');
  list.innerHTML = state.friends.length ? state.friends.map(friend => {
    const balance = Number(friend.balance || 0);
    return '<div class="friend-row"><span class="friend-avatar ' + friend.color + '">' + esc(friend.initial) + '</span><span class="friend-name"><strong>' + esc(friend.name) + '</strong><small>' + esc(friend.note) + '</small></span><span class="friend-balance"><strong class="' + (balance > 0 ? 'positive' : '') + '">' + (balance > 0 ? 'Owes you ' : 'You owe ') + money(Math.abs(balance)) + '</strong><button class="settle-button" type="button" disabled title="Settlement recording is not connected yet">Settlement soon</button></span></div>';
  }).join('') : '<div class="empty-state">People and balances appear here when you add a shared expense to a group.</div>';
  document.getElementById('shared-count').textContent = state.friends.filter(friend => friend.balance > 0).length;
}
function renderBudgets() { document.getElementById('budget-grid').innerHTML = '<div class="empty-state">Budgets are not connected to the local database yet.</div>'; }
function renderAll() { renderAccounts(); renderTransactions(); renderLegend(); renderActivities(); renderFriends(); renderBudgets(); renderGroupOptions(); renderGroups(); renderSummary(); }

function openSetup(step = 0) {
  state.onboardingStep = step;
  document.getElementById('setup-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  renderSetupStep();
}
function closeSetup() {
  document.getElementById('setup-modal').classList.add('hidden');
  document.body.style.overflow = '';
}
async function skipSetup() {
  try {
    if (!state.accounts.length) {
      const inserted = await db.from('accounts').insert({ name:'Cash', currency:'USD', opening_balance:0 });
      if (inserted.error) throw inserted.error;
      await loadWorkspaceData();
      renderAll();
    }
    await completeOnboarding();
    showToast('Setup skipped. Reopen Help any time.');
  } catch (error) { setupError(error.message || 'Could not skip setup.'); }
}
function renderSetupStep() {
  const step = state.onboardingStep;
  const titles = ['Set up your first account', 'Create a group', 'You’re ready to go'];
  const descriptions = [
    state.accounts.length ? 'Your account is ready. You can add other accounts now or later.' : 'Choose where you keep your money. You can add more accounts any time.',
    'Groups keep shared expenses organized. Add one now or skip this step.',
    'Start with a transaction, or finish setup and explore Buddi first.'
  ];
  document.getElementById('setup-kicker').textContent = 'STEP ' + (step + 1) + ' OF 3';
  document.getElementById('setup-title').textContent = titles[step];
  document.getElementById('setup-description').textContent = descriptions[step];
  document.querySelectorAll('[data-setup-progress]').forEach(item => item.classList.toggle('complete', Number(item.dataset.setupProgress) <= step));
  document.getElementById('setup-error').classList.add('hidden');

  if (step === 0 && state.accounts.length) {
    document.getElementById('setup-content').innerHTML = '<div class="setup-account-list">' + state.accounts.map(account => '<div class="setup-account-row"><span class="account-dot"></span><span><strong>' + esc(account.name) + '</strong><small>' + esc(account.currency) + ' · starting balance ' + money(account.opening_balance, account.currency) + '</small></span></div>').join('') + '</div>';
    document.getElementById('setup-actions').innerHTML = '<button class="setup-link" type="button" data-setup-close>Do this later</button><button class="primary-button" type="button" data-setup-next>Continue <span>→</span></button>';
  } else if (step === 0) {
    document.getElementById('setup-content').innerHTML = '<form id="setup-account-form"><label class="field-label">Account name<input name="name" placeholder="Cash" value="Cash" required /></label><div class="form-row"><label class="field-label">Currency<select name="currency"><option value="USD">USD · US Dollar</option><option value="PEN">PEN · Peruvian Sol</option></select></label><label class="field-label">Starting balance<input name="balance" type="number" step="0.01" value="0.00" required /></label></div></form>';
    document.getElementById('setup-actions').innerHTML = '<button class="setup-link" type="button" data-setup-close>Do this later</button><button class="primary-button" type="submit" form="setup-account-form">Save account <span>→</span></button>';
    document.getElementById('setup-account-form').addEventListener('submit', saveSetupAccount);
  } else if (step === 1) {
    document.getElementById('setup-content').innerHTML = '<form id="setup-group-form"><label class="field-label">Group name <small class="field-hint">Optional</small><input name="name" placeholder="e.g. Home or Peru trip" /></label><label class="field-label">People in this group <small class="field-hint">Separate names with commas.</small><input name="members" placeholder="e.g. Jamie, Sam" /></label></form>';
    document.getElementById('setup-actions').innerHTML = '<button class="setup-link" type="button" data-setup-back>Back</button><button class="setup-link" type="button" data-setup-skip>Skip group</button><button class="primary-button" type="button" data-setup-group-next>Continue <span>→</span></button>';
  } else {
    document.getElementById('setup-content').innerHTML = '<div class="setup-ready"><span class="setup-ready-icon">✓</span><div><strong>Your workspace is ready</strong><small>Your entries stay in your private Buddi ledger.</small></div></div>';
    document.getElementById('setup-actions').innerHTML = '<button class="setup-link" type="button" data-setup-back>Back</button><button class="setup-link" type="button" data-setup-finish>Finish setup</button><button class="primary-button" type="button" data-setup-transaction>' + (state.transactions.length ? 'Add a transaction' : 'Add first transaction') + ' <span>→</span></button>';
  }
}
function setupError(message) {
  const box = document.getElementById('setup-error');
  box.textContent = message;
  box.classList.remove('hidden');
}
async function saveSetupAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const balance = Number(data.get('balance'));
  if (!name || !Number.isFinite(balance)) { setupError('Enter a name and a valid starting balance.'); return; }
  const button = document.querySelector('#setup-actions button[type="submit"]');
  setBusy(button, true);
  try {
    const inserted = await db.from('accounts').insert({ name, currency:data.get('currency'), opening_balance:balance }).select().single();
    if (inserted.error) throw inserted.error;
    await loadWorkspaceData();
    renderAll();
    state.onboardingStep = 1;
    renderSetupStep();
  } catch (error) { setupError(error.message || 'Could not save this account.'); }
  finally { if (button.isConnected) setBusy(button, false, 'Save account →'); }
}
async function continueSetupWithGroup() {
  const form = document.getElementById('setup-group-form');
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  if (name && state.groups.some(group => group.name.toLowerCase() === name.toLowerCase())) {
    setupError('A group with this name already exists. Choose another name or skip this step.');
    return;
  }
  const button = document.querySelector('[data-setup-group-next]');
  setBusy(button, true);
  try {
    if (name) {
      const names = [...new Map(String(data.get('members') || '').split(',').map(value => value.trim()).filter(Boolean).map(value => [value.toLowerCase(), value])).values()];
      await findOrCreateGroup(name, names);
      renderAll();
    }
    state.onboardingStep = 2;
    renderSetupStep();
  } catch (error) { setupError(error.message || 'Could not create this group.'); }
  finally { if (button.isConnected) setBusy(button, false, 'Continue →'); }
}
async function completeOnboarding() {
  const result = await db.from('profiles').update({ onboarding_completed_at:new Date().toISOString() }).eq('id', state.user.id);
  if (result.error) throw result.error;
  state.onboardingCompleted = true;
  closeSetup();
}

function openAccountModal() {
  document.getElementById('account-form').reset();
  document.getElementById('new-account-balance').value = '0.00';
  document.getElementById('account-form-error').classList.add('hidden');
  document.getElementById('account-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('new-account-name').focus(), 80);
}
function closeAccountModal() {
  document.getElementById('account-modal').classList.add('hidden');
  document.body.style.overflow = '';
}
async function saveAccount(event) {
  event.preventDefault();
  const name = document.getElementById('new-account-name').value.trim();
  const currency = document.getElementById('new-account-currency').value;
  const balance = Number(document.getElementById('new-account-balance').value);
  const errorBox = document.getElementById('account-form-error');
  errorBox.classList.add('hidden');
  if (!name || !Number.isFinite(balance)) { errorBox.textContent = 'Enter an account name and a valid starting balance.'; errorBox.classList.remove('hidden'); return; }
  if (state.accounts.some(account => account.name.toLowerCase() === name.toLowerCase())) { errorBox.textContent = 'An account with this name already exists.'; errorBox.classList.remove('hidden'); return; }
  const button = document.querySelector('#account-form button[type="submit"]');
  setBusy(button, true);
  try {
    const inserted = await db.from('accounts').insert({ name, currency, opening_balance:balance });
    if (inserted.error) throw inserted.error;
    await loadWorkspaceData();
    renderAll();
    closeAccountModal();
    showToast(name + ' account added.');
  } catch (error) { errorBox.textContent = error.message || 'Could not save this account.'; errorBox.classList.remove('hidden'); }
  finally { setBusy(button, false, 'Save account →'); }
}

function setView(view) {
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.add('hidden'));
  document.getElementById(view + '-view')?.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const labels = { overview:'Overview', transactions:'Transactions', shared:'Shared with you', budgets:'Budgets' };
  document.getElementById('breadcrumb-title').textContent = labels[view] || 'Overview';
  document.getElementById('sidebar').classList.remove('open');
  window.scrollTo({ top:0, behavior:'smooth' });
}
function openModal(kind = 'personal', groupName = '') {
  document.getElementById('transaction-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  state.myShareEdited = false;
  setKind(kind);
  document.getElementById('date').value = new Date().toISOString().slice(0, 10);
  renderGroupOptions();
  if (groupName) {
    document.getElementById('group-name').value = groupName;
    const group = state.groups.find(item => item.name.toLowerCase() === groupName.toLowerCase());
    if (group?.members?.length) document.getElementById('friends').value = group.members.map(member => member.display_name).join(', ');
  }
  updateSplitPreview();
  setTimeout(() => document.getElementById('description').focus(), 80);
}
function closeModal() {
  document.getElementById('transaction-modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('expense-form').reset();
  document.getElementById('form-error').classList.add('hidden');
  state.myShareEdited = false;
  state.onboardingFinishing = false;
  setKind('personal');
}
function openGroupModal() { document.getElementById('group-modal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; document.getElementById('group-form-error').classList.add('hidden'); setTimeout(() => document.getElementById('new-group-name').focus(), 80); }
function closeGroupModal() { document.getElementById('group-modal').classList.add('hidden'); document.body.style.overflow = ''; document.getElementById('group-form').reset(); document.getElementById('group-form-error').classList.add('hidden'); }
function setKind(kind) {
  state.entryKind = kind;
  document.querySelectorAll('.entry-tab').forEach(button => button.classList.toggle('active', button.dataset.entry === kind));
  document.getElementById('shared-fields').classList.toggle('hidden', kind !== 'shared');
  document.getElementById('modal-title').textContent = kind === 'shared' ? 'Split an expense' : 'Add a transaction';
  syncPayerFields();
  if (kind === 'shared') updateSplitPreview();
}
function syncPayerFields() {
  const other = document.getElementById('shared-payer').value === 'someone-else';
  document.getElementById('payer-name-field').classList.toggle('hidden', !other);
  document.getElementById('account-field').classList.toggle('hidden', state.entryKind === 'shared' && other);
}
function showToast(message) { const toast = document.getElementById('toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }
function updateSplitPreview() {
  const total = Number(document.getElementById('amount').value || 0);
  const names = participantNames();
  const mineField = document.getElementById('my-share');
  if (!state.myShareEdited && total > 0) mineField.value = (Math.round(total * 100 / (names.length + 1)) / 100).toFixed(2);
  const mine = Number(mineField.value || 0);
  const group = document.getElementById('group-name').value.trim();
  const other = document.getElementById('shared-payer').value === 'someone-else';
  const payer = document.getElementById('payer-name').value.trim();
  const preview = document.getElementById('split-preview');
  if (!total || !group || !names.length || mine <= 0 || mine >= total) { preview.textContent = 'Enter a total, group, at least one person, and your share to preview the split.'; return; }
  if (other && !payer) { preview.textContent = 'Your personal expense: ' + money(mine) + '. Add who paid to see the balance.'; return; }
  if (other) { preview.textContent = 'Your personal expense: ' + money(mine) + ' · paid by ' + payer + ' · you owe ' + money(mine) + ' to ' + payer + '. Your personal account does not move.'; return; }
  const shares = splitCents(total - mine, names.length);
  const low = Math.min(...shares), high = Math.max(...shares);
  preview.textContent = 'Your personal expense: ' + money(mine) + ' · ' + money(total) + ' leaves your account · each other person owes ' + (low === high ? money(low) : money(low) + '–' + money(high)) + '.';
}

async function upsertMember(groupId, name) {
  const clean = name.trim();
  const existing = state.members.find(member => member.group_id === groupId && member.display_name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const result = await db.from('group_members').insert({ group_id:groupId, display_name:clean }).select().single();
  if (result.error) throw result.error;
  state.members.push(result.data);
  const group = groupFor(groupId);
  if (group) group.members.push(result.data);
  return result.data;
}
async function findOrCreateGroup(name, names = []) {
  let group = state.groups.find(item => item.name.toLowerCase() === name.toLowerCase());
  if (!group) {
    const result = await db.from('groups').insert({ name }).select().single();
    if (result.error) throw result.error;
    group = Object.assign({}, result.data, { members:[] });
    state.groups.push(group);
  }
  for (const memberName of names) await upsertMember(group.id, memberName);
  return group;
}
async function saveGroup(event) {
  event.preventDefault();
  const name = document.getElementById('new-group-name').value.trim();
  const names = [...new Map(document.getElementById('new-group-members').value.split(',').map(v => v.trim()).filter(Boolean).map(v => [v.toLowerCase(), v])).values()];
  const errorBox = document.getElementById('group-form-error');
  errorBox.classList.add('hidden');
  if (state.groups.some(group => group.name.toLowerCase() === name.toLowerCase())) { errorBox.textContent = 'A group with this name already exists. Choose it from the list or use another name.'; errorBox.classList.remove('hidden'); return; }
  const button = document.querySelector('#group-form button[type="submit"]');
  setBusy(button, true);
  try { await findOrCreateGroup(name, names); renderAll(); closeGroupModal(); showToast(name + ' group saved to Supabase.'); }
  catch (error) { errorBox.textContent = error.message || 'Could not save this group.'; errorBox.classList.remove('hidden'); }
  finally { setBusy(button, false, 'Create group →'); }
}

async function saveTransaction(event) {
  event.preventDefault();
  const errorBox = document.getElementById('form-error');
  errorBox.classList.add('hidden');
  const shared = state.entryKind === 'shared';
  const amount = Math.round(Number(document.getElementById('amount').value) * 100) / 100;
  const mine = Math.round(Number(document.getElementById('my-share').value) * 100) / 100;
  const title = document.getElementById('description').value.trim();
  const category = document.getElementById('category').value;
  const date = document.getElementById('date').value;
  const names = participantNames();
  const groupName = document.getElementById('group-name').value.trim();
  const paidByOther = document.getElementById('shared-payer').value === 'someone-else';
  const payerName = document.getElementById('payer-name').value.trim();
  const account = accountFor(document.getElementById('account').value);
  if (!title || !amount || amount <= 0 || !date || (!shared && !account)) { errorBox.textContent = 'Enter the description, amount, date, and a valid account.'; errorBox.classList.remove('hidden'); return; }
  if (shared && (!groupName || !names.length || mine <= 0 || mine >= amount || amount - mine < names.length * 0.01 || (paidByOther && !payerName))) { errorBox.textContent = 'Add a group, at least one other person, who paid, and a personal share that leaves at least one cent for each participant.'; errorBox.classList.remove('hidden'); return; }
  const button = document.querySelector('#expense-form button[type="submit"]');
  setBusy(button, true);
  try {
    if (!shared) {
      const result = await db.from('transactions').insert({
        type:'personal_expense', status:'posted', description:title, occurred_at:date + 'T12:00:00', amount,
        currency:account.currency, category, account_id:account.id, confirmed_at:new Date().toISOString()
      });
      if (result.error) throw result.error;
    } else {
      const group = await findOrCreateGroup(groupName, paidByOther ? names.concat([payerName]) : names);
      const memberRows = [];
      for (const name of names) memberRows.push(await upsertMember(group.id, name));
      const payer = paidByOther ? await upsertMember(group.id, payerName) : null;
      const created = await db.from('transactions').insert({
        type:'shared_expense', status:'draft', description:title, occurred_at:date + 'T12:00:00', amount,
        currency:account?.currency || 'USD', category, account_id:paidByOther ? null : account.id,
        group_id:group.id, payer_member_id:payer?.id || null, capture_source:'manual'
      }).select().single();
      if (created.error) throw created.error;
      const transaction = created.data;
      const otherShares = splitCents(amount - mine, memberRows.length);
      const splitRows = [
        { transaction_id:transaction.id, group_id:group.id, is_owner:true, group_member_id:null, share_amount:mine },
        ...memberRows.map((member, index) => ({ transaction_id:transaction.id, group_id:group.id, is_owner:false, group_member_id:member.id, share_amount:otherShares[index] }))
      ];
      const splitResult = await db.from('transaction_splits').insert(splitRows);
      if (splitResult.error) { await db.from('transactions').delete().eq('id', transaction.id); throw splitResult.error; }
      const posted = await db.from('transactions').update({ status:'posted', confirmed_at:new Date().toISOString() }).eq('id', transaction.id);
      if (posted.error) { await db.from('transactions').delete().eq('id', transaction.id); throw posted.error; }
    }
    await loadWorkspaceData();
    renderAll();
    const finishGuide = state.onboardingFinishing;
    state.onboardingFinishing = false;
    closeModal();
    if (finishGuide) {
      try { await completeOnboarding(); }
      catch (error) { showToast('Transaction saved. Reopen Help to finish setup.'); return; }
    }
    showToast(shared ? 'Shared expense saved to Supabase.' : 'Transaction saved to Supabase.');
  } catch (error) { errorBox.textContent = error.message || 'Could not save this transaction.'; errorBox.classList.remove('hidden'); }
  finally { setBusy(button, false, 'Save transaction →'); }
}

document.getElementById('today-label').textContent = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }).toUpperCase();
document.getElementById('auth-form').addEventListener('submit', beginAuthentication);
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  document.querySelectorAll('.install-button').forEach(button => button.classList.remove('hidden'));
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  document.querySelectorAll('.install-button').forEach(button => button.classList.add('hidden'));
  showToast('Buddi was added to your home screen.');
});
document.querySelectorAll('.install-button').forEach(button => button.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  document.querySelectorAll('.install-button').forEach(item => item.classList.add('hidden'));
}));
document.getElementById('sign-out').addEventListener('click', async () => { await db.auth.signOut(); state.user = null; showAuth(); setAuthStep('email'); });
document.getElementById('auth-email').addEventListener('input', () => { if (state.authStep === 'code') setAuthStep('email'); });
document.querySelectorAll('.nav-item,[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.getElementById('mobile-menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('add-expense').addEventListener('click', () => openModal());
document.getElementById('add-expense-transactions').addEventListener('click', () => openModal());
document.getElementById('add-shared-expense').addEventListener('click', () => openModal('shared'));
document.getElementById('close-modal').addEventListener('click', closeModal);
document.getElementById('cancel-modal').addEventListener('click', closeModal);
document.getElementById('transaction-modal').addEventListener('click', event => { if (event.target.id === 'transaction-modal') closeModal(); });
document.getElementById('create-group').addEventListener('click', openGroupModal);
document.getElementById('close-group-modal').addEventListener('click', closeGroupModal);
document.getElementById('cancel-group-modal').addEventListener('click', closeGroupModal);
document.getElementById('group-modal').addEventListener('click', event => { if (event.target.id === 'group-modal') closeGroupModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); closeGroupModal(); closeAccountModal(); if (!document.getElementById('setup-modal').classList.contains('hidden')) skipSetup(); } });
document.getElementById('group-form').addEventListener('submit', saveGroup);
document.getElementById('setup-close').addEventListener('click', skipSetup);
document.getElementById('setup-modal').addEventListener('click', event => {
  if (event.target.id === 'setup-modal') skipSetup();
  if (event.target.closest('[data-setup-close]')) skipSetup();
  if (event.target.closest('[data-setup-next]')) { state.onboardingStep = 1; renderSetupStep(); }
  if (event.target.closest('[data-setup-back]')) { state.onboardingStep = Math.max(0, state.onboardingStep - 1); renderSetupStep(); }
  if (event.target.closest('[data-setup-skip]')) { state.onboardingStep = 2; renderSetupStep(); }
  if (event.target.closest('[data-setup-group-next]')) continueSetupWithGroup();
  if (event.target.closest('[data-setup-finish]')) completeOnboarding().catch(error => setupError(error.message || 'Could not finish setup.'));
  if (event.target.closest('[data-setup-transaction]')) { state.onboardingFinishing = true; closeSetup(); openModal(); }
});
document.getElementById('close-account-modal').addEventListener('click', closeAccountModal);
document.getElementById('cancel-account-modal').addEventListener('click', closeAccountModal);
document.getElementById('account-modal').addEventListener('click', event => { if (event.target.id === 'account-modal') closeAccountModal(); });
document.getElementById('account-form').addEventListener('submit', saveAccount);
document.getElementById('group-list').addEventListener('click', event => {
  if (event.target.closest('[data-create-group]')) openGroupModal();
  const button = event.target.closest('[data-use-group]');
  if (button) openModal('shared', button.dataset.useGroup);
});
document.querySelectorAll('.entry-tab').forEach(button => button.addEventListener('click', () => setKind(button.dataset.entry)));
document.getElementById('amount').addEventListener('input', updateSplitPreview);
document.getElementById('friends').addEventListener('input', updateSplitPreview);
document.getElementById('my-share').addEventListener('input', () => { state.myShareEdited = true; updateSplitPreview(); });
document.getElementById('shared-payer').addEventListener('change', () => { syncPayerFields(); updateSplitPreview(); });
document.getElementById('payer-name').addEventListener('input', updateSplitPreview);
document.getElementById('group-name').addEventListener('change', () => {
  const group = state.groups.find(item => item.name.toLowerCase() === document.getElementById('group-name').value.trim().toLowerCase());
  if (group?.members?.length && !document.getElementById('friends').value.trim()) document.getElementById('friends').value = group.members.map(member => member.display_name).join(', ');
  state.myShareEdited = false;
  updateSplitPreview();
});
document.getElementById('expense-form').addEventListener('submit', saveTransaction);
document.getElementById('transaction-search').addEventListener('input', event => {
  const query = event.target.value.toLowerCase();
  const matches = state.transactions.filter(tx => (tx.title + ' ' + tx.category + ' ' + tx.account).toLowerCase().includes(query));
  document.getElementById('all-transactions').innerHTML = matches.map(rowMarkup).join('') || '<div class="empty-state">No matching transactions.</div>';
});
document.getElementById('invite-friend').addEventListener('click', () => showToast('Add people while creating a group or recording a shared expense.'));
document.getElementById('add-account').addEventListener('click', openAccountModal);
document.getElementById('add-budget').addEventListener('click', () => showToast('Budgets will be connected after the transaction flow.'));
document.getElementById('learn-more').addEventListener('click', () => showToast('One calm home for your money and your people.'));
document.getElementById('search-toggle').addEventListener('click', () => { setView('transactions'); document.getElementById('transaction-search').focus(); });
document.getElementById('help-button').addEventListener('click', () => openSetup(0));
document.getElementById('voice-button').addEventListener('click', () => {
  const status = document.getElementById('voice-status');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { status.textContent = 'Voice input is not supported in this browser. Type your expense instead.'; return; }
  const recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  status.textContent = 'Listening…';
  recognition.onresult = event => {
    const phrase = event.results[0][0].transcript;
    status.textContent = 'Heard: “' + phrase + '” — review the fields before saving.';
    const amountMatch = phrase.match(/(?:\$\s*)?(\d+(?:\.\d{1,2})?)/);
    if (amountMatch) document.getElementById('amount').value = amountMatch[1];
    document.getElementById('description').value = phrase.replace(/(?:\$\s*)?\d+(?:\.\d{1,2})?/, '').replace(/\b(spent|paid|for|on|at|today|yesterday|dollars?)\b/gi, '').replace(/\s+/g, ' ').trim() || phrase;
    updateSplitPreview();
  };
  recognition.onerror = () => { status.textContent = 'Could not hear that clearly. Please type the details.'; };
  recognition.start();
});

(async function initialize() {
  showAuth();
  setAuthStep('email');
  try {
    const result = await db.auth.getSession();
    if (result.error) throw result.error;
    if (result.data.session) await openWorkspace(result.data.session);
  } catch (error) {
    showAuthError('Supabase local is unavailable. Start it with “supabase start” and refresh. ' + (error.message || ''));
  }
})();
