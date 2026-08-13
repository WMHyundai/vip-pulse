// VIP Pulse — VIP 고객 이벤트 관제 대시보드
// 목업 자산/거래/만기 데이터 기반으로 규칙 기반 이벤트를 감지하고, 이벤트 유형 가중치·자산
// 규모·변동폭을 종합한 규칙 기반 점수로 우선순위를 매긴다.
// PB의 확인/대응 상태·메모는 Supabase(event_actions 테이블)에 저장해 새로고침 후에도 유지한다.

(function () {
  // TODO: 본인 Supabase 프로젝트의 URL/anon key로 교체하세요.
  const SUPABASE_URL = "https://nflqrpxytzkumbtdzclu.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mbHFycHh5dHprdW1idGR6Y2x1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0ODU4NjUsImV4cCI6MjEwMjA2MTg2NX0.2YlRRdHalk4gfkQddk1zd9phtP7otzvJaAPdKN-5-Hg";
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const DEFAULT_THRESHOLDS = {
    ASSET_CHANGE_PCT: 0.1, // ±10%
    MATURITY_DAYS: 7, // D-7 이내
    TXN_MULTIPLIER: 3, // 평소 대비 3배 이상
    TXN_LOOKBACK_DAYS: 3, // 최근 3일 이내 거래만 이상 거래 후보로 검토
  };

  const THRESHOLDS_STORAGE_KEY = "vip-pulse-thresholds";
  const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2분마다 신규 이벤트 자동 감지

  function loadThresholds() {
    try {
      const raw = localStorage.getItem(THRESHOLDS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_THRESHOLDS };
      const saved = JSON.parse(raw);
      return { ...DEFAULT_THRESHOLDS, ...saved };
    } catch (e) {
      return { ...DEFAULT_THRESHOLDS };
    }
  }

  const THRESHOLDS = loadThresholds();

  const TYPE_META = {
    asset_drop: { label: "자산 급감", weight: 35 },
    asset_rise: { label: "자산 급증", weight: 15 },
    maturity: { label: "상품 만기 임박", weight: 20 },
    anomaly_txn: { label: "이상 거래 감지", weight: 40 },
  };

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function daysBetween(from, to) {
    const ms = new Date(to).setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0);
    return Math.round(ms / 86400000);
  }

  const TODAY = new Date();

  function monthLabel(monthsAgo) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - monthsAgo, 1);
    return `${d.getMonth() + 1}월`;
  }

  function buildAssetHistory(values) {
    return values.map((total, i) => ({ month: monthLabel(values.length - 1 - i), total }));
  }

  // 목업 VIP 고객 데이터 (자산 추이 6개월, 보유 상품 만기, 최근 거래 내역)
  const BASE_CUSTOMERS = [
    {
      id: "C1",
      name: "김민석",
      assetHistory: buildAssetHistory([58.0, 57.1, 56.3, 55.0, 54.2, 46.1]),
      products: [{ name: "정기예금 1호", maturityDate: formatDate(addDays(TODAY, 45)), amount: 10 }],
      avgTransactionAmount: 0.4,
      transactions: [
        { date: formatDate(addDays(TODAY, -2)), type: "이체", amount: 0.5 },
        { date: formatDate(addDays(TODAY, -10)), type: "입금", amount: 0.3 },
      ],
    },
    {
      id: "C2",
      name: "이서연",
      assetHistory: buildAssetHistory([79.5, 80.2, 80.9, 81.4, 82.0, 83.1]),
      products: [
        { name: "정기예금 3호", maturityDate: formatDate(addDays(TODAY, 5)), amount: 20 },
        { name: "ELS 105-B", maturityDate: formatDate(addDays(TODAY, 90)), amount: 15 },
      ],
      avgTransactionAmount: 0.6,
      transactions: [{ date: formatDate(addDays(TODAY, -1)), type: "입금", amount: 0.7 }],
    },
    {
      id: "C3",
      name: "박준호",
      assetHistory: buildAssetHistory([34.8, 34.5, 34.0, 33.8, 33.5, 32.9]),
      products: [{ name: "채권형 펀드 A", maturityDate: formatDate(addDays(TODAY, 60)), amount: 8 }],
      avgTransactionAmount: 0.3,
      transactions: [
        { date: formatDate(addDays(TODAY, -1)), type: "출금", amount: 1.8 },
        { date: formatDate(addDays(TODAY, -15)), type: "입금", amount: 0.35 },
      ],
    },
    {
      id: "C4",
      name: "최유진",
      assetHistory: buildAssetHistory([101.0, 102.6, 104.1, 105.8, 107.3, 120.5]),
      products: [{ name: "정기예금 2호", maturityDate: formatDate(addDays(TODAY, 120)), amount: 30 }],
      avgTransactionAmount: 1.2,
      transactions: [{ date: formatDate(addDays(TODAY, -3)), type: "입금", amount: 13.0 }],
    },
    {
      id: "C5",
      name: "정다혜",
      assetHistory: buildAssetHistory([56.0, 56.8, 57.4, 57.9, 58.4, 59.0]),
      products: [{ name: "ELS 202-A", maturityDate: formatDate(addDays(TODAY, 2)), amount: 15 }],
      avgTransactionAmount: 0.4,
      transactions: [{ date: formatDate(addDays(TODAY, -1)), type: "이체", amount: 2.5 }],
    },
    {
      id: "C6",
      name: "강태오",
      assetHistory: buildAssetHistory([35.0, 34.2, 33.5, 32.6, 31.8, 25.4]),
      products: [{ name: "정기예금 4호", maturityDate: formatDate(addDays(TODAY, 200)), amount: 12 }],
      avgTransactionAmount: 0.5,
      transactions: [{ date: formatDate(addDays(TODAY, -2)), type: "출금", amount: 4.2 }],
    },
    {
      id: "C7",
      name: "한소영",
      assetHistory: buildAssetHistory([96.5, 96.1, 95.8, 95.5, 95.2, 72.0]),
      products: [{ name: "정기예금 5호", maturityDate: formatDate(addDays(TODAY, 150)), amount: 25 }],
      avgTransactionAmount: 0.8,
      transactions: [{ date: formatDate(addDays(TODAY, -5)), type: "입금", amount: 0.9 }],
    },
    {
      id: "C8",
      name: "윤재호",
      assetHistory: buildAssetHistory([61.0, 61.2, 60.8, 61.1, 60.9, 61.3]),
      products: [{ name: "정기예금 6호", maturityDate: formatDate(addDays(TODAY, 90)), amount: 18 }],
      avgTransactionAmount: 0.6,
      transactions: [{ date: formatDate(addDays(TODAY, -4)), type: "입금", amount: 0.7 }],
    },
  ];

  function cloneCustomers(customers) {
    return JSON.parse(JSON.stringify(customers));
  }

  // 고객의 자산·거래·만기 데이터를 규칙 기반 임계치로 검사해 이벤트 후보를 만든다.
  function detectEvents(customers) {
    const events = [];

    customers.forEach((c) => {
      const hist = c.assetHistory;
      const prev = hist[hist.length - 2].total;
      const curr = hist[hist.length - 1].total;
      const pct = (curr - prev) / prev;

      if (Math.abs(pct) >= THRESHOLDS.ASSET_CHANGE_PCT) {
        const type = pct < 0 ? "asset_drop" : "asset_rise";
        const pctStr = `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`;
        events.push(
          buildEvent(c, type, `최근 1개월 자산 ${prev.toFixed(1)}억원 → ${curr.toFixed(1)}억원 (${pctStr})`, {
            pct,
          })
        );
      }

      c.products.forEach((p) => {
        const days = daysBetween(TODAY, p.maturityDate);
        if (days >= 0 && days <= THRESHOLDS.MATURITY_DAYS) {
          events.push(
            buildEvent(c, "maturity", `${p.name} 만기 D-${days} (${p.amount}억원)`, { days, product: p }, `${p.name}_${p.maturityDate}`)
          );
        }
      });

      c.transactions.forEach((t) => {
        const daysAgo = daysBetween(t.date, TODAY);
        const multiplier = t.amount / c.avgTransactionAmount;
        if (daysAgo >= 0 && daysAgo <= THRESHOLDS.TXN_LOOKBACK_DAYS && multiplier >= THRESHOLDS.TXN_MULTIPLIER) {
          events.push(
            buildEvent(
              c,
              "anomaly_txn",
              `평소 대비 ${multiplier.toFixed(1)}배 규모의 ${t.type} ${t.amount.toFixed(1)}억원 발생 (${t.date})`,
              { multiplier, txn: t },
              `${t.date}_${t.type}_${t.amount}`
            )
          );
        }
      });
    });

    return events;
  }

  function buildEvent(customer, type, detail, data, keySuffix) {
    const meta = TYPE_META[type];
    const assetTotal = customer.assetHistory[customer.assetHistory.length - 1].total;
    const event = {
      eventKey: keySuffix ? `${customer.id}_${type}_${keySuffix}` : `${customer.id}_${type}`,
      customerId: customer.id,
      customerName: customer.name,
      customerAssetTotal: assetTotal,
      type,
      label: meta.label,
      detail,
      data,
      status: "미확인",
      memo: "",
    };
    event.ruleScore = computeRuleScore(event);
    return event;
  }

  // 규칙 기반 우선순위 점수 (이벤트 유형 가중치 + 자산 규모 + 변동폭)
  function computeRuleScore(event) {
    const meta = TYPE_META[event.type];
    const sizeFactor = Math.min(event.customerAssetTotal / 10, 12);
    let magnitudeFactor = 0;
    if (event.type === "asset_drop" || event.type === "asset_rise") {
      magnitudeFactor = Math.min(Math.abs(event.data.pct) * 100, 30);
    } else if (event.type === "maturity") {
      magnitudeFactor = Math.max(0, (THRESHOLDS.MATURITY_DAYS - event.data.days) * 3);
    } else if (event.type === "anomaly_txn") {
      magnitudeFactor = Math.min(event.data.multiplier * 3, 30);
    }
    return Math.round(meta.weight + sizeFactor + magnitudeFactor);
  }

  function fallbackUrgency(score) {
    if (score >= 55) return "high";
    if (score >= 30) return "medium";
    return "low";
  }

  function urgencyOf(event) {
    return fallbackUrgency(event.ruleScore);
  }

  const RULE_RECOMMENDATION_BUILDERS = {
    asset_drop: (event) => {
      const pct = Math.abs(event.data.pct * 100);
      const severity = pct >= 15 ? "매우 큰 폭으로" : "큰 폭으로";
      return `${event.customerName} 고객의 자산이 최근 1개월간 ${pct.toFixed(1)}% ${severity} 감소했습니다. 이탈 징후일 수 있으니 오늘 중 연락해 사유를 파악하고 필요한 조치를 안내하세요.`;
    },
    asset_rise: (event) => {
      const pct = (event.data.pct * 100).toFixed(1);
      return `${event.customerName} 고객의 자산이 최근 1개월간 ${pct}% 증가했습니다. 신규 자금 유입 가능성이 있으니 추가 상품 상담 기회로 활용해 보세요.`;
    },
    maturity: (event) => {
      const { days, product } = event.data;
      const urgency = days <= 2 ? "임박했으니 즉시" : "다가오니 이번 주 중";
      return `${event.customerName} 고객의 ${product.name}(${product.amount}억원)이 D-${days}로 만기가 ${urgency} 재예치 또는 후속 상품 상담을 제안하세요.`;
    },
    anomaly_txn: (event) => {
      const { multiplier, txn } = event.data;
      return `${event.customerName} 고객에게 평소 대비 ${multiplier.toFixed(1)}배 규모의 ${txn.type}(${txn.amount.toFixed(1)}억원)이 발생했습니다. 사유를 확인하고 필요시 고객에게 연락하세요.`;
    },
  };

  function ruleRecommendation(event) {
    const builder = RULE_RECOMMENDATION_BUILDERS[event.type];
    return builder ? builder(event) : "이벤트 상세를 확인하고 필요한 대응을 진행하세요.";
  }

  function scoreOf(event) {
    return event.ruleScore;
  }

  // ---- 애플리케이션 상태 ----
  const state = {
    customers: [],
    events: [],
    statusFilter: "",
    searchQuery: "",
    selectedEventKey: null,
    selectedCustomerId: null,
    listMode: "events", // "events" | "customers"
    historyByCustomer: {},
    watchlistRows: [],
  };

  // ---- DOM 참조 ----
  const metaDateEl = document.getElementById("meta-date");
  const metaTotalEl = document.getElementById("meta-total");
  const metaHighEl = document.getElementById("meta-high");
  const refreshBtn = document.getElementById("refresh-btn");
  const statusFilterEl = document.getElementById("status-filter");
  const statusFilterLabelEl = document.getElementById("status-filter-label");
  const eventListDescEl = document.getElementById("event-list-desc");
  const modeTabEventsEl = document.getElementById("mode-tab-events");
  const modeTabCustomersEl = document.getElementById("mode-tab-customers");
  const customerSearchEl = document.getElementById("customer-search");
  const topPriorityListEl = document.getElementById("top-priority-list");
  const watchlistListEl = document.getElementById("watchlist-list");
  const eventListEl = document.getElementById("event-list");
  const detailPanelEl = document.getElementById("detail-panel");
  const toastEl = document.getElementById("toast");
  const settingsBtn = document.getElementById("settings-btn");
  const settingsModalEl = document.getElementById("settings-modal");
  const settingsCancelBtn = document.getElementById("settings-cancel-btn");
  const settingsSaveBtn = document.getElementById("settings-save-btn");
  const settingsResetBtn = document.getElementById("settings-reset-btn");
  const settingAssetPctEl = document.getElementById("setting-asset-pct");
  const settingMaturityDaysEl = document.getElementById("setting-maturity-days");
  const settingTxnMultiplierEl = document.getElementById("setting-txn-multiplier");
  const settingTxnLookbackEl = document.getElementById("setting-txn-lookback");

  let toastTimer = null;
  function showToast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle("error", !!isError);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 4000);
  }

  function formatDisplayDate(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
    return `${y}년 ${m}월 ${d}일 (${weekday})`;
  }

  function statusBadgeClass(status) {
    if (status === "대응완료") return "status-done";
    if (status === "확인함") return "status-ack";
    return "";
  }

  function sortedVisibleEvents() {
    let list = state.events.slice();
    if (state.statusFilter) list = list.filter((e) => e.status === state.statusFilter);
    if (state.searchQuery) {
      const q = state.searchQuery.trim().toLowerCase();
      list = list.filter((e) => e.customerName.toLowerCase().includes(q));
    }
    list.sort((a, b) => scoreOf(b) - scoreOf(a));
    return list;
  }

  function updateMetaCounts() {
    metaTotalEl.textContent = `전체 이벤트 ${state.events.length}건`;
    const highCount = state.events.filter((e) => urgencyOf(e) === "high" && e.status !== "대응완료").length;
    metaHighEl.textContent = `긴급 ${highCount}건`;
  }

  function renderEventList() {
    eventListEl.innerHTML = "";

    if (state.listMode === "customers") {
      renderCustomerDirectoryItems();
    } else {
      const list = sortedVisibleEvents();
      if (list.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent =
          state.statusFilter || state.searchQuery ? "조건에 맞는 이벤트가 없습니다." : "감지된 이벤트가 없습니다.";
        eventListEl.appendChild(empty);
      } else {
        list.forEach((event) => eventListEl.appendChild(createEventItem(event)));
      }
    }

    updateMetaCounts();
    renderTopPriority();
  }

  function visibleCustomers() {
    const q = state.searchQuery.trim().toLowerCase();
    return state.customers
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }

  function renderCustomerDirectoryItems() {
    const list = visibleCustomers();

    if (list.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "검색 결과가 없습니다.";
      eventListEl.appendChild(empty);
      return;
    }

    list.forEach((customer) => eventListEl.appendChild(createCustomerDirectoryItem(customer)));
  }

  function createCustomerDirectoryItem(customer) {
    const li = document.createElement("li");
    li.className = "event-item";
    if (!state.selectedEventKey && customer.id === state.selectedCustomerId) li.classList.add("selected");

    const top = document.createElement("div");
    top.className = "event-item-top";

    const name = document.createElement("span");
    name.className = "event-item-customer";
    name.textContent = customer.name;

    const asset = document.createElement("span");
    asset.className = "event-item-score";
    const total = customer.assetHistory[customer.assetHistory.length - 1].total;
    asset.textContent = `${total.toFixed(1)}억원`;

    top.append(name, asset);

    const summary = document.createElement("div");
    summary.className = "event-item-detail";
    const activeCount = state.events.filter((e) => e.customerId === customer.id).length;
    summary.textContent = activeCount > 0 ? `활성 이벤트 ${activeCount}건` : "활성 이벤트 없음";

    li.append(top, summary);
    li.addEventListener("click", () => {
      state.selectedEventKey = null;
      state.selectedCustomerId = customer.id;
      renderEventList();
      renderDetail();
    });

    return li;
  }

  function topPriorityEvents(n) {
    return state.events
      .filter((e) => e.status !== "대응완료")
      .slice()
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, n);
  }

  function renderTopPriority() {
    const top = topPriorityEvents(3);
    topPriorityListEl.innerHTML = "";

    if (top.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "대응이 필요한 이벤트가 없습니다.";
      topPriorityListEl.appendChild(empty);
      return;
    }

    top.forEach((event, i) => {
      const li = document.createElement("li");
      li.className = `top-priority-card urgency-${urgencyOf(event)} type-${event.type}`;
      if (event.eventKey === state.selectedEventKey) li.classList.add("selected");

      const scoreLabel = `${event.ruleScore}점`;
      const rank = document.createElement("span");
      rank.className = "top-priority-rank";
      rank.textContent = `TOP ${i + 1} · ${scoreLabel}`;

      const customer = document.createElement("span");
      customer.className = "top-priority-customer";
      customer.textContent = event.customerName;

      const label = document.createElement("span");
      label.className = "top-priority-label";
      label.textContent = `${event.label} — ${event.detail}`;

      li.append(rank, customer, label);
      li.addEventListener("click", () => {
        state.selectedEventKey = event.eventKey;
        state.selectedCustomerId = null;
        renderEventList();
        renderDetail();
      });
      topPriorityListEl.appendChild(li);
    });
  }

  function createEventItem(event) {
    const li = document.createElement("li");
    li.className = `event-item urgency-${urgencyOf(event)} type-${event.type}`;
    if (event.eventKey === state.selectedEventKey) li.classList.add("selected");
    li.dataset.eventKey = event.eventKey;

    const top = document.createElement("div");
    top.className = "event-item-top";

    const customer = document.createElement("span");
    customer.className = "event-item-customer";
    customer.textContent = event.customerName;

    const score = document.createElement("span");
    score.className = "event-item-score";
    score.textContent = `${event.ruleScore}점`;

    top.append(customer, score);

    const label = document.createElement("div");
    label.className = "event-item-label";
    label.textContent = event.label;

    const detail = document.createElement("div");
    detail.className = "event-item-detail";
    detail.textContent = event.detail;

    const status = document.createElement("span");
    status.className = `event-item-status ${statusBadgeClass(event.status)}`;
    status.textContent = event.status;

    li.append(top, label, detail, status);
    li.addEventListener("click", () => {
      state.selectedEventKey = event.eventKey;
      state.selectedCustomerId = null;
      renderEventList();
      renderDetail();
    });

    return li;
  }

  // 최근 N개월 자산 추이를 보여주는 라인 차트 (단일 시리즈이므로 범례 없음, 끝점에 값 직접 표시)
  function renderAssetTrendChart(history) {
    const width = 600;
    const height = 200;
    const marginLeft = 46;
    const marginRight = 16;
    const marginTop = 20;
    const marginBottom = 26;
    const plotW = width - marginLeft - marginRight;
    const plotH = height - marginTop - marginBottom;

    const values = history.map((h) => h.total);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const pad = Math.max((maxVal - minVal) * 0.15, 1);
    const scaleMax = maxVal + pad;
    const scaleMin = Math.max(minVal - pad, 0);

    const xStep = history.length > 1 ? plotW / (history.length - 1) : 0;
    const xFor = (i) => marginLeft + i * xStep;
    const yFor = (v) => marginTop + plotH - ((v - scaleMin) / (scaleMax - scaleMin)) * plotH;

    const points = history.map((h, i) => ({ x: xFor(i), y: yFor(h.total), month: h.month, total: h.total }));

    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const baseline = (marginTop + plotH).toFixed(1);
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`;

    const gridLines = [scaleMin, (scaleMin + scaleMax) / 2, scaleMax]
      .map((v) => {
        const y = yFor(v).toFixed(1);
        return `<line x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}" class="chart-grid" /><text x="${marginLeft - 8}" y="${y}" class="chart-axis-label" text-anchor="end" dominant-baseline="middle">${Math.round(v)}</text>`;
      })
      .join("");

    const xLabels = points
      .map((p) => `<text x="${p.x.toFixed(1)}" y="${height - 6}" class="chart-axis-label" text-anchor="middle">${p.month}</text>`)
      .join("");

    const dots = points
      .map((p, i) => {
        const isLast = i === points.length - 1;
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isLast ? 4 : 3}" class="chart-dot"></circle><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="12" class="chart-hit"><title>${p.month}: ${p.total.toFixed(1)}억원</title></circle>`;
      })
      .join("");

    const last = points[points.length - 1];
    const endLabel = `<text x="${last.x.toFixed(1)}" y="${(last.y - 12).toFixed(1)}" class="chart-end-label" text-anchor="${last.x > width - 70 ? "end" : "middle"}">${last.total.toFixed(1)}억원</text>`;

    return `
      <svg class="asset-trend-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="최근 ${history.length}개월 자산 추이, 최근값 ${last.total.toFixed(1)}억원">
        <defs>
          <linearGradient id="assetTrendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0075de" stop-opacity="0.32"></stop>
            <stop offset="100%" stop-color="#0075de" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${gridLines}
        <path d="${areaPath}" fill="url(#assetTrendGradient)" stroke="none"></path>
        <path d="${linePath}" class="chart-line"></path>
        ${dots}
        ${xLabels}
        ${endLabel}
      </svg>`;
  }

  function buildCustomerHeaderHtml(customer) {
    const hist = customer.assetHistory;
    const prev = hist[hist.length - 2];
    const curr = hist[hist.length - 1];
    const pct = ((curr.total - prev.total) / prev.total) * 100;
    const trendClass = pct >= 0 ? "trend-up" : "trend-down";
    const trendSign = pct >= 0 ? "+" : "";

    return `
      <div class="detail-section detail-header">
        <div>
          <h2>${customer.name}</h2>
          <div class="detail-asset-total">보유 자산 총액 ${curr.total.toFixed(1)}억원</div>
        </div>
        <div class="asset-trend">
          <span>${prev.month} ${prev.total.toFixed(1)}억원 → ${curr.month} ${curr.total.toFixed(1)}억원</span>
          <span class="${trendClass}">${trendSign}${pct.toFixed(1)}%</span>
        </div>
      </div>

      <div class="detail-section">
        <h3>자산 추이 (최근 ${hist.length}개월)</h3>
        ${renderAssetTrendChart(hist)}
      </div>`;
  }

  function buildProductsHtml(customer) {
    return customer.products
      .map((p) => {
        const days = daysBetween(TODAY, p.maturityDate);
        const nearClass = days >= 0 && days <= THRESHOLDS.MATURITY_DAYS ? "maturity-near" : "";
        const dayLabel = days < 0 ? "만기 경과" : `D-${days}`;
        const watched = isWatched(customer.id, p.name);
        const starLabel = watched ? "★" : "☆";
        return `<li><span class="item-label"><button type="button" class="star-toggle-btn${watched ? " is-watched" : ""}" data-product-name="${p.name}" title="관심종목 ${watched ? "해제" : "등록"}">${starLabel}</button> ${p.name} (${p.amount}억원)</span><span class="item-value ${nearClass}">${p.maturityDate} · ${dayLabel}</span></li>`;
      })
      .join("");
  }

  function buildTxnHtml(customer) {
    return customer.transactions
      .map(
        (t) =>
          `<li><span class="item-label">${t.type}</span><span class="item-value">${t.amount.toFixed(1)}억원 · ${t.date}</span></li>`
      )
      .join("");
  }

  function attachStarToggleListeners(customer) {
    detailPanelEl.querySelectorAll(".star-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const product = customer.products.find((p) => p.name === btn.dataset.productName);
        if (product) toggleWatchlist(customer, product);
      });
    });
  }

  function renderEventDetail(event) {
    const customer = state.customers.find((c) => c.id === event.customerId);
    const historyHtml = renderHistoryTimeline(event.customerId);
    const recommendationHtml = ruleRecommendation(event);

    detailPanelEl.innerHTML = `
      <div class="detail-fade">
      ${buildCustomerHeaderHtml(customer)}

      <div class="detail-section">
        <h3>이벤트 상세</h3>
        <p>${event.label} — ${event.detail}</p>
      </div>

      <div class="detail-section">
        <h3>추천 대응 포인트</h3>
        <div class="recommendation-box">${recommendationHtml}</div>
      </div>

      <div class="detail-section">
        <h3>대응 상태 관리</h3>
        <div class="status-row">
          <select id="detail-status-select">
            <option value="미확인" ${event.status === "미확인" ? "selected" : ""}>미확인</option>
            <option value="확인함" ${event.status === "확인함" ? "selected" : ""}>확인함</option>
            <option value="대응완료" ${event.status === "대응완료" ? "selected" : ""}>대응완료</option>
          </select>
        </div>
        <textarea id="detail-memo" placeholder="대응 메모를 입력하세요.">${event.memo || ""}</textarea>
        <button class="btn-primary" id="detail-save-btn" type="button">저장</button>
      </div>

      <div class="detail-section">
        <h3>보유 상품 및 만기 일정</h3>
        <ul class="plain-list">${buildProductsHtml(customer)}</ul>
      </div>

      <div class="detail-section">
        <h3>최근 거래 내역</h3>
        <ul class="plain-list">${buildTxnHtml(customer)}</ul>
      </div>

      <div class="detail-section">
        <h3>과거 이벤트 및 대응 이력</h3>
        ${historyHtml}
      </div>
      </div>
    `;

    attachStarToggleListeners(customer);

    const saveBtn = document.getElementById("detail-save-btn");
    saveBtn.addEventListener("click", async () => {
      const status = document.getElementById("detail-status-select").value;
      const memo = document.getElementById("detail-memo").value;
      const prevStatus = event.status;
      const prevMemo = event.memo;

      event.status = status;
      event.memo = memo;
      saveBtn.disabled = true;
      saveBtn.textContent = "저장 중...";
      renderEventList();

      const ok = await saveEventAction(event.eventKey, { status, memo });
      saveBtn.disabled = false;
      saveBtn.textContent = "저장";

      if (!ok) {
        event.status = prevStatus;
        event.memo = prevMemo;
        renderEventList();
        renderDetail();
        showToast("상태 저장에 실패했습니다. 다시 시도해 주세요.", true);
      } else {
        showToast("저장되었습니다.");
      }
    });
  }

  function renderCustomerOnlyDetail(customer) {
    const historyHtml = renderHistoryTimeline(customer.id);

    detailPanelEl.innerHTML = `
      <div class="detail-fade">
      ${buildCustomerHeaderHtml(customer)}

      <div class="detail-section">
        <h3>보유 상품 및 만기 일정</h3>
        <ul class="plain-list">${buildProductsHtml(customer)}</ul>
      </div>

      <div class="detail-section">
        <h3>최근 거래 내역</h3>
        <ul class="plain-list">${buildTxnHtml(customer)}</ul>
      </div>

      <div class="detail-section">
        <h3>과거 이벤트 및 대응 이력</h3>
        ${historyHtml}
      </div>
      </div>
    `;

    attachStarToggleListeners(customer);
  }

  function renderDetail() {
    const event = state.events.find((e) => e.eventKey === state.selectedEventKey);
    if (event) {
      renderEventDetail(event);
      return;
    }

    const customer = state.customers.find((c) => c.id === state.selectedCustomerId);
    if (customer) {
      renderCustomerOnlyDetail(customer);
      return;
    }

    detailPanelEl.innerHTML =
      '<div class="detail-fade"><p class="empty-state">왼쪽 목록에서 이벤트를 선택하거나, "전체 고객" 탭에서 고객을 선택하면 상세 정보가 표시됩니다.</p></div>';
  }

  // ---- Supabase: PB 확인/대응 상태 및 메모 ----
  async function loadEventActions() {
    const { data, error } = await supabaseClient.from("event_actions").select("*");
    if (error) {
      showToast("저장된 대응 상태를 불러오지 못했습니다: " + error.message, true);
      return {};
    }
    const map = {};
    (data || []).forEach((row) => {
      map[row.event_key] = row;
    });
    return map;
  }

  function applyActionMap(actionMap) {
    state.events.forEach((event) => {
      const row = actionMap[event.eventKey];
      if (row) {
        event.status = row.status || "미확인";
        event.memo = row.memo || "";
      }
    });
  }

  async function saveEventAction(eventKey, updates) {
    const { error } = await supabaseClient
      .from("event_actions")
      .upsert(
        { event_key: eventKey, status: updates.status, memo: updates.memo, updated_at: new Date().toISOString() },
        { onConflict: "event_key" }
      );
    return !error;
  }

  // ---- Supabase: 이벤트 발생 이력 (append-only 타임라인) ----
  async function loadEventHistory() {
    const { data, error } = await supabaseClient
      .from("event_log")
      .select("*")
      .order("detected_at", { ascending: false });
    if (error) {
      showToast("이벤트 이력을 불러오지 못했습니다: " + error.message, true);
      return [];
    }
    return data || [];
  }

  function groupHistoryByCustomer(rows) {
    const map = {};
    rows.forEach((row) => {
      if (!map[row.customer_id]) map[row.customer_id] = [];
      map[row.customer_id].push(row);
    });
    return map;
  }

  // 현재 감지된 이벤트 중 아직 기록되지 않은 발생(같은 event_key+detail 조합이 없는 경우)만 새로 기록한다.
  async function syncEventLog(events, historyRows) {
    const existingKeys = new Set(historyRows.map((r) => `${r.event_key}::${r.detail}`));
    const newRows = events
      .filter((e) => !existingKeys.has(`${e.eventKey}::${e.detail}`))
      .map((e) => ({
        event_key: e.eventKey,
        customer_id: e.customerId,
        customer_name: e.customerName,
        type: e.type,
        label: e.label,
        detail: e.detail,
      }));
    if (newRows.length === 0) return false;
    const { error } = await supabaseClient.from("event_log").insert(newRows);
    if (error) {
      showToast("이벤트 이력 기록에 실패했습니다: " + error.message, true);
      return false;
    }
    return true;
  }

  // 현재 이벤트를 이력에 반영하고, state.historyByCustomer를 최신 상태로 갱신한다.
  async function refreshEventHistory() {
    let historyRows = await loadEventHistory();
    const inserted = await syncEventLog(state.events, historyRows);
    if (inserted) {
      historyRows = await loadEventHistory();
    }
    state.historyByCustomer = groupHistoryByCustomer(historyRows);
  }

  function formatHistoryDate(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function renderHistoryTimeline(customerId) {
    const rows = state.historyByCustomer[customerId] || [];
    if (rows.length === 0) {
      return '<p class="empty-state">이벤트 이력이 없습니다.</p>';
    }
    return rows
      .map((row) => {
        const active = state.events.find((e) => e.eventKey === row.event_key && e.detail === row.detail);
        const statusLabel = active ? active.status : "종료";
        return `<div class="history-item"><span class="history-label">[${formatHistoryDate(row.detected_at)}] ${row.label} — ${row.detail}</span><span class="history-status">${statusLabel}</span></div>`;
      })
      .join("");
  }

  // ---- Supabase: 관심 상품(종목) 워치리스트 ----
  async function loadWatchlist() {
    const { data, error } = await supabaseClient
      .from("watchlist_items")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      showToast("관심종목을 불러오지 못했습니다: " + error.message, true);
      return [];
    }
    return data || [];
  }

  async function refreshWatchlist() {
    state.watchlistRows = await loadWatchlist();
    renderWatchlistPanel();
  }

  function isWatched(customerId, productName) {
    return state.watchlistRows.some((r) => r.customer_id === customerId && r.product_name === productName);
  }

  async function removeWatchlistItem(customerId, productName) {
    const { error } = await supabaseClient
      .from("watchlist_items")
      .delete()
      .eq("customer_id", customerId)
      .eq("product_name", productName);
    if (error) {
      showToast("관심종목 해제에 실패했습니다: " + error.message, true);
      return;
    }
    await refreshWatchlist();
    renderDetail();
  }

  async function toggleWatchlist(customer, product) {
    if (isWatched(customer.id, product.name)) {
      await removeWatchlistItem(customer.id, product.name);
      return;
    }
    const { error } = await supabaseClient.from("watchlist_items").insert({
      customer_id: customer.id,
      customer_name: customer.name,
      product_name: product.name,
      maturity_date: product.maturityDate,
      amount: product.amount,
    });
    if (error) {
      showToast("관심종목 등록에 실패했습니다: " + error.message, true);
      return;
    }
    await refreshWatchlist();
    renderDetail();
  }

  function renderWatchlistPanel() {
    watchlistListEl.innerHTML = "";

    if (state.watchlistRows.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "관심종목으로 등록한 상품이 없습니다.";
      watchlistListEl.appendChild(empty);
      return;
    }

    state.watchlistRows.forEach((row) => {
      const li = document.createElement("li");
      li.className = "watchlist-item";

      const top = document.createElement("div");
      top.className = "watchlist-item-top";

      const product = document.createElement("span");
      product.className = "watchlist-item-product";
      product.textContent = row.product_name;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "watchlist-remove-btn";
      removeBtn.title = "관심종목 해제";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => removeWatchlistItem(row.customer_id, row.product_name));

      top.append(product, removeBtn);

      const meta = document.createElement("span");
      meta.className = "watchlist-item-customer";
      const days = row.maturity_date ? daysBetween(TODAY, row.maturity_date) : null;
      const maturityLabel = days == null ? "" : days < 0 ? " · 만기 경과" : ` · D-${days}`;
      const amountLabel = row.amount != null ? ` · ${Number(row.amount).toFixed(1)}억원` : "";
      meta.textContent = `${row.customer_name}${amountLabel}${maturityLabel}`;

      li.append(top, meta);
      watchlistListEl.appendChild(li);
    });
  }

  // ---- 새로고침: 목업 데이터를 살짝 변형해 신규 이벤트 발생을 시뮬레이션 ----
  function perturbCustomers(customers) {
    const target = customers[Math.floor(Math.random() * customers.length)];
    const hist = target.assetHistory;
    const last = hist[hist.length - 1];
    const deltaPct = Math.random() * 0.3 - 0.15; // -15% ~ +15%
    last.total = Math.round(last.total * (1 + deltaPct) * 10) / 10;

    if (Math.random() < 0.5) {
      const target2 = customers[Math.floor(Math.random() * customers.length)];
      const bigAmount = Math.round(target2.avgTransactionAmount * (3 + Math.random() * 4) * 10) / 10;
      target2.transactions.unshift({
        date: formatDate(TODAY),
        type: Math.random() < 0.5 ? "출금" : "이체",
        amount: bigAmount,
      });
    }
  }

  // 고객 데이터는 그대로 두고 현재 THRESHOLDS로 이벤트만 다시 계산 (기존 상태/메모는 유지)
  async function recomputeEvents() {
    const previousActions = {};
    state.events.forEach((e) => {
      previousActions[e.eventKey] = { status: e.status, memo: e.memo };
    });

    state.events = detectEvents(state.customers);
    Object.keys(previousActions).forEach((key) => {
      const event = state.events.find((e) => e.eventKey === key);
      if (event) {
        event.status = previousActions[key].status;
        event.memo = previousActions[key].memo;
      }
    });

    const actionMap = await loadEventActions();
    applyActionMap(actionMap);
    await refreshEventHistory();
    await refreshWatchlist();

    if (!state.events.find((e) => e.eventKey === state.selectedEventKey)) {
      state.selectedEventKey = null;
    }

    renderEventList();
    renderDetail();
  }

  async function refreshEvents() {
    refreshBtn.disabled = true;
    perturbCustomers(state.customers);
    await recomputeEvents();
    refreshBtn.disabled = false;
  }

  // ---- 알림 임계치 설정 모달 ----
  function fillSettingsForm(values) {
    settingAssetPctEl.value = Math.round(values.ASSET_CHANGE_PCT * 100);
    settingMaturityDaysEl.value = values.MATURITY_DAYS;
    settingTxnMultiplierEl.value = values.TXN_MULTIPLIER;
    settingTxnLookbackEl.value = values.TXN_LOOKBACK_DAYS;
  }

  function getModalFocusable() {
    return Array.from(settingsModalEl.querySelectorAll("input, select, textarea, button")).filter(
      (el) => !el.disabled
    );
  }

  function openSettingsModal() {
    fillSettingsForm(THRESHOLDS);
    settingsModalEl.hidden = false;
    const focusable = getModalFocusable();
    if (focusable.length > 0) focusable[0].focus();
  }

  function closeSettingsModal() {
    settingsModalEl.hidden = true;
    settingsBtn.focus();
  }

  settingsModalEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSettingsModal();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = getModalFocusable();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  settingsBtn.addEventListener("click", openSettingsModal);
  settingsCancelBtn.addEventListener("click", closeSettingsModal);
  settingsModalEl.addEventListener("click", (e) => {
    if (e.target === settingsModalEl) closeSettingsModal();
  });
  settingsResetBtn.addEventListener("click", () => fillSettingsForm(DEFAULT_THRESHOLDS));

  settingsSaveBtn.addEventListener("click", async () => {
    const assetPct = Number(settingAssetPctEl.value);
    const maturityDays = Number(settingMaturityDaysEl.value);
    const txnMultiplier = Number(settingTxnMultiplierEl.value);
    const txnLookback = Number(settingTxnLookbackEl.value);

    if (
      !Number.isFinite(assetPct) ||
      assetPct <= 0 ||
      !Number.isFinite(maturityDays) ||
      maturityDays <= 0 ||
      !Number.isFinite(txnMultiplier) ||
      txnMultiplier <= 0 ||
      !Number.isFinite(txnLookback) ||
      txnLookback <= 0
    ) {
      showToast("모든 값을 0보다 큰 숫자로 입력해 주세요.", true);
      return;
    }

    THRESHOLDS.ASSET_CHANGE_PCT = assetPct / 100;
    THRESHOLDS.MATURITY_DAYS = maturityDays;
    THRESHOLDS.TXN_MULTIPLIER = txnMultiplier;
    THRESHOLDS.TXN_LOOKBACK_DAYS = txnLookback;
    localStorage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify(THRESHOLDS));

    closeSettingsModal();
    showToast("알림 임계치가 저장되었습니다. 이벤트를 재계산합니다...");
    await recomputeEvents();
  });

  // ---- 초기화 ----
  function setListMode(mode) {
    if (state.listMode === mode) return;
    state.listMode = mode;
    modeTabEventsEl.classList.toggle("is-active", mode === "events");
    modeTabCustomersEl.classList.toggle("is-active", mode === "customers");
    statusFilterLabelEl.classList.toggle("is-hidden", mode === "customers");
    eventListDescEl.textContent =
      mode === "customers"
        ? "전체 고객을 이름으로 검색해 자산·보유 상품·거래 내역을 조회할 수 있습니다."
        : "규칙 기반으로 산정한 우선순위 순으로 정렬됩니다. 상태나 고객명으로 필터링할 수 있습니다.";
    renderEventList();
  }

  modeTabEventsEl.addEventListener("click", () => setListMode("events"));
  modeTabCustomersEl.addEventListener("click", () => setListMode("customers"));

  statusFilterEl.addEventListener("change", () => {
    state.statusFilter = statusFilterEl.value;
    renderEventList();
  });

  customerSearchEl.addEventListener("input", () => {
    state.searchQuery = customerSearchEl.value;
    renderEventList();
  });

  refreshBtn.addEventListener("click", refreshEvents);

  function startAutoRefresh() {
    setInterval(() => {
      const memoFocused = document.activeElement && document.activeElement.id === "detail-memo";
      if (refreshBtn.disabled || !settingsModalEl.hidden || memoFocused) return;
      refreshEvents();
    }, AUTO_REFRESH_INTERVAL_MS);
  }

  async function init() {
    metaDateEl.textContent = formatDisplayDate(TODAY);

    state.customers = cloneCustomers(BASE_CUSTOMERS);
    state.events = detectEvents(state.customers);

    const actionMap = await loadEventActions();
    applyActionMap(actionMap);
    await refreshEventHistory();
    await refreshWatchlist();

    renderEventList();
    renderDetail();

    startAutoRefresh();
  }

  init();
})();
