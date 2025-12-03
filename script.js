/* script.js
   Trip Splitter - Offline
   - Saves to localStorage
   - Greedy settlement matching
   - Export CSV, reset, edit/delete events
*/

const STORAGE_KEY = 'trip_splitter_v1';

let state = {
  members: [],    // {id, name}
  events: []      // {id, name, total, payments: [{memberId, amount}] , createdAt}
};

// --- Utilities ---
const $ = id => document.getElementById(id);
const saveState = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const loadState = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = JSON.parse(raw); } catch(e){ console.warn('bad state'); state = {members:[],events:[]} }
  }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);

// round to 2 decimals safely
function r2(v){
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

// format currency (simple)
function fmt(v){ return '₹' + r2(v).toFixed(2); }

// --- Render functions ---
function renderMembers(){
  const list = $('membersList'); list.innerHTML = '';
  state.members.forEach(m => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${m.name}</span>
      <div class="actions">
        <button class="small-btn" onclick="editMember('${m.id}')">Edit</button>
        <button class="small-btn" onclick="deleteMember('${m.id}')">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
  $('memberCount').textContent = state.members.length;
  renderPaymentsGrid();
  renderEventsList();
}

function renderPaymentsGrid(){
  const grid = $('paymentsGrid');
  grid.innerHTML = '';
  if (state.members.length === 0){
    grid.innerHTML = `<div class="small">Add members first — payments per event will appear here.</div>`;
    return;
  }
  state.members.forEach(m=>{
    const row = document.createElement('div');
    row.className = 'pay-row';
    row.innerHTML = `<div style="width:40%">${m.name}</div>
      <input data-member="${m.id}" placeholder="amount paid by ${m.name}" type="number" min="0" step="0.01" />`;
    grid.appendChild(row);
  });
}

function renderEventsList(){
  const box = $('eventsList'); box.innerHTML = '';
  if (state.events.length === 0){ box.innerHTML = '<div class="small">No events yet.</div>'; return; }
  state.events.slice().reverse().forEach(ev=>{
    const div = document.createElement('div');
    div.className = 'event';
    const paymentsSummary = ev.payments.map(p=>{
      const m = state.members.find(x=>x.id===p.memberId);
      return `${m?m.name:'?'}: ${fmt(p.amount)}`;
    }).join(' • ');
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong>${ev.name}</strong>
          <div class="meta">Total: ${fmt(ev.total)} · ${new Date(ev.createdAt).toLocaleString()}</div>
        </div>
        <div class="small-actions">
          <button class="small-btn" onclick="editEvent('${ev.id}')">Edit</button>
          <button class="small-btn" onclick="deleteEvent('${ev.id}')">Delete</button>
        </div>
      </div>
      <div class="meta">${paymentsSummary}</div>
    `;
    box.appendChild(div);
  });
}

function renderSettlement(result){
  const balancesBox = $('balancesBox');
  const transfersBox = $('transfersBox');

  balancesBox.innerHTML = '';
  transfersBox.innerHTML = '';

  if (!result) return;

  // balances
  const balHeader = document.createElement('h3'); balHeader.textContent = 'Balances';
  balancesBox.appendChild(balHeader);

  result.balances.forEach(b=>{
    const div = document.createElement('div');
    div.className = 'balance-row';
    const name = document.createElement('div');
    name.innerHTML = `<div>${b.name}</div><div class="small">${fmt(b.total_paid)} paid</div>`;
    const amt = document.createElement('div');
    amt.innerHTML = `<div>${fmt(b.share)}</div><div class="${b.balance>0?'balance-positive': b.balance<0 ? 'balance-negative' : ''}">${fmt(b.balance)}</div>`;
    div.appendChild(name); div.appendChild(amt);
    balancesBox.appendChild(div);
  });

  // transfers
  const trHeader = document.createElement('h3'); trHeader.textContent = 'Suggested transfers';
  transfersBox.appendChild(trHeader);

  if (result.transfers.length === 0){
    transfersBox.innerHTML += `<div class="small">No transfers needed — already settled!</div>`;
  } else {
    const ul = document.createElement('ul'); ul.className = 'list';
    result.transfers.forEach(t=>{
      const li = document.createElement('li');
      li.innerHTML = `<span>Pay ${fmt(t.amount)} — ${t.from_name} → ${t.to_name}</span>`;
      ul.appendChild(li);
    });
    transfersBox.appendChild(ul);
  }

  $('totalExpense').textContent = fmt(result.totalExpense);
  $('sharePerPerson').textContent = fmt(result.share);
}

// --- CRUD actions ---
function addMember(){
  const name = $('memberName').value.trim();
  if (!name) return alert('Enter member name');
  const m = { id: uid(), name };
  state.members.push(m);
  saveState(); renderMembers();
  $('memberName').value = '';
}

function editMember(id){
  const m = state.members.find(x=>x.id===id);
  const newName = prompt('Edit member name', m.name);
  if (newName !== null && newName.trim() !== ''){
    m.name = newName.trim();
    saveState(); renderMembers();
  }
}

function deleteMember(id){
  if (!confirm('Delete this member? This will remove associated payments from events.')) return;
  // remove member
  state.members = state.members.filter(m=>m.id!==id);
  // remove payments for this member from events
  state.events.forEach(ev => {
    ev.payments = ev.payments.filter(p => p.memberId !== id);
  });
  saveState(); renderMembers();
}

function addEvent(){
  const name = $('eventName').value.trim();
  const totalStr = $('eventTotal').value;
  if (!name) return alert('Enter event name');
  if (!totalStr || isNaN(totalStr)) return alert('Enter valid total amount');
  const total = r2(totalStr);

  // collect payments
  const inputs = Array.from(document.querySelectorAll('#paymentsGrid input'));
  const payments = inputs.map(inp => {
    const memId = inp.dataset.member;
    const amt = inp.value ? r2(inp.value) : 0;
    return { memberId: memId, amount: amt };
  });

  // Quick validation: sum of payments should ideally equal total, but not enforced.
  const sumPaid = r2(payments.reduce((s,p)=>s + Number(p.amount||0),0));
  if (sumPaid !== total){
    const ok = confirm(`Sum of entered individual payments is ${fmt(sumPaid)} but total is ${fmt(total)}.\nDo you want to continue? (You can edit event later)`);
    if (!ok) return;
  }

  const ev = { id: uid(), name, total, payments, createdAt: Date.now() };
  state.events.push(ev);
  saveState(); renderMembers(); // renderMembers calls events list too
  $('eventName').value=''; $('eventTotal').value='';
  document.querySelectorAll('#paymentsGrid input').forEach(i=>i.value='');
}

function editEvent(id){
  const ev = state.events.find(e=>e.id===id);
  const newName = prompt('Edit event name', ev.name);
  if (newName === null) return;
  const newTotalStr = prompt('Edit total amount', ev.total);
  if (newTotalStr === null) return;
  const newTotal = r2(newTotalStr);
  // optionally edit individual payments
  state.events = state.events.map(e => {
    if (e.id !== id) return e;
    // prompt per member
    const newPayments = e.payments.map(p => {
      const m = state.members.find(mm=>mm.id===p.memberId);
      const val = prompt(`Amount paid by ${m?m.name:'Member'} (leave blank to keep ${p.amount})`, p.amount);
      return { memberId: p.memberId, amount: val === null || val === '' ? p.amount : r2(val) };
    });
    return {...e, name:newName.trim(), total:newTotal, payments:newPayments};
  });
  saveState(); renderMembers();
}

function deleteEvent(id){
  if (!confirm('Delete this event?')) return;
  state.events = state.events.filter(e=>e.id!==id);
  saveState(); renderMembers();
}

function resetAll(){
  if (!confirm('Reset everything? This will clear members & events from your browser.')) return;
  state = { members: [], events: [] };
  saveState(); renderMembers(); renderSettlement(null);
}

// --- Settlement algorithm (greedy matching) ---
function computeSettlement(){
  // total expense = sum of events' total
  const totalExpense = r2(state.events.reduce((s,e)=>s + Number(e.total||0), 0));
  const n = state.members.length;
  if (n === 0) return alert('Add members first');
  // total paid per member (sum over payments across events)
  const totals = state.members.map(m => {
    const totalPaid = r2(state.events.reduce((s,e)=>{
      const p = e.payments.find(pp => pp.memberId === m.id);
      return s + (p ? Number(p.amount||0) : 0);
    }, 0));
    return { member_id: m.id, name: m.name, total_paid: totalPaid };
  });

  const share = n ? r2(totalExpense / n) : 0;

  const balances = totals.map(t => ({
    member_id: t.member_id,
    name: t.name,
    total_paid: t.total_paid,
    share,
    balance: r2(t.total_paid - share) // positive -> should receive
  }));

  // creditors (balance > 0) and debtors (balance < 0)
  let creditors = balances.filter(b => b.balance > 0).map(b => ({...b}));
  let debtors = balances.filter(b => b.balance < 0).map(b => ({...b}));

  // sort creditors desc, debtors asc (most negative first)
  creditors.sort((a,b)=> b.balance - a.balance);
  debtors.sort((a,b)=> a.balance - b.balance);

  const transfers = [];
  let i=0, j=0;
  while (i < debtors.length && j < creditors.length){
    const debtor = debtors[i];
    const creditor = creditors[j];
    const canPay = Math.min(Math.abs(debtor.balance), creditor.balance);
    const amount = r2(canPay);
    if (amount <= 0) break;
    transfers.push({
      from_member_id: debtor.member_id,
      from_name: debtor.name,
      to_member_id: creditor.member_id,
      to_name: creditor.name,
      amount
    });
    // update
    debtor.balance = r2(debtor.balance + amount);
    creditor.balance = r2(creditor.balance - amount);
    // advance pointers
    if (Math.abs(debtor.balance) < 0.01) i++;
    if (creditor.balance < 0.01) j++;
  }

  return { totalExpense, share, balances, transfers };
}

// --- Exports ---
function exportCSV(filename, rows){
  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
}

function exportMembersCSV(){
  const rows = [['id','name']];
  state.members.forEach(m => rows.push([m.id, m.name]));
  exportCSV('members.csv', rows);
}

function exportSettlementCSV(){
  const result = computeSettlement();
  if (!result) return;
  const rows = [['name','total_paid','share','balance']];
  result.balances.forEach(b => rows.push([b.name, b.total_paid, b.share, b.balance]));
  rows.push([]);
  rows.push(['from','to','amount']);
  result.transfers.forEach(t => rows.push([t.from_name, t.to_name, t.amount]));
  exportCSV('settlement.csv', rows);
}

// --- Example populate ---
function fillExample(){
  // clears then fills an example with 5 members and 3 events
  if (!confirm('Fill page with an example (this will overwrite current data)?')) return;
  state.members = [
    {id: uid(), name:'Ravi'},
    {id: uid(), name:'Asha'},
    {id: uid(), name:'Karan'},
    {id: uid(), name:'Sneha'},
    {id: uid(), name:'Vikram'}
  ];
  const m = state.members;
  state.events = [
    {
      id: uid(),
      name: 'Lunch (Day 1)',
      total: 2500,
      payments: [
        {memberId: m[0].id, amount: 500},
        {memberId: m[1].id, amount: 500},
        {memberId: m[2].id, amount: 700},
        {memberId: m[3].id, amount: 300},
        {memberId: m[4].id, amount: 500},
      ],
      createdAt: Date.now()
    },
    {
      id: uid(),
      name: 'Swimming',
      total: 1200,
      payments: [
        {memberId: m[0].id, amount: 0},
        {memberId: m[1].id, amount: 1200},
        {memberId: m[2].id, amount: 0},
        {memberId: m[3].id, amount: 0},
        {memberId: m[4].id, amount: 0},
      ],
      createdAt: Date.now()
    },
    {
      id: uid(),
      name: 'Resort Rent',
      total: 5000,
      payments: [
        {memberId: m[0].id, amount: 1000},
        {memberId: m[1].id, amount: 1000},
        {memberId: m[2].id, amount: 1000},
        {memberId: m[3].id, amount: 1000},
        {memberId: m[4].id, amount: 0},
      ],
      createdAt: Date.now()
    }
  ];
  saveState(); renderMembers(); renderSettlement(null);
}

// --- Wire UI events ---
function init(){
  loadState();
  // initial renders
  renderMembers();
  renderSettlement(null);

  $('addMemberBtn').addEventListener('click', addMember);
  $('addEventBtn').addEventListener('click', addEvent);
  $('resetBtn').addEventListener('click', resetAll);
  $('computeBtn').addEventListener('click', ()=> {
    const res = computeSettlement();
    renderSettlement(res);
  });
  $('exportBtn').addEventListener('click', exportSettlementCSV);
  $('exportMembersBtn').addEventListener('click', exportMembersCSV);
  $('showExampleBtn').addEventListener('click', fillExample);

  // allow Enter to add member
  $('memberName').addEventListener('keydown', (e)=> { if (e.key==='Enter') addMember();});
}

init();
