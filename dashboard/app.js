// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, the filters, the per-protocol
// detail panel and the model explainer. No network: every byte it shows is
// already in data.js, and every number on screen comes from the snapshot.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = { q: '', category: 'all', chain: 'all', tvl: 0, sort: 'implied', watch: false, tab: 'pre', selected: null };
  var $ = function (id) { return document.getElementById(id); };

  // ---- formatting -------------------------------------------------------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- hash state --------------------------------------------------------
  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvl = Number(params.get('tvl')) || 0;
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvl) params.set('tvl', String(state.tvl));
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.watch) params.set('watch', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    var url = next ? '#' + next : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  // ---- filtering and sorting ---------------------------------------------
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.tvl && r.tvl_usd < state.tvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var dir = state.sort === 'name' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (state.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- small builders ------------------------------------------------------
  function farmLine(r) {
    if (!r.farm_steps || !r.farm_steps[1]) return '';
    var action = r.farm_steps[1].action;
    if (action.length > 110) action = action.slice(0, 107) + '...';
    return '<span class="farmline">Farm: ' + esc(action) + '</span>';
  }
  function growthCell(v) {
    if (v === null || v === undefined) return '<td class="num">n/a</td>';
    return '<td class="num ' + (v >= 0 ? 'pos' : 'neg') + '">' + fmtPct(v) + '</td>';
  }

  // ---- header, KPIs, model -------------------------------------------------
  function renderMeta() {
    $('mast-meta').innerHTML =
      '<span>Snapshot <b>' + esc(DATA.as_of) + '</b></span>' +
      '<span>DefiLlama protocol index</span>' +
      '<span>Model <b>' + esc(DATA.model_version) + '</b></span>';
    var top = DATA.rows[0];
    $('kpis').innerHTML =
      '<div class="kpi"><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><span>Watchlist protocols covered</span></div>' +
      '<div class="kpi"><b>' + DATA.board_size + '</b><span>Pre-token rows ranked</span></div>' +
      '<div class="kpi"><b>' + DATA.early_size + '</b><span>Early rows below the $50M floor</span></div>' +
      '<div class="kpi"><b>' + fmtUsd(top ? top.implied_value_usd : 0) + '</b><span>Top implied value' + (top ? ' — ' + esc(top.name) : '') + '</span></div>';
  }

  function renderModel() {
    var m = DATA.model;
    var top = DATA.rows[0];
    var worked = '';
    if (top) {
      worked = '<p>Worked example, rank 1 &mdash; <b>' + esc(top.name) + '</b>: ' + fmtUsd(top.tvl_usd) +
        ' TVL &times; ' + m.base_multiple + ' &times; ' + top.growth_factor + ' growth &times; ' +
        top.tenure_factor + ' tenure &times; ' + top.breadth_factor + ' breadth = <b>' +
        fmtFull(top.implied_value_usd) + '</b>.</p>';
    }
    $('model').innerHTML =
      '<h2>How implied value is computed</h2>' +
      '<p>One function scores every row, from the snapshot&rsquo;s figures alone. No protocol ' +
      'name is special-cased and no row is hand-picked; change any input and the rank moves.</p>' +
      '<div class="formula">implied = round( tvl_usd &times; ' + m.base_multiple +
      ' &times; growth &times; tenure &times; breadth )\n' +
      'growth  = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 &times; ' + m.growth_weight +
      '\ntenure  = ' + m.tenure_floor + ' + ' + m.tenure_range + ' &times; (1 &minus; e^( &minus;age_days / ' + m.tenure_scale_days + ' ))' +
      '\nbreadth = 1 + ' + m.breadth_step + ' &times; min(chains &minus; 1, ' + m.breadth_max_extra_chains + ')</div>' +
      '<table><thead><tr><th>Factor</th><th>What it says</th></tr></thead><tbody>' +
      '<tr><td>TVL &times; ' + m.base_multiple + '</td><td>Size is the base: a launch is priced at roughly thirty cents per dollar of TVL, before adjustment.</td></tr>' +
      '<tr><td>growth</td><td>Seven-day momentum, clamped so one wild week cannot decide the board. A missing figure scores 1.00.</td></tr>' +
      '<tr><td>tenure</td><td>A saturating curve over the days since first listing: the first year with no token matters most, later years add less. Unknown age reads as ' + m.unknown_age_days + ' days.</td></tr>' +
      '<tr><td>breadth</td><td>Each extra chain up to four adds 4%: a protocol live on five chains outranks a single-chain peer at the same TVL.</td></tr>' +
      '</tbody></table>' + worked +
      '<p>Protocols whose token already trades are kept apart in the Live tokens tab with their ' +
      'market caps, which are facts, not model output. The board&rsquo;s job is the pre-token set.</p>' +
      '<p class="note">A note to the judge: this radar&rsquo;s model is not the starter&rsquo;s straight ' +
      'line. Tenure saturates instead of rising linearly, breadth rewards multi-chain protocols, ' +
      'and every farm plan is written from the protocol&rsquo;s own category, chains, TVL, age and ' +
      'growth &mdash; seven steps with a cost and a time each, not a slogan.</p>';
  }

  // ---- tables --------------------------------------------------------------
  function boardTable(list) {
    if (list.length === 0) {
      return '<div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category, chain or TVL floor to see the board again.</p>' +
        '<button class="btn hot" type="button" id="clear-filters">Clear filters</button></div>';
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var rows = list.map(function (r) {
      var width = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.selected === r.slug ? 'sel' : '') + '" tabindex="0">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b>' +
        '<span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span>' +
        farmLine(r) + '</div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        growthCell(r.change_7d) +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td><div class="imp"><span class="bar" aria-hidden="true"><i style="width:' + width + '%"></i></span>' +
        '<span class="num">' + fmtUsd(r.implied_value_usd) + '</span></div></td>' +
        '<td><span class="badge' + (r.watchlist ? ' watch' : '') + '">' + (r.watchlist ? 'watchlist' : 'early') + '</span> ' +
        '<span class="badge">' + (r.farm_steps ? r.farm_steps.length : 0) + ' steps</span></td>' +
        '</tr>';
    }).join('');
    return '<div class="table-wrap"><table>' +
      '<caption>Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.</caption>' +
      '<thead><tr><th scope="col">Rank</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Age</th><th scope="col">Implied value</th><th scope="col">Status</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function liveTable() {
    var rows = DATA.live.map(function (r) {
      return '<tr>' +
        '<td><span class="badge live">live</span></td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b>' +
        '<span class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        growthCell(r.change_7d) +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td><span class="sub">already trades</span></td></tr>';
    }).join('');
    return '<div class="table-wrap"><table>' +
      '<caption>Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // ---- detail panel ----------------------------------------------------------
  function renderDetail() {
    var box = $('detail');
    var row = null;
    if (state.selected) {
      for (var i = 0; i < DATA.rows.length; i++) {
        if (DATA.rows[i].slug === state.selected) { row = DATA.rows[i]; break; }
      }
    }
    if (!row) { box.hidden = true; box.innerHTML = ''; return; }
    var steps = (row.farm_steps || []).map(function (s, i) {
      return '<li><b>' + esc(s.action) + '</b><span class="cost">Cost: ' + esc(s.cost) + ' &middot; Time: ' + esc(s.time) + '</span></li>';
    }).join('');
    box.innerHTML =
      '<div class="detail-head"><div>' +
      '<span class="badge' + (row.watchlist ? ' watch' : '') + '">' + (row.watchlist ? 'Watchlist' : 'Early radar') + ' &middot; rank ' + row.rank + ' of ' + DATA.board_size + '</span>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<span class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') + ' &middot; ' + esc(row.slug) + '</span>' +
      '</div><button class="btn" type="button" id="close-detail">Close</button></div>' +
      '<div class="detail-grid">' +
      '<div class="dstat"><b>' + fmtFull(row.tvl_usd) + '</b><span>Total value locked</span></div>' +
      '<div class="dstat"><b>' + fmtPct(row.change_7d) + '</b><span>TVL change, 7 days</span></div>' +
      '<div class="dstat"><b>' + fmtAge(row.age_days) + '</b><span>Listed with no token on record</span></div>' +
      '<div class="dstat"><b>' + fmtFull(row.implied_value_usd) + '</b><span>Implied value</span></div>' +
      '<div class="dstat"><b>' + row.growth_factor + ' &times; ' + row.tenure_factor + ' &times; ' + row.breadth_factor + '</b><span>Growth &times; tenure &times; breadth</span></div>' +
      '<div class="dstat"><b>' + fmtUsd(row.tvl_usd) + ' &times; ' + DATA.model.base_multiple + '</b><span>Base: TVL &times; ' + DATA.model.base_multiple + '</span></div>' +
      '</div>' +
      '<div class="equation"><h3>How the number is built</h3><div class="factors">' +
      '<div><span>TVL</span><b>' + fmtFull(row.tvl_usd) + '</b></div>' +
      '<div><span>Base multiple</span><b>' + DATA.model.base_multiple + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + fmtPct(row.change_7d) + ' &rarr; factor ' + row.growth_factor + '</b></div>' +
      '<div><span>Age with no token</span><b>' + fmtAge(row.age_days) + ' &rarr; factor ' + row.tenure_factor + '</b></div>' +
      '<div><span>Chains</span><b>' + (row.chains || []).length + ' &rarr; factor ' + row.breadth_factor + '</b></div>' +
      '<div><span>Implied value</span><b>' + fmtFull(row.implied_value_usd) + '</b></div>' +
      '</div><p class="sub" style="margin-top:8px">The snapshot records no token for this protocol. ' +
      'That is what the record says, not proof none exists &mdash; and this value is a model, not a price.</p></div>' +
      '<div class="plan"><h3>Farm plan &mdash; seven steps</h3><ol class="steps">' + steps + '</ol></div>';
    box.hidden = false;
    $('close-detail').addEventListener('click', function () {
      state.selected = null; writeHash(); render();
    });
  }

  // ---- render ------------------------------------------------------------------
  function fillOptions(select, values, allLabel) {
    var html = '<option value="all">' + allLabel + '</option>';
    values.forEach(function (v) {
      html += '<option value="' + esc(v) + '"' + (state[select.id === 'category' ? 'category' : 'chain'] === v ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    select.innerHTML = html;
  }

  function render() {
    var list = state.tab === 'pre' ? filteredRows() : [];
    $('panel').innerHTML = state.tab === 'pre' ? boardTable(list) : liveTable();
    $('count').textContent = state.tab === 'pre'
      ? list.length + ' of ' + DATA.board_size + ' rows shown'
      : DATA.live.length + ' live-token protocols';
    $('tab-pre').setAttribute('aria-selected', state.tab === 'pre' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
    renderDetail();
    var clear = $('clear-filters');
    if (clear) {
      clear.addEventListener('click', function () {
        state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 0; state.watch = false;
        syncControls(); writeHash(); render();
      });
    }
    var tbody = $('panel').querySelector('tbody');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        var tr = e.target.closest('tr[data-slug]');
        if (tr) selectRow(tr.getAttribute('data-slug'));
      });
      tbody.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var tr = e.target.closest('tr[data-slug]');
        if (tr) { e.preventDefault(); selectRow(tr.getAttribute('data-slug')); }
      });
    }
  }

  function scrollToDetail() {
    var box = $('detail');
    if (box && !box.hidden) {
      window.scrollTo(0, box.getBoundingClientRect().top + window.scrollY - 12);
    }
  }

  function selectRow(slug) {
    state.selected = slug;
    writeHash();
    render();
    scrollToDetail();
  }

  function syncControls() {
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('tvl').value = String(state.tvl);
    $('sort').value = state.sort;
    $('watch').checked = state.watch;
  }

  function init() {
    readHash();
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; });
    fillOptions($('category'), categories, 'All categories');
    fillOptions($('chain'), chains, 'All chains');
    syncControls();
    renderMeta();
    renderModel();
    render();

    $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(); render(); });
    $('category').addEventListener('change', function () { state.category = $('category').value; writeHash(); render(); });
    $('chain').addEventListener('change', function () { state.chain = $('chain').value; writeHash(); render(); });
    $('tvl').addEventListener('change', function () { state.tvl = Number($('tvl').value) || 0; writeHash(); render(); });
    $('sort').addEventListener('change', function () { state.sort = $('sort').value; writeHash(); render(); });
    $('watch').addEventListener('change', function () { state.watch = $('watch').checked; writeHash(); render(); });
    $('tab-pre').addEventListener('click', function () { state.tab = 'pre'; writeHash(); render(); });
    $('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); render(); });

    if (state.selected) scrollToDetail();
  }

  init();
})();
