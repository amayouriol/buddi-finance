const db = window.buddiSupabase;
const state = { user: null, accounts: [], groups: [], members: [], transactions: [], attachments: [], budgets: [], editingBudgetId: null, editingAccountId: null, editingTransactionId: null, friends: [], pendingReceipt: null, receiptPreviewUrl: null, entryKind: 'personal_expense', spendCurrency: null, myShareEdited: false, settlementMemberId: null, authStep: 'email', onboardingCompleted: false, onboardingStep: 0, onboardingFinishing: false };
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
    db.from('transaction_splits').select('*'),
    db.from('attachments').select('id, transaction_id, storage_path, mime_type'),
    db.from('budgets').select('*').order('category')
  ]);
  for (const result of results) if (result.error) throw result.error;
  const [accounts, groups, members, transactions, splits, attachments, budgets] = results.map(result => result.data);
  state.accounts = accounts;
  state.attachments = attachments;
  state.budgets = budgets;
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
      id:row.id, title:row.description, category:row.category || '', account:own?.name || '', accountId:row.account_id,
      currency:row.currency, date:String(row.occurred_at).slice(0, 10), amount:Number(row.amount),
      kind:row.type === 'shared_expense' ? 'shared' : row.type, mine:Number(ownerSplit?.share_amount ?? row.amount),
      sourceAccountId:row.source_account_id, sourceAccount:accountFor(row.source_account_id)?.name || '',
      destinationAccountId:row.destination_account_id, destinationAccount:accountFor(row.destination_account_id)?.name || '',
      destinationAmount:Number(row.destination_amount ?? row.amount), adjustmentDirection:row.adjustment_direction,
      friends:txSplits.filter(split => !split.is_owner).map(split => memberFor(split.group_member_id)?.display_name).filter(Boolean),
      groupName:group?.name || '', payerName:payer?.display_name || 'You', payerMemberId:row.payer_member_id,
      counterpartyMemberId:row.counterparty_member_id, counterpartyName:memberFor(row.counterparty_member_id)?.display_name || '',
      groupId:row.group_id, splits:txSplits.filter(split => !split.is_owner),
      receiptPath:attachments.find(attachment => attachment.transaction_id === row.id)?.storage_path || ''
    };
  });
  calculateFriendBalances();
}

function calculateFriendBalances() {
  const balances = new Map();
  const addBalance = (memberId, groupId, currency, amount) => {
    const member = memberFor(memberId);
    if (!member) return;
    const key = memberId + ':' + currency;
    const current = balances.get(key) || { memberId, groupId, currency, name:member.display_name, balance:0 };
    current.balance += amount;
    balances.set(key, current);
  };
  for (const tx of state.transactions) {
    if (tx.kind === 'shared') {
      if (tx.payerMemberId) addBalance(tx.payerMemberId, tx.groupId, tx.currency, -tx.mine);
      else for (const split of tx.splits) addBalance(split.group_member_id, tx.groupId, tx.currency, Number(split.share_amount));
    } else if (tx.kind === 'settlement_received') {
      addBalance(tx.counterpartyMemberId, tx.groupId, tx.currency, -tx.amount);
    } else if (tx.kind === 'settlement_paid') {
      addBalance(tx.counterpartyMemberId, tx.groupId, tx.currency, tx.amount);
    }
  }
  const colors = ['coral', 'lavender', 'yellow', 'blue', 'green'];
  state.friends = [...balances.values()].filter(friend => Math.abs(friend.balance) >= 0.005).map((friend, index) => {
    const group = groupFor(friend.groupId);
    return Object.assign(friend, {
      initial:friend.name.charAt(0).toUpperCase(), color:colors[index % colors.length], note:(group?.name || 'Shared expenses') + ' · ' + friend.currency,
      amount:Math.abs(friend.balance), owes:friend.balance >= 0
    });
  });
}

function accountBalance(account) {
  let balance = Number(account.opening_balance || 0);
  for (const tx of state.transactions) {
    if (tx.kind === 'transfer') {
      if (tx.sourceAccountId === account.id) balance -= tx.amount;
      if (tx.destinationAccountId === account.id) balance += tx.destinationAmount;
      continue;
    }
    if (tx.accountId !== account.id) continue;
    if (tx.kind === 'settlement_received' || tx.kind === 'income' || (tx.kind === 'balance_adjustment' && tx.adjustmentDirection === 'increase')) balance += tx.amount;
    else balance -= tx.amount;
  }
  return balance;
}

function renderAccounts() {
  document.getElementById('account-list').innerHTML = state.accounts.map(account =>
    '<button type="button" class="account-item" data-edit-account="' + esc(account.id) + '" aria-label="Edit ' + esc(account.name) + ' account"><span class="account-dot"></span><span class="account-item-name">' + esc(account.name) + '</span><small>' + money(accountBalance(account), account.currency) + '</small></button>'
  ).join('');
  document.getElementById('account').innerHTML = state.accounts.map(account =>
    '<option value="' + esc(account.id) + '">' + esc(account.name) + ' · ' + esc(account.currency) + '</option>'
  ).join('');
  document.getElementById('source-account').innerHTML = state.accounts.map(account =>
    '<option value="' + esc(account.id) + '">' + esc(account.name) + ' · ' + esc(account.currency) + '</option>'
  ).join('');
  updateTransferDestinationOptions();
}

function updateTransferDestinationOptions() {
  const source = accountFor(document.getElementById('source-account').value);
  const destinationSelect = document.getElementById('destination-account');
  const previous = destinationSelect.value;
  const options = state.accounts.filter(account => source && account.currency === source.currency && account.id !== source.id);
  destinationSelect.innerHTML = options.length
    ? options.map(account => '<option value="' + esc(account.id) + '">' + esc(account.name) + ' · ' + esc(account.currency) + '</option>').join('')
    : '<option value="">Add another ' + esc(source?.currency || '') + ' account</option>';
  if (options.some(account => account.id === previous)) destinationSelect.value = previous;
  document.getElementById('transfer-help').textContent = options.length
    ? 'Only accounts in ' + source.currency + ' are available; cross-currency transfers need an exchange-rate rule first.'
    : 'Add another ' + (source?.currency || '') + ' account before recording a transfer.';
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
  const settlement = tx.kind === 'settlement_received' || tx.kind === 'settlement_paid';
  const transfer = tx.kind === 'transfer';
  const adjustment = tx.kind === 'balance_adjustment';
  const category = categories.find(item => item.name === tx.category);
  const detail = settlement
    ? esc(tx.groupName || 'Shared') + ' · ' + esc(tx.account || 'Personal account') + ' · ' + dateLabel(tx.date)
    : transfer
    ? esc(tx.sourceAccount || 'Source') + ' → ' + esc(tx.destinationAccount || 'Destination') + ' · ' + dateLabel(tx.date)
    : shared
    ? 'Total ' + money(tx.amount, tx.currency) + ' · ' + esc(tx.groupName || 'Shared') + ' · ' + esc(tx.account ? 'from ' + tx.account : 'no personal account movement') + ' · paid by ' + esc(tx.payerName) + ' · ' + dateLabel(tx.date)
    : esc(tx.account || 'Personal') + ' · ' + dateLabel(tx.date);
  const incoming = tx.kind === 'settlement_received';
  const positive = incoming || tx.kind === 'income' || (adjustment && tx.adjustmentDirection === 'increase');
  const label = settlement ? (incoming ? 'Repayment received' : 'Repayment sent') : transfer ? 'Transfer' : adjustment ? 'Balance adjustment' : shared ? 'Your share' : tx.kind === 'income' ? 'Income' : 'Personal';
  const sign = transfer ? '' : positive ? '+' : '−';
  const editable = ['personal_expense', 'income', 'balance_adjustment', 'transfer'].includes(tx.kind);
  return '<div class="transaction-row"><div class="transaction-icon ' + (shared || settlement || transfer ? 'icon-split' : 'icon-food') + '">' + (category?.icon || (settlement || transfer ? '↔' : adjustment ? '±' : '•')) + '</div><div class="transaction-info"><strong>' + esc(tx.title) + (shared ? '<span class="shared-tag">SHARED</span>' : '') + '</strong><small>' + esc(settlement || transfer ? label : tx.category || label) + ' · ' + detail + '</small>' + (tx.receiptPath ? '<button type="button" class="receipt-open" data-receipt-path="' + esc(tx.receiptPath) + '">View receipt</button>' : '') + '</div><div class="transaction-meta"><strong>' + sign + money(shared ? tx.mine : tx.amount, tx.currency) + '</strong><small>' + label + '</small>' + (editable ? '<button type="button" class="transaction-edit" data-edit-transaction="' + esc(tx.id) + '">Edit</button>' : '') + '</div></div>';
}

function clearReceiptSelection() {
  if (state.receiptPreviewUrl) URL.revokeObjectURL(state.receiptPreviewUrl);
  state.receiptPreviewUrl = null;
  state.pendingReceipt = null;
  document.getElementById('receipt-file').value = '';
  document.getElementById('receipt-preview').classList.add('hidden');
  document.getElementById('receipt-preview-image').removeAttribute('src');
  document.getElementById('receipt-ai-status').textContent = '';
}

async function compactReceiptImage(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const maxSide = Math.max(bitmap.width, bitmap.height);
    let scale = Math.min(1, 1800 / maxSide);
    for (let attempt = 0; attempt < 2; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', attempt ? 0.72 : 0.82));
      if (!blob) throw new Error('Could not prepare this image. Try another photo.');
      if (blob.size <= 1536 * 1024) return blob;
      scale *= 0.65;
    }
  } finally { bitmap.close(); }
  throw new Error('This receipt image is too large to read. Try a smaller photo.');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read this image. Try again.'));
    reader.readAsDataURL(blob);
  });
}

async function readReceiptWithAi() {
  const button = document.getElementById('read-receipt');
  const status = document.getElementById('receipt-ai-status');
  if (!state.pendingReceipt) { status.textContent = 'Choose a receipt photo first.'; return; }
  setBusy(button, true, 'Read receipt');
  status.textContent = 'Preparing the image…';
  try {
    const image = await compactReceiptImage(state.pendingReceipt);
    const imageBase64 = await blobToBase64(image);
    status.textContent = 'Sending this receipt image to Google AI…';
    const result = await db.functions.invoke('parse-receipt', { body: { mimeType:'image/jpeg', imageBase64 } });
    if (result.error) {
      let message = result.error.message || 'Could not read the receipt. Enter details manually.';
      try { message = (await result.error.context.json()).error || message; } catch {}
      throw new Error(message);
    }
    const draft = result.data?.draft;
    if (!draft) throw new Error('No receipt draft was returned. Enter details manually.');
    if (draft.description) document.getElementById('description').value = draft.description;
    if (Number(draft.amount) > 0) document.getElementById('amount').value = draft.amount;
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) document.getElementById('date').value = draft.date;
    if ([...document.getElementById('category').options].some(option => option.value === draft.category || option.text === draft.category)) document.getElementById('category').value = draft.category;
    if (draft.currency === 'USD' || draft.currency === 'PEN') {
      const matchingAccount = state.accounts.find(account => account.currency === draft.currency);
      if (matchingAccount) document.getElementById('account').value = matchingAccount.id;
    }
    updateSplitPreview();
    status.textContent = (draft.clarifyingQuestion ? draft.clarifyingQuestion + ' ' : '') + 'Draft filled in. Check the date, currency, account, and every field before saving.';
  } catch (error) {
    status.textContent = error.message || 'Could not read the receipt. Enter details manually.';
  } finally { setBusy(button, false, 'Read receipt'); }
}

async function attachReceipt(transactionId) {
  const file = state.pendingReceipt;
  if (!file) return;
  const extension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[file.type];
  if (!extension) throw new Error('Choose a JPEG, PNG, or WebP receipt photo.');
  const path = state.user.id + '/' + transactionId + '/' + crypto.randomUUID() + '.' + extension;
  const bucket = db.storage.from('buddi-receipts');
  const uploaded = await bucket.upload(path, file, { contentType:file.type, cacheControl:'3600', upsert:false });
  if (uploaded.error) throw uploaded.error;
  const attached = await db.from('attachments').insert({ transaction_id:transactionId, storage_path:path, mime_type:file.type });
  if (attached.error) {
    await bucket.remove([path]);
    throw attached.error;
  }
  return path;
}

async function removeReceiptPath(path) {
  if (path) await db.storage.from('buddi-receipts').remove([path]);
}

async function openPrivateReceipt(path) {
  const tab = window.open('about:blank', '_blank');
  if (!tab) { showToast('Allow pop-ups to view this private receipt.'); return; }
  try {
    const result = await db.storage.from('buddi-receipts').createSignedUrl(path, 60);
    if (result.error) throw result.error;
    tab.location.href = result.data.signedUrl;
  } catch (error) {
    tab.close();
    showToast(error.message || 'Could not open this receipt.');
  }
}
function filteredTransactions() {
  const search = document.getElementById('transaction-search').value.trim().toLowerCase();
  const type = document.getElementById('filter-type').value;
  const currency = document.getElementById('filter-currency').value;
  const start = document.getElementById('filter-start-date').value;
  const end = document.getElementById('filter-end-date').value;
  const status = document.getElementById('transaction-filter-status');
  if (start && end && start > end) {
    status.textContent = 'Start date must be on or before the end date.';
    status.classList.add('filter-error');
    return [];
  }
  status.classList.remove('filter-error');
  const matches = state.transactions.filter(tx => {
    const kindMatch = type === 'all' || (type === 'settlement' ? tx.kind.startsWith('settlement_') : tx.kind === type);
    const searchText = [tx.title, tx.category, tx.account, tx.sourceAccount, tx.destinationAccount, tx.groupName, tx.payerName].join(' ').toLowerCase();
    return kindMatch && (currency === 'all' || tx.currency === currency) && (!start || tx.date >= start) && (!end || tx.date <= end) && (!search || searchText.includes(search));
  });
  status.textContent = matches.length === state.transactions.length
    ? matches.length + ' transactions'
    : 'Showing ' + matches.length + ' of ' + state.transactions.length + ' transactions';
  return matches;
}

function renderTransactions() {
  const empty = '<div class="empty-state">No transactions yet. Add one to start your personal ledger.</div>';
  document.getElementById('recent-transactions').innerHTML = state.transactions.length ? state.transactions.slice(0, 7).map(rowMarkup).join('') : empty;
  const matches = filteredTransactions();
  const hasFilters = document.getElementById('transaction-search').value || document.getElementById('filter-type').value !== 'all' || document.getElementById('filter-currency').value !== 'all' || document.getElementById('filter-start-date').value || document.getElementById('filter-end-date').value;
  document.getElementById('all-transactions').innerHTML = matches.length ? matches.map(rowMarkup).join('') : hasFilters ? '<div class="empty-state">No transactions match these filters.</div>' : empty;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text.trimStart())) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function exportTransactionsCsv() {
  const rows = filteredTransactions();
  if (!rows.length) { showToast('There are no matching transactions to export.'); return; }
  const labels = { personal_expense:'Personal expense', income:'Income', shared:'Shared expense', transfer:'Transfer', balance_adjustment:'Balance adjustment', settlement_received:'Repayment received', settlement_paid:'Repayment sent' };
  const header = ['Date', 'Type', 'Description', 'Category', 'Total amount', 'Currency', 'Account', 'From account', 'To account', 'Group', 'Paid by', 'Your share'];
  const lines = [header, ...rows.map(tx => [
    tx.date, labels[tx.kind] || tx.kind, tx.title, tx.category,
    Number(tx.amount).toFixed(2), tx.currency, tx.account, tx.sourceAccount, tx.destinationAccount,
    tx.groupName, tx.kind === 'shared' ? tx.payerName : '', tx.kind === 'shared' ? Number(tx.mine).toFixed(2) : ''
  ])].map(row => row.map(csvCell).join(','));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'buddi-transactions-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(rows.length + ' transactions exported.');
}
function personalSpend(tx) { return tx.kind === 'shared' ? tx.mine : tx.kind === 'personal_expense' ? tx.amount : 0; }

function formatCurrencyTotals(rows, fallbackCurrency = 'USD') {
  const totals = new Map();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) || 0) + row.amount);
  return totals.size ? [...totals].map(([currency, amount]) => money(amount, currency)).join(' · ') : money(0, fallbackCurrency);
}

function setCurrencyTotal(elementId, value) {
  const element = document.getElementById(elementId);
  element.textContent = value;
  element.classList.toggle('multi-currency', value.includes(' · '));
}

function renderSummary() {
  const monthly = state.transactions.filter(tx => monthKey(tx.date) === currentMonth);
  const currency = state.accounts[0]?.currency || 'USD';
  const balances = state.accounts.map(account => ({ currency:account.currency, amount:accountBalance(account) }));
  const spending = monthly.map(tx => ({ currency:tx.currency, amount:personalSpend(tx) })).filter(row => row.amount > 0);
  const repayments = monthly.filter(tx => tx.kind === 'settlement_received' || tx.kind === 'settlement_paid').map(tx => ({ currency:tx.currency, amount:tx.amount }));
  const owedRows = state.friends.filter(friend => friend.balance > 0).map(friend => ({ currency:friend.currency, amount:friend.balance }));
  const dueRows = state.friends.filter(friend => friend.balance < 0).map(friend => ({ currency:friend.currency, amount:Math.abs(friend.balance) }));
  setCurrencyTotal('total-balance', formatCurrencyTotals(balances, currency));
  const spentText = formatCurrencyTotals(spending, currency);
  setCurrencyTotal('spent-total', spentText);
  document.getElementById('spend-caption').textContent = spentText;
  document.getElementById('spend-period').textContent = new Date().toLocaleDateString('en-US', { month:'long', year:'numeric' });
  setCurrencyTotal('owed-total', formatCurrencyTotals(owedRows, currency));
  document.getElementById('owed-caption').textContent = owedRows.length + ' people owe you';
  setCurrencyTotal('shared-owed', formatCurrencyTotals(owedRows, currency));
  setCurrencyTotal('shared-due', formatCurrencyTotals(dueRows, currency));
  document.getElementById('shared-owed-count').textContent = state.friends.filter(friend => friend.balance > 0).length + ' people';
  document.getElementById('shared-due-count').textContent = state.friends.filter(friend => friend.balance < 0).length + ' people';
  setCurrencyTotal('settled-total', formatCurrencyTotals(repayments, currency));
  document.getElementById('settled-caption').textContent = repayments.length + ' repayments this month';
  document.getElementById('spend-progress-bar').style.width = '0%';
}

function renderLegend() {
  const currencySelect = document.getElementById('spend-currency');
  const availableCurrencies = [...new Set([
    ...state.accounts.map(account => account.currency),
    ...state.transactions.filter(tx => personalSpend(tx) > 0).map(tx => tx.currency)
  ])].sort();
  if (!availableCurrencies.length) availableCurrencies.push('USD');
  if (!availableCurrencies.includes(state.spendCurrency)) state.spendCurrency = availableCurrencies.includes(state.accounts[0]?.currency) ? state.accounts[0].currency : availableCurrencies[0];
  currencySelect.innerHTML = availableCurrencies.map(currency => '<option value="' + esc(currency) + '">' + esc(currency) + '</option>').join('');
  currencySelect.value = state.spendCurrency;
  const monthly = state.transactions.filter(tx => monthKey(tx.date) === currentMonth && tx.currency === state.spendCurrency);
  const totals = new Map();
  for (const tx of monthly) if (personalSpend(tx) > 0 && tx.category) totals.set(tx.category, (totals.get(tx.category) || 0) + personalSpend(tx));
  const total = [...totals.values()].reduce((sum, amount) => sum + amount, 0);
  const active = categories.filter(category => (totals.get(category.name) || 0) > 0);
  document.getElementById('chart-total').textContent = money(total, state.spendCurrency);
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
    const hasAccount = state.accounts.some(account => account.currency === friend.currency);
    return '<div class="friend-row"><span class="friend-avatar ' + friend.color + '">' + esc(friend.initial) + '</span><span class="friend-name"><strong>' + esc(friend.name) + '</strong><small>' + esc(friend.note) + '</small></span><span class="friend-balance"><strong class="' + (balance > 0 ? 'positive' : '') + '">' + (balance > 0 ? 'Owes you ' : 'You owe ') + money(Math.abs(balance), friend.currency) + '</strong><button class="settle-button" type="button" data-settle-member="' + esc(friend.memberId) + '" ' + (hasAccount ? '' : 'disabled title="Add a ' + esc(friend.currency) + ' account to record this repayment"') + '>Record payment</button></span></div>';
  }).join('') : '<div class="empty-state">People and balances appear here when you add a shared expense to a group.</div>';
  document.getElementById('shared-count').textContent = state.friends.filter(friend => friend.balance > 0).length;
}
function renderBudgets() {
  const month = currentMonth;
  if (!state.budgets.length) {
    document.getElementById('budget-grid').innerHTML = '<div class="empty-state">No budgets yet. Set a monthly limit for a category to track your spending.</div>';
    return;
  }
  document.getElementById('budget-grid').innerHTML = state.budgets.map(budget => {
    const spent = state.transactions.filter(tx => monthKey(tx.date) === month && tx.currency === budget.currency && tx.category === budget.category).reduce((total, tx) => total + personalSpend(tx), 0);
    const limit = Number(budget.monthly_limit);
    const percent = limit > 0 ? Math.round(spent / limit * 100) : 0;
    const width = Math.min(100, percent);
    const remaining = limit - spent;
    const category = categories.find(item => item.name === budget.category);
    return '<article class="budget-card ' + (remaining < 0 ? 'over-budget' : '') + '"><div class="budget-top"><span class="budget-category"><i style="background:' + (category?.color || '#66a978') + '"></i><strong>' + esc(budget.category) + '</strong></span><span class="budget-actions"><button type="button" data-edit-budget="' + esc(budget.id) + '">Edit</button><button type="button" data-delete-budget="' + esc(budget.id) + '">Delete</button></span></div><div class="budget-amount">' + money(spent, budget.currency) + ' <small>of ' + money(limit, budget.currency) + '</small></div><div class="budget-bar" role="progressbar" aria-label="' + esc(budget.category) + ' budget used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, percent) + '"><span style="width:' + width + '%"></span></div><div class="budget-caption"><span>' + (remaining >= 0 ? money(remaining, budget.currency) + ' left' : money(Math.abs(remaining), budget.currency) + ' over') + '</span><small>' + percent + '% · ' + new Date(month + '-01T12:00:00').toLocaleDateString('en-US', { month:'long', year:'numeric' }) + '</small></div></article>';
  }).join('');
}
function renderAll() { renderAccounts(); renderTransactions(); renderLegend(); renderActivities(); renderFriends(); renderBudgets(); renderGroupOptions(); renderGroups(); renderSummary(); }

function refreshBudgetCategoryOptions(selected = '') {
  const currency = document.getElementById('budget-currency').value;
  const taken = new Set(state.budgets.filter(budget => budget.currency === currency && budget.id !== state.editingBudgetId).map(budget => budget.category));
  const available = categories.filter(category => !taken.has(category.name));
  const select = document.getElementById('budget-category');
  select.innerHTML = available.map(category => '<option value="' + esc(category.name) + '">' + esc(category.name) + '</option>').join('');
  if (available.some(category => category.name === selected)) select.value = selected;
}

function openBudgetModal(budget = null) {
  state.editingBudgetId = budget?.id || null;
  const form = document.getElementById('budget-form');
  form.reset();
  document.getElementById('budget-form-error').classList.add('hidden');
  document.getElementById('budget-modal-title').textContent = budget ? 'Edit budget' : 'Create a budget';
  document.getElementById('save-budget').innerHTML = budget ? 'Save changes <span>→</span>' : 'Save budget <span>→</span>';
  const currencies = [...new Set([...state.accounts.map(account => account.currency), ...state.budgets.map(item => item.currency)])];
  document.getElementById('budget-currency').innerHTML = currencies.map(currency => '<option value="' + esc(currency) + '">' + esc(currency) + '</option>').join('');
  const preferredCurrency = budget?.currency || (currencies.includes(state.spendCurrency) ? state.spendCurrency : currencies[0] || 'USD');
  if (currencies.includes(preferredCurrency)) document.getElementById('budget-currency').value = preferredCurrency;
  refreshBudgetCategoryOptions(budget?.category || '');
  if (budget) document.getElementById('budget-limit').value = Number(budget.monthly_limit).toFixed(2);
  document.getElementById('budget-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('budget-category').focus(), 80);
}

function closeBudgetModal() {
  document.getElementById('budget-modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('budget-form').reset();
  document.getElementById('budget-form-error').classList.add('hidden');
  state.editingBudgetId = null;
}

async function saveBudget(event) {
  event.preventDefault();
  const errorBox = document.getElementById('budget-form-error');
  const category = document.getElementById('budget-category').value;
  const currency = document.getElementById('budget-currency').value;
  const limit = Math.round(Number(document.getElementById('budget-limit').value) * 100) / 100;
  errorBox.classList.add('hidden');
  if (!category || !currency || !Number.isFinite(limit) || limit <= 0) {
    errorBox.textContent = 'Choose a category and currency, then enter a monthly limit above zero.';
    errorBox.classList.remove('hidden');
    return;
  }
  if (state.budgets.some(budget => budget.id !== state.editingBudgetId && budget.category === category && budget.currency === currency)) {
    errorBox.textContent = 'A budget already exists for this category and currency. Edit that budget instead.';
    errorBox.classList.remove('hidden');
    return;
  }
  const button = document.getElementById('save-budget');
  const label = state.editingBudgetId ? 'Save changes →' : 'Save budget →';
  setBusy(button, true);
  try {
    const result = state.editingBudgetId
      ? await db.from('budgets').update({ category, currency, monthly_limit:limit }).eq('id', state.editingBudgetId).select().single()
      : await db.from('budgets').insert({ category, currency, monthly_limit:limit }).select().single();
    if (result.error) throw result.error;
    const index = state.budgets.findIndex(budget => budget.id === result.data.id);
    if (index < 0) state.budgets.push(result.data); else state.budgets[index] = result.data;
    closeBudgetModal();
    renderBudgets();
    showToast('Monthly budget saved.');
  } catch (error) {
    errorBox.textContent = error.message || 'Could not save this budget.';
    errorBox.classList.remove('hidden');
  } finally { setBusy(button, false, label); }
}

async function deleteBudget(budgetId) {
  const budget = state.budgets.find(item => item.id === budgetId);
  if (!budget || !window.confirm('Delete the ' + budget.category + ' budget for ' + budget.currency + '?')) return;
  const result = await db.from('budgets').delete().eq('id', budgetId);
  if (result.error) { showToast(result.error.message || 'Could not delete this budget.'); return; }
  state.budgets = state.budgets.filter(item => item.id !== budgetId);
  renderBudgets();
  showToast('Budget deleted.');
}

function openSettlementModal(memberId) {
  const friend = state.friends.find(item => item.memberId === memberId);
  if (!friend) return;
  state.settlementMemberId = memberId;
  const incoming = friend.balance > 0;
  const amount = Math.abs(friend.balance);
  const matchingAccounts = state.accounts.filter(account => account.currency === friend.currency);
  document.getElementById('settlement-form').reset();
  document.getElementById('settlement-modal-title').textContent = incoming ? 'Record money received' : 'Record a repayment';
  document.getElementById('settlement-context').textContent = incoming
    ? friend.name + ' is paying you back · ' + friend.note
    : 'You are paying ' + friend.name + ' · ' + friend.note;
  document.getElementById('settlement-amount').value = amount.toFixed(2);
  document.getElementById('settlement-amount').max = amount.toFixed(2);
  document.getElementById('settlement-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('settlement-account-label').textContent = incoming ? 'Deposit into' : 'Pay from';
  document.getElementById('settlement-account').innerHTML = matchingAccounts.map(account =>
    '<option value="' + esc(account.id) + '">' + esc(account.name) + ' · ' + esc(account.currency) + '</option>'
  ).join('');
  document.getElementById('settlement-account').disabled = !matchingAccounts.length;
  document.getElementById('settlement-help').textContent = matchingAccounts.length
    ? 'This payment reduces the outstanding balance. You can record a smaller amount for a partial payment.'
    : 'Add a ' + friend.currency + ' account before recording this payment.';
  document.getElementById('settlement-error').classList.add('hidden');
  document.getElementById('save-settlement').disabled = !matchingAccounts.length;
  document.getElementById('settlement-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('settlement-amount').focus(), 80);
}

function closeSettlementModal() {
  document.getElementById('settlement-modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('settlement-form').reset();
  document.getElementById('settlement-error').classList.add('hidden');
  state.settlementMemberId = null;
}

async function saveSettlement(event) {
  event.preventDefault();
  const friend = state.friends.find(item => item.memberId === state.settlementMemberId);
  const errorBox = document.getElementById('settlement-error');
  errorBox.classList.add('hidden');
  if (!friend) { closeSettlementModal(); return; }
  const amount = Math.round(Number(document.getElementById('settlement-amount').value) * 100) / 100;
  const date = document.getElementById('settlement-date').value;
  const account = accountFor(document.getElementById('settlement-account').value);
  if (!amount || amount <= 0 || amount - Math.abs(friend.balance) > 0.001 || !date || !account || account.currency !== friend.currency) {
    errorBox.textContent = 'Enter a valid amount up to the outstanding balance and choose an account in ' + friend.currency + '.';
    errorBox.classList.remove('hidden');
    return;
  }
  const incoming = friend.balance > 0;
  const button = document.getElementById('save-settlement');
  setBusy(button, true);
  try {
    const result = await db.from('transactions').insert({
      type:incoming ? 'settlement_received' : 'settlement_paid', status:'posted',
      description:incoming ? 'Repayment from ' + friend.name : 'Repayment to ' + friend.name,
      occurred_at:date + 'T12:00:00', amount, currency:friend.currency,
      account_id:account.id, group_id:friend.groupId, counterparty_member_id:friend.memberId,
      confirmed_at:new Date().toISOString()
    });
    if (result.error) throw result.error;
    await loadWorkspaceData();
    renderAll();
    closeSettlementModal();
    showToast('Payment recorded. The shared balance and account were updated.');
  } catch (error) {
    errorBox.textContent = error.message || 'Could not record this payment.';
    errorBox.classList.remove('hidden');
  } finally { setBusy(button, false, 'Record payment →'); }
}

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

function openAccountModal(account = null) {
  state.editingAccountId = account?.id || null;
  document.getElementById('account-form').reset();
  document.getElementById('account-modal-title').textContent = account ? 'Edit account' : 'Add an account';
  document.querySelector('#account-form button[type="submit"]').innerHTML = account ? 'Save changes <span>→</span>' : 'Save account <span>→</span>';
  document.getElementById('new-account-balance').value = account ? Number(account.opening_balance).toFixed(2) : '0.00';
  document.getElementById('new-account-name').value = account?.name || '';
  document.getElementById('new-account-currency').value = account?.currency || 'USD';
  const hasHistory = account && state.transactions.some(tx => tx.accountId === account.id || tx.sourceAccountId === account.id || tx.destinationAccountId === account.id);
  document.getElementById('new-account-currency').disabled = Boolean(hasHistory);
  document.getElementById('account-currency-help').textContent = hasHistory
    ? 'This account has transactions. Its currency is locked so the existing amounts stay accurate.'
    : 'Changing the currency affects how this account\'s balance is shown. It can\'t change after transactions are recorded.';
  document.getElementById('account-form-error').classList.add('hidden');
  document.getElementById('account-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('new-account-name').focus(), 80);
}
function closeAccountModal() {
  document.getElementById('account-modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('account-form').reset();
  document.getElementById('new-account-currency').disabled = false;
  document.getElementById('account-form-error').classList.add('hidden');
  state.editingAccountId = null;
}
async function saveAccount(event) {
  event.preventDefault();
  const name = document.getElementById('new-account-name').value.trim();
  const currency = document.getElementById('new-account-currency').value;
  const balance = Number(document.getElementById('new-account-balance').value);
  const errorBox = document.getElementById('account-form-error');
  const existing = state.accounts.find(account => account.id === state.editingAccountId);
  errorBox.classList.add('hidden');
  if (!name || !Number.isFinite(balance)) { errorBox.textContent = 'Enter an account name and a valid starting balance.'; errorBox.classList.remove('hidden'); return; }
  if (state.accounts.some(account => account.id !== existing?.id && account.name.toLowerCase() === name.toLowerCase())) { errorBox.textContent = 'An account with this name already exists.'; errorBox.classList.remove('hidden'); return; }
  const hasHistory = existing && state.transactions.some(tx => tx.accountId === existing.id || tx.sourceAccountId === existing.id || tx.destinationAccountId === existing.id);
  if (hasHistory && currency !== existing.currency) { errorBox.textContent = 'Currency is locked because this account has recorded transactions.'; errorBox.classList.remove('hidden'); return; }
  const button = document.querySelector('#account-form button[type="submit"]');
  const label = existing ? 'Save changes →' : 'Save account →';
  setBusy(button, true);
  try {
    const result = existing
      ? await db.from('accounts').update({ name, currency, opening_balance:balance }).eq('id', existing.id)
      : await db.from('accounts').insert({ name, currency, opening_balance:balance });
    if (result.error) throw result.error;
    await loadWorkspaceData();
    renderAll();
    closeAccountModal();
    showToast(existing ? name + ' account updated.' : name + ' account added.');
  } catch (error) { errorBox.textContent = error.message || 'Could not save this account.'; errorBox.classList.remove('hidden'); }
  finally { setBusy(button, false, label); }
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
function openModal(kind = 'personal_expense', groupName = '') {
  clearReceiptSelection();
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

function openTransactionEdit(transactionId) {
  const tx = state.transactions.find(item => item.id === transactionId);
  if (!tx || !['personal_expense', 'income', 'balance_adjustment', 'transfer'].includes(tx.kind)) return;
  state.editingTransactionId = tx.id;
  openModal(tx.kind);
  document.getElementById('entry-kind').disabled = true;
  document.getElementById('modal-title').textContent = 'Edit transaction';
  document.getElementById('description').value = tx.title;
  document.getElementById('amount').value = Number(tx.amount).toFixed(2);
  document.getElementById('date').value = tx.date;
  document.querySelector('#expense-form button[type="submit"]').innerHTML = 'Save changes <span>→</span>';
  if (tx.kind === 'transfer') {
    document.getElementById('source-account').value = tx.sourceAccountId;
    updateTransferDestinationOptions();
    document.getElementById('destination-account').value = tx.destinationAccountId;
  } else {
    document.getElementById('account').innerHTML = state.accounts.filter(account => account.currency === tx.currency).map(account =>
      '<option value="' + esc(account.id) + '">' + esc(account.name) + ' · ' + esc(account.currency) + '</option>'
    ).join('');
    document.getElementById('account').value = tx.accountId;
    if (tx.kind === 'personal_expense') document.getElementById('category').value = tx.category;
    if (tx.kind === 'balance_adjustment') document.getElementById('adjustment-direction').value = tx.adjustmentDirection;
  }
}

function closeModal() {
  document.getElementById('transaction-modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('expense-form').reset();
  document.getElementById('entry-kind').disabled = false;
  state.editingTransactionId = null;
  clearReceiptSelection();
  document.getElementById('form-error').classList.add('hidden');
  state.myShareEdited = false;
  state.onboardingFinishing = false;
  setKind('personal_expense');
  renderAccounts();
}
function openGroupModal() { document.getElementById('group-modal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; document.getElementById('group-form-error').classList.add('hidden'); setTimeout(() => document.getElementById('new-group-name').focus(), 80); }
function closeGroupModal() { document.getElementById('group-modal').classList.add('hidden'); document.body.style.overflow = ''; document.getElementById('group-form').reset(); document.getElementById('group-form-error').classList.add('hidden'); }
function setKind(kind) {
  if (kind === 'personal') kind = 'personal_expense';
  if (kind === 'shared') kind = 'shared_expense';
  state.entryKind = kind;
  document.getElementById('entry-kind').value = kind;
  const shared = kind === 'shared_expense';
  const transfer = kind === 'transfer';
  const adjustment = kind === 'balance_adjustment';
  const expense = kind === 'personal_expense';
  document.getElementById('shared-fields').classList.toggle('hidden', !shared);
  document.getElementById('category-field').classList.toggle('hidden', !(expense || shared));
  document.getElementById('transfer-fields').classList.toggle('hidden', !transfer);
  document.getElementById('adjustment-fields').classList.toggle('hidden', !adjustment);
  document.querySelector('.voice-entry').classList.remove('hidden');
  document.querySelector('.ai-privacy-note').classList.remove('hidden');
  const titles = { personal_expense:'Add an expense', income:'Record income', transfer:'Transfer between accounts', balance_adjustment:'Adjust an account balance', shared_expense:'Split an expense' };
  document.getElementById('modal-title').textContent = titles[kind] || 'Add a transaction';
  document.getElementById('category').required = expense || shared;
  document.getElementById('source-account').required = transfer;
  document.getElementById('destination-account').required = transfer;
  syncPayerFields();
  if (shared) updateSplitPreview();
}
function syncPayerFields() {
  const shared = state.entryKind === 'shared_expense';
  const other = shared && document.getElementById('shared-payer').value === 'someone-else';
  document.getElementById('payer-name-field').classList.toggle('hidden', !other);
  const needsAccount = !['shared_expense', 'transfer'].includes(state.entryKind) || (shared && !other);
  document.getElementById('account-field').classList.toggle('hidden', !needsAccount);
  document.getElementById('account').required = needsAccount;
  document.getElementById('account-field').firstChild.textContent = state.entryKind === 'income' ? 'Deposit into' : state.entryKind === 'balance_adjustment' ? 'Account' : 'Paid from';
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
  const type = state.entryKind;
  const shared = type === 'shared_expense';
  const transfer = type === 'transfer';
  const amount = Math.round(Number(document.getElementById('amount').value) * 100) / 100;
  const mine = Math.round(Number(document.getElementById('my-share').value) * 100) / 100;
  const title = document.getElementById('description').value.trim();
  const category = document.getElementById('category').value;
  const date = document.getElementById('date').value;
  const account = accountFor(document.getElementById('account').value);
  const sourceAccount = accountFor(document.getElementById('source-account').value);
  const destinationAccount = accountFor(document.getElementById('destination-account').value);
  const names = participantNames();
  const groupName = document.getElementById('group-name').value.trim();
  const paidByOther = document.getElementById('shared-payer').value === 'someone-else';
  const payerName = document.getElementById('payer-name').value.trim();
  if (!title || !amount || amount <= 0 || !date || (!shared && !transfer && !account) || (shared && !paidByOther && !account)) { errorBox.textContent = 'Enter the description, amount, date, and a valid account.'; errorBox.classList.remove('hidden'); return; }
  if (transfer && (!sourceAccount || !destinationAccount || sourceAccount.id === destinationAccount.id || sourceAccount.currency !== destinationAccount.currency)) { errorBox.textContent = 'Choose two different accounts with the same currency. Cross-currency transfers need an exchange-rate rule first.'; errorBox.classList.remove('hidden'); return; }
  if (shared && (!groupName || !names.length || mine <= 0 || mine >= amount || amount - mine < names.length * 0.01 || (paidByOther && !payerName))) { errorBox.textContent = 'Add a group, at least one other person, who paid, and a personal share that leaves at least one cent for each participant.'; errorBox.classList.remove('hidden'); return; }
  const button = document.querySelector('#expense-form button[type="submit"]');
  const submitLabel = state.editingTransactionId ? 'Save changes →' : 'Save transaction →';
  setBusy(button, true);
  try {
    const editing = state.transactions.find(tx => tx.id === state.editingTransactionId);
    if (state.editingTransactionId && !editing) throw new Error('This transaction is no longer available. Refresh and try again.');
    if (editing) {
      let updates;
      if (transfer) updates = {
        description:title, occurred_at:date + 'T12:00:00', amount, currency:sourceAccount.currency,
        source_account_id:sourceAccount.id, destination_account_id:destinationAccount.id,
        confirmed_at:new Date().toISOString()
      };
      else {
        updates = { description:title, occurred_at:date + 'T12:00:00', amount, currency:account.currency, account_id:account.id, confirmed_at:new Date().toISOString() };
        if (type === 'personal_expense') updates.category = category;
        if (type === 'income') updates.category = 'Income';
        if (type === 'balance_adjustment') {
          updates.category = 'Balance adjustment';
          updates.adjustment_direction = document.getElementById('adjustment-direction').value;
        }
      }
      const updated = await db.from('transactions').update(updates).eq('id', editing.id).select('id').single();
      if (updated.error) throw updated.error;
      await loadWorkspaceData();
      renderAll();
      closeModal();
      showToast('Transaction updated.');
      return;
    }
    if (transfer) {
      const result = await db.from('transactions').insert({
        type:'transfer', status:'posted', description:title, occurred_at:date + 'T12:00:00', amount,
        currency:sourceAccount.currency, source_account_id:sourceAccount.id, destination_account_id:destinationAccount.id,
        capture_source:state.pendingReceipt ? 'receipt' : 'manual', confirmed_at:new Date().toISOString()
      }).select('id').single();
      if (result.error) throw result.error;
      try { await attachReceipt(result.data.id); }
      catch (error) { await db.from('transactions').delete().eq('id', result.data.id); throw error; }
    } else if (shared) {
      const group = await findOrCreateGroup(groupName, paidByOther ? names.concat([payerName]) : names);
      const memberRows = [];
      for (const name of names) memberRows.push(await upsertMember(group.id, name));
      const payer = paidByOther ? await upsertMember(group.id, payerName) : null;
      const created = await db.from('transactions').insert({
        type:'shared_expense', status:'draft', description:title, occurred_at:date + 'T12:00:00', amount,
        currency:account?.currency || 'USD', category, account_id:paidByOther ? null : account.id,
        group_id:group.id, payer_member_id:payer?.id || null, capture_source:state.pendingReceipt ? 'receipt' : 'manual'
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
      let receiptPath = '';
      try { receiptPath = await attachReceipt(transaction.id) || ''; }
      catch (error) { await db.from('transactions').delete().eq('id', transaction.id); throw error; }
      const posted = await db.from('transactions').update({ status:'posted', confirmed_at:new Date().toISOString() }).eq('id', transaction.id);
      if (posted.error) { await removeReceiptPath(receiptPath); await db.from('transactions').delete().eq('id', transaction.id); throw posted.error; }
    } else {
      const row = {
        type, status:'posted', description:title, occurred_at:date + 'T12:00:00', amount,
        currency:account.currency, account_id:account.id, capture_source:state.pendingReceipt ? 'receipt' : 'manual', confirmed_at:new Date().toISOString()
      };
      if (type === 'personal_expense') row.category = category;
      if (type === 'income') row.category = 'Income';
      if (type === 'balance_adjustment') {
        row.category = 'Balance adjustment';
        row.adjustment_direction = document.getElementById('adjustment-direction').value;
      }
      const result = await db.from('transactions').insert(row).select('id').single();
      if (result.error) throw result.error;
      try { await attachReceipt(result.data.id); }
      catch (error) { await db.from('transactions').delete().eq('id', result.data.id); throw error; }
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
    showToast(shared ? 'Shared expense saved to Supabase.' : transfer ? 'Transfer saved to Supabase.' : 'Transaction saved to Supabase.');
  } catch (error) { errorBox.textContent = error.message || 'Could not save this transaction.'; errorBox.classList.remove('hidden'); }
  finally { setBusy(button, false, submitLabel); }
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
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); closeGroupModal(); closeAccountModal(); closeSettlementModal(); closeBudgetModal(); if (!document.getElementById('setup-modal').classList.contains('hidden')) skipSetup(); } });
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
document.getElementById('account-list').addEventListener('click', event => {
  const button = event.target.closest('[data-edit-account]');
  if (button) openAccountModal(accountFor(button.dataset.editAccount));
});
document.getElementById('close-budget-modal').addEventListener('click', closeBudgetModal);
document.getElementById('cancel-budget-modal').addEventListener('click', closeBudgetModal);
document.getElementById('budget-modal').addEventListener('click', event => { if (event.target.id === 'budget-modal') closeBudgetModal(); });
document.getElementById('budget-form').addEventListener('submit', saveBudget);
document.getElementById('budget-currency').addEventListener('change', () => refreshBudgetCategoryOptions(document.getElementById('budget-category').value));
document.getElementById('budget-grid').addEventListener('click', event => {
  const edit = event.target.closest('[data-edit-budget]');
  const remove = event.target.closest('[data-delete-budget]');
  if (edit) openBudgetModal(state.budgets.find(budget => budget.id === edit.dataset.editBudget));
  if (remove) deleteBudget(remove.dataset.deleteBudget);
});
document.getElementById('group-list').addEventListener('click', event => {
  if (event.target.closest('[data-create-group]')) openGroupModal();
  const button = event.target.closest('[data-use-group]');
  if (button) openModal('shared', button.dataset.useGroup);
});
document.getElementById('friend-list').addEventListener('click', event => {
  const button = event.target.closest('[data-settle-member]');
  if (button && !button.disabled) openSettlementModal(button.dataset.settleMember);
});
document.getElementById('close-settlement-modal').addEventListener('click', closeSettlementModal);
document.getElementById('cancel-settlement-modal').addEventListener('click', closeSettlementModal);
document.getElementById('settlement-modal').addEventListener('click', event => { if (event.target.id === 'settlement-modal') closeSettlementModal(); });
document.getElementById('settlement-form').addEventListener('submit', saveSettlement);
document.getElementById('entry-kind').addEventListener('change', event => setKind(event.target.value));
document.getElementById('source-account').addEventListener('change', updateTransferDestinationOptions);
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
document.getElementById('receipt-file').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    clearReceiptSelection();
    showToast('Choose a JPEG, PNG, or WebP image up to 10 MB.');
    return;
  }
  if (state.receiptPreviewUrl) URL.revokeObjectURL(state.receiptPreviewUrl);
  state.pendingReceipt = file;
  state.receiptPreviewUrl = URL.createObjectURL(file);
  document.getElementById('receipt-preview-image').src = state.receiptPreviewUrl;
  document.getElementById('receipt-file-name').textContent = file.name;
  document.getElementById('receipt-preview').classList.remove('hidden');
});
document.getElementById('remove-receipt').addEventListener('click', clearReceiptSelection);
document.getElementById('read-receipt').addEventListener('click', readReceiptWithAi);
for (const listId of ['recent-transactions', 'all-transactions']) document.getElementById(listId).addEventListener('click', event => {
  const button = event.target.closest('[data-receipt-path]');
  if (button) openPrivateReceipt(button.dataset.receiptPath);
  const edit = event.target.closest('[data-edit-transaction]');
  if (edit) openTransactionEdit(edit.dataset.editTransaction);
});
document.getElementById('transaction-search').addEventListener('input', renderTransactions);
for (const id of ['filter-type', 'filter-currency', 'filter-start-date', 'filter-end-date']) document.getElementById(id).addEventListener('change', renderTransactions);
document.getElementById('transaction-filters-toggle').addEventListener('click', event => {
  const panel = document.getElementById('transaction-filters');
  const expanded = panel.classList.toggle('hidden') === false;
  event.currentTarget.setAttribute('aria-expanded', String(expanded));
});
document.getElementById('clear-transaction-filters').addEventListener('click', () => {
  document.getElementById('transaction-search').value = '';
  document.getElementById('filter-type').value = 'all';
  document.getElementById('filter-currency').value = 'all';
  document.getElementById('filter-start-date').value = '';
  document.getElementById('filter-end-date').value = '';
  renderTransactions();
});
document.getElementById('export-transactions').addEventListener('click', exportTransactionsCsv);
document.getElementById('invite-friend').addEventListener('click', () => showToast('Add people while creating a group or recording a shared expense.'));
document.getElementById('add-account').addEventListener('click', openAccountModal);
document.getElementById('add-budget').addEventListener('click', () => openBudgetModal());
document.getElementById('learn-more').addEventListener('click', () => showToast('One calm home for your money and your people.'));
document.getElementById('search-toggle').addEventListener('click', () => { setView('transactions'); document.getElementById('transaction-search').focus(); });
document.getElementById('spend-currency').addEventListener('change', event => {
  state.spendCurrency = event.target.value;
  renderLegend();
});
document.getElementById('help-button').addEventListener('click', () => openSetup(0));
async function suggestTransactionDraft() {
  const button = document.getElementById('ai-draft-button');
  const status = document.getElementById('voice-status');
  const text = document.getElementById('description').value.trim();
  if (text.length < 4) { status.textContent = 'Enter or dictate a transaction description first.'; document.getElementById('description').focus(); return; }
  setBusy(button, true, 'Suggest fields');
  status.textContent = 'Preparing a draft…';
  try {
    const result = await db.functions.invoke('parse-transaction', { body: { text } });
    if (result.error) {
      let message = result.error.message || 'Could not prepare a draft. Complete the fields manually.';
      try { message = (await result.error.context.json()).error || message; } catch {}
      throw new Error(message);
    }
    const draft = result.data?.draft;
    if (!draft) throw new Error('No draft was returned. Complete the fields manually.');
    if (['personal_expense', 'income', 'transfer', 'balance_adjustment', 'shared_expense'].includes(draft.transactionType)) setKind(draft.transactionType);
    if (draft.description) document.getElementById('description').value = draft.description;
    if (Number(draft.amount) > 0) document.getElementById('amount').value = draft.amount;
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) document.getElementById('date').value = draft.date;
    if (draft.category && [...document.getElementById('category').options].some(option => option.value === draft.category || option.text === draft.category)) document.getElementById('category').value = draft.category;

    if (draft.currency === 'USD' || draft.currency === 'PEN') {
      const matchingAccount = state.accounts.find(account => account.currency === draft.currency);
      if (matchingAccount && draft.transactionType !== 'transfer') document.getElementById('account').value = matchingAccount.id;
    }
    if (draft.transactionType === 'transfer') {
      const source = state.accounts.find(account => account.name.toLowerCase() === (draft.sourceAccountHint || '').toLowerCase());
      if (source) document.getElementById('source-account').value = source.id;
      updateTransferDestinationOptions();
      const destination = state.accounts.find(account => account.name.toLowerCase() === (draft.destinationAccountHint || '').toLowerCase() && account.currency === accountFor(document.getElementById('source-account').value)?.currency);
      if (destination) document.getElementById('destination-account').value = destination.id;
    }
    if (draft.transactionType === 'balance_adjustment' && ['increase', 'decrease'].includes(draft.adjustmentDirection)) document.getElementById('adjustment-direction').value = draft.adjustmentDirection;
    if (draft.transactionType === 'shared_expense') {
      if (draft.groupName) document.getElementById('group-name').value = draft.groupName;
      if (draft.participants?.length) document.getElementById('friends').value = draft.participants.join(', ');
      if (draft.payer === 'someone_else') {
        document.getElementById('shared-payer').value = 'someone-else';
        if (draft.payerName) document.getElementById('payer-name').value = draft.payerName;
      } else if (draft.payer === 'you') document.getElementById('shared-payer').value = 'you';
      syncPayerFields();
      if (Number(draft.ownerShare) > 0) {
        document.getElementById('my-share').value = draft.ownerShare;
        state.myShareEdited = true;
      } else state.myShareEdited = false;
      updateSplitPreview();
    }
    status.textContent = (draft.clarifyingQuestion ? draft.clarifyingQuestion + ' ' : '') + 'Draft filled in. Review every field before saving.';
  } catch (error) {
    status.textContent = error.message || 'Could not prepare a draft. Complete the fields manually.';
  } finally { setBusy(button, false, 'Suggest fields'); }
}
document.getElementById('ai-draft-button').addEventListener('click', suggestTransactionDraft);
document.getElementById('voice-button').addEventListener('click', () => {
  const status = document.getElementById('voice-status');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { status.textContent = 'Voice input is not supported in this browser. Type your expense instead.'; return; }
  const recognition = new Recognition();
  recognition.lang = navigator.language?.toLowerCase().startsWith('es') ? 'es-ES' : 'en-US';
  recognition.interimResults = false;
  status.textContent = 'Listening…';
  recognition.onresult = event => {
    const phrase = event.results[0][0].transcript;
    status.textContent = 'Captured. Tap Suggest fields to prepare an editable draft.';
    document.getElementById('description').value = phrase;
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
