const STATE_KEY = "teamMealDashboardState.v1";
const MODE_LUNCH = "lunch";
const MODE_DINNER = "dinner";

const moodMap = {
  quiet: { label: "조용한 식사", requiredTags: ["조용한식사", "깔끔함"], alcoholBonus: 0 },
  meat: { label: "고기/회식 분위기", requiredTags: ["고기", "회식"], alcoholBonus: 4 },
  alcohol: { label: "술 한잔 가능", requiredTags: ["술한잔", "회식"], alcoholBonus: 10 },
  clean: { label: "깔끔한 식당", requiredTags: ["깔끔함", "정식"], alcoholBonus: 0 },
  value: { label: "가성비 우선", requiredTags: ["가성비", "빠른점심"], alcoholBonus: 0 }
};

const els = {};
let state = loadState();
let currentMode = MODE_LUNCH;

function boot() {
  cacheElements();
  bindEvents();
  renderToday();
  renderDataPanel();
  renderAll();
}

function cacheElements() {
  els.todayText = document.querySelector("#todayText");
  els.modeCards = Array.from(document.querySelectorAll(".mode-card"));
  els.dinnerControls = document.querySelector("#dinnerControls");
  els.partySize = document.querySelector("#partySize");
  els.dinnerMood = document.querySelector("#dinnerMood");
  els.budgetBand = document.querySelector("#budgetBand");
  els.resultTitle = document.querySelector("#resultTitle");
  els.resultSubtitle = document.querySelector("#resultSubtitle");
  els.recommendationGrid = document.querySelector("#recommendationGrid");
  els.dataSourceNotice = document.querySelector("#dataSourceNotice");
  els.dataSourceText = document.querySelector("#dataSourceText");
  els.restaurantCountText = document.querySelector("#restaurantCountText");
  els.lastSyncedText = document.querySelector("#lastSyncedText");
  els.historyList = document.querySelector("#historyList");
  els.clearHistoryButton = document.querySelector("#clearHistoryButton");
  els.rerollButton = document.querySelector("#rerollButton");
  els.toggleDataButton = document.querySelector("#toggleDataButton");
  els.closeDataButton = document.querySelector("#closeDataButton");
  els.dataPanel = document.querySelector("#dataPanel");
  els.dataJson = document.querySelector("#dataJson");
}

function bindEvents() {
  els.modeCards.forEach((card) => {
    card.addEventListener("click", () => {
      currentMode = card.dataset.mode;
      renderAll();
    });
  });

  [els.partySize, els.dinnerMood, els.budgetBand].forEach((control) => {
    control.addEventListener("input", renderAll);
    control.addEventListener("change", renderAll);
  });

  els.rerollButton.addEventListener("click", () => {
    state.rerollNonce = (state.rerollNonce || 0) + 1;
    saveState();
    renderAll();
  });

  els.clearHistoryButton.addEventListener("click", () => {
    const ok = window.confirm("방문 이력과 식당 평가 상태를 모두 초기화할까요?");
    if (!ok) return;
    state = getDefaultState();
    saveState();
    renderAll();
  });

  els.toggleDataButton.addEventListener("click", () => {
    els.dataPanel.classList.toggle("is-hidden");
  });

  els.closeDataButton.addEventListener("click", () => {
    els.dataPanel.classList.add("is-hidden");
  });

  els.recommendationGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    updateRestaurantState(id, action);
  });
}

function renderToday() {
  const today = new Date();
  els.todayText.textContent = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(today);
}

function renderAll() {
  renderMode();
  renderDataStatus();
  renderRecommendations();
  renderHistory();
  renderDataPanel();
}

function renderMode() {
  els.modeCards.forEach((card) => {
    const active = card.dataset.mode === currentMode;
    card.classList.toggle("is-active", active);
    card.setAttribute("aria-pressed", String(active));
  });

  const isDinner = currentMode === MODE_DINNER;
  els.dinnerControls.classList.toggle("is-hidden", !isDinner);
  els.resultTitle.textContent = isDinner ? "오늘의 저녁 회식 추천" : "오늘의 점심 추천";
  els.resultSubtitle.textContent = isDinner
    ? "회식 인원, 분위기, 예산을 반영해서 추천합니다."
    : "최근 방문한 곳은 자동으로 우선순위를 낮춥니다.";
}

function renderDataStatus() {
  const meta = window.RESTAURANTS_META || {};
  const restaurants = Array.isArray(window.RESTAURANTS) ? window.RESTAURANTS : [];
  const sourceLabels = {
    "naver-local-search": "네이버 지역검색 자동 연동",
    "fallback-existing-restaurants": "기존 데이터 유지",
    "sample-manual": "샘플/수동 데이터"
  };
  const sourceText = sourceLabels[meta.source] || meta.source || "수동 데이터";
  const generatedAt = meta.generatedAt ? formatDateTime(meta.generatedAt) : "동기화 전";
  const notice = meta.notice || "식당 데이터는 restaurants.js에서 불러왔습니다.";

  if (els.dataSourceText) els.dataSourceText.textContent = sourceText;
  if (els.restaurantCountText) els.restaurantCountText.textContent = `${restaurants.length}개 식당`;
  if (els.lastSyncedText) els.lastSyncedText.textContent = generatedAt;
  if (els.dataSourceNotice) els.dataSourceNotice.textContent = notice;
}

function renderRecommendations() {
  const scored = getScoredRestaurants(currentMode);

  if (scored.length === 0) {
    els.recommendationGrid.innerHTML = `<div class="empty-state">조건에 맞는 식당이 없습니다. restaurants.js에서 식당 데이터를 추가하거나 조건을 완화해 주세요.</div>`;
    return;
  }

  const picked = pickRecommendations(scored);
  const [top, ...alternatives] = picked;
  const altHtml = alternatives.map((item, index) => renderRestaurantCard(item, index + 2, false)).join("");

  els.recommendationGrid.innerHTML = `
    ${renderRestaurantCard(top, 1, true)}
    <div class="alt-list" aria-label="대안 추천 식당">
      ${altHtml || `<div class="empty-state">대안 추천을 표시하려면 식당 데이터를 2개 이상 넣어주세요.</div>`}
    </div>
  `;
}

function pickRecommendations(scored) {
  if (!scored.length) return [];

  const nonce = state.rerollNonce || 0;

  if (nonce === 0) {
    return scored.slice(0, 4);
  }

  const candidatePool = scored.slice(0, Math.min(scored.length, 8));
  const shuffled = [...candidatePool].sort((a, b) => {
    const noiseA = seededNoise(`${todayKey()}-${currentMode}-${nonce}-pick-${a.restaurant.id}`);
    const noiseB = seededNoise(`${todayKey()}-${currentMode}-${nonce}-pick-${b.restaurant.id}`);
    return noiseB - noiseA;
  });

  const top = shuffled[0];
  const alternatives = scored
    .filter((item) => item.restaurant.id !== top.restaurant.id)
    .slice(0, 8)
    .sort((a, b) => {
      const noiseA = seededNoise(`${todayKey()}-${currentMode}-${nonce}-alt-${a.restaurant.id}`);
      const noiseB = seededNoise(`${todayKey()}-${currentMode}-${nonce}-alt-${b.restaurant.id}`);
      return noiseB - noiseA;
    })
    .slice(0, 3);

  return [top, ...alternatives];
}

function renderRestaurantCard(item, rank, isMain) {
  const restaurant = item.restaurant;
  const price = currentMode === MODE_DINNER ? restaurant.dinnerPrice : restaurant.lunchPrice;
  const recentLabel = getRecentVisitLabel(restaurant.id);
  const managerMatch = restaurant.managerPreferenceScore >= 8 ? "반영 높음" : restaurant.managerPreferenceScore >= 5 ? "보통" : "낮음";
  const reason = buildReason(item);
  const cardClass = isMain ? "rec-card rec-card--main" : "rec-card";

  return `
    <article class="${cardClass}">
      <div class="rec-card__inner">
        <div class="rec-card__rank">
          <span class="rank-badge">${rank === 1 ? "오늘의 1순위" : `대안 ${rank - 1}`}</span>
          <span class="score-pill"><strong>${Math.round(item.score)}</strong>점</span>
        </div>

        <h3>${escapeHtml(restaurant.name)}</h3>
        <p class="menu-line">${escapeHtml(restaurant.recommendedMenu)} · ${escapeHtml(restaurant.category)}</p>

        <div class="meta-grid">
          <div class="meta-item"><span>예상 가격</span><strong>${formatPrice(price)}</strong></div>
          <div class="meta-item"><span>거리</span><strong>${restaurant.distanceMeters}m · ${restaurant.walkMinutes}분</strong></div>
          <div class="meta-item"><span>최근 방문</span><strong>${recentLabel}</strong></div>
        </div>

        ${currentMode === MODE_DINNER ? `
          <div class="meta-grid">
            <div class="meta-item"><span>단체</span><strong>${restaurant.groupFriendly ? "적합" : "소규모"}</strong></div>
            <div class="meta-item"><span>술/회식</span><strong>${restaurant.alcoholFriendly ? "가능" : "식사 중심"}</strong></div>
            <div class="meta-item"><span>팀장님 취향</span><strong>${managerMatch}</strong></div>
          </div>
        ` : ""}

        <div class="reason-box">${escapeHtml(reason)}</div>

        ${renderExternalLink(restaurant)}

        <div class="tag-row">
          ${restaurant.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}
        </div>

        <div class="visit-actions" aria-label="방문 상태 저장">
          <button class="visit-btn" type="button" data-id="${restaurant.id}" data-action="visitedToday">오늘 방문함</button>
          <button class="visit-btn" type="button" data-id="${restaurant.id}" data-action="visitedYesterday">어제 방문함</button>
          <button class="visit-btn" type="button" data-id="${restaurant.id}" data-action="dislike">별로였음</button>
          <button class="visit-btn" type="button" data-id="${restaurant.id}" data-action="favorite">다시 가고 싶음</button>
        </div>
      </div>
    </article>
  `;
}

function renderExternalLink(restaurant) {
  const link = buildNaverMapSearchUrl(restaurant);
  return `<a class="external-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">네이버지도에서 보기</a>`;
}

function buildNaverMapSearchUrl(restaurant) {
  const keyword = normalizeRestaurantName(restaurant.name);
  return `https://map.naver.com/p/search/${encodeURIComponent(keyword)}`;
}

function normalizeRestaurantName(name) {
  return String(name || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderHistory() {
  const history = [...state.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);

  if (history.length === 0) {
    els.historyList.innerHTML = `<div class="empty-state">아직 저장된 방문 이력이 없습니다. 식당 카드에서 “오늘 방문함”을 눌러 기록을 쌓아보세요.</div>`;
    return;
  }

  els.historyList.innerHTML = history.map((entry) => {
    const restaurant = getRestaurantById(entry.id);
    const name = restaurant ? restaurant.name : entry.id;
    return `
      <div class="history-item">
        <div>
          <strong>${escapeHtml(name)}</strong>
          <span>${entry.date} · ${escapeHtml(entry.memo || "")}</span>
        </div>
        <span class="status-pill">${statusLabel(entry.status)}</span>
      </div>
    `;
  }).join("");
}

function renderDataPanel() {
  const payload = {
    meta: window.RESTAURANTS_META || {},
    restaurants: window.RESTAURANTS || []
  };
  els.dataJson.textContent = JSON.stringify(payload, null, 2);
}

function getScoredRestaurants(mode) {
  const restaurants = Array.isArray(window.RESTAURANTS) ? window.RESTAURANTS : [];
  const recentCategories = getRecentCategories(5);

  return restaurants
    .filter((restaurant) => restaurant.isActive !== false)
    .map((restaurant) => scoreRestaurant(restaurant, mode, recentCategories))
    .filter((item) => item.eligible && item.score > -20)
    .sort((a, b) => b.score - a.score);
}

function scoreRestaurant(restaurant, mode, recentCategories) {
  const stored = state.restaurantStates[restaurant.id] || {};
  const merged = { ...restaurant, ...stored };
  const isDinner = mode === MODE_DINNER;
  const price = isDinner ? merged.dinnerPrice : merged.lunchPrice;

  let eligible = true;
  let score = 60;
  const details = [];

  if (merged.distanceMeters > 400) {
    eligible = false;
    details.push("반경 400m 초과");
  }

  if (isDinner && !merged.goodForDinner) {
    eligible = false;
    details.push("저녁 회식 후보 제외");
  }

  if (!isDinner && !merged.goodForLunch) {
    eligible = false;
    details.push("점심 후보 제외");
  }

  const distanceScore = Math.max(0, (400 - merged.distanceMeters) / 400) * 15;
  score += distanceScore;
  if (distanceScore >= 10) details.push("가까운 거리");

  if (isDinner) {
    const dinnerResult = scoreDinner(merged, price);
    score += dinnerResult.score;
    details.push(...dinnerResult.details);
  } else {
    const lunchResult = scoreLunch(merged, price);
    score += lunchResult.score;
    details.push(...lunchResult.details);
  }

  if (merged.managerPreferenceScore >= 8) {
    score += isDinner ? 8 : 14;
    details.push("팀장님 선호 메뉴와 잘 맞음");
  } else if (merged.managerPreferenceScore >= 5) {
    score += 5;
  }

  const recentPenalty = getRecentPenalty(merged.id);
  score += recentPenalty.score;
  if (recentPenalty.label) details.push(recentPenalty.label);

  if (merged.dislike) {
    score -= 120;
    details.push("별로였음 표시로 추천 제외권");
  }

  if (merged.favorite) {
    const days = daysSince(merged.lastVisitedDate);
    if (days === null || days >= 4) {
      score += 8;
      details.push("다시 가고 싶음 표시");
    }
  }

  if (recentCategories.includes(merged.category)) {
    score -= 10;
    details.push("최근 같은 음식 종류 반복 감점");
  }

  score += seededNoise(`${todayKey()}-${mode}-${state.rerollNonce || 0}-${merged.id}`) * 15;

  return {
    restaurant: merged,
    score,
    eligible,
    details
  };
}

function scoreLunch(restaurant, price) {
  let score = 0;
  const details = [];

  if (price <= 12000) {
    score += 12;
    details.push("점심 가격 부담 낮음");
  } else if (price <= 15000) {
    score += 8;
    details.push("점심 예산 무난");
  } else if (price >= 18000) {
    score -= 8;
    details.push("점심 가격대 다소 높음");
  }

  if (restaurant.tags.some((tag) => ["빠른점심", "건물내", "가성비"].includes(tag))) {
    score += 8;
    details.push("점심시간에 다녀오기 편함");
  }

  return { score, details };
}

function scoreDinner(restaurant, price) {
  let score = 0;
  const details = [];
  const partySize = Number(els.partySize.value || 5);
  const mood = els.dinnerMood.value;
  const budgetBand = els.budgetBand.value;
  const moodRule = moodMap[mood];

  if (restaurant.groupFriendly) {
    score += partySize >= 6 ? 14 : 8;
    details.push("단체 식사에 적합");
  } else if (partySize >= 6) {
    score -= 28;
    details.push("인원 대비 좌석 부담 가능");
  }

  if (restaurant.alcoholFriendly) {
    score += moodRule.alcoholBonus;
    if (mood === "alcohol" || mood === "meat") details.push("술 한잔 가능한 회식 후보");
  } else if (mood === "alcohol") {
    score -= 18;
    details.push("술 회식 조건과는 다소 약함");
  }

  const tagMatchCount = moodRule.requiredTags.filter((tag) => restaurant.tags.includes(tag)).length;
  if (tagMatchCount > 0) {
    score += tagMatchCount * 9;
    details.push(`${moodRule.label} 조건과 맞음`);
  }

  if (budgetBand === "10000") {
    if (price < 20000) score += 12;
    else score -= 18;
  }

  if (budgetBand === "20000") {
    if (price >= 20000 && price < 30000) score += 12;
    else if (price < 20000) score += 4;
    else score -= 8;
  }

  if (budgetBand === "30000") {
    if (price >= 30000) score += 10;
    else score += 2;
  }

  return { score, details };
}

function updateRestaurantState(id, action) {
  const restaurant = getRestaurantById(id);
  if (!restaurant) return;

  const today = todayKey();
  const yesterday = offsetDateKey(-1);
  const stored = state.restaurantStates[id] || {};
  const next = { ...stored };
  let date = today;
  let status = action;
  let memo = "";

  if (action === "visitedToday") {
    next.lastVisitedDate = today;
    next.dislike = false;
    date = today;
    memo = "오늘 방문 기록";
  }

  if (action === "visitedYesterday") {
    next.lastVisitedDate = yesterday;
    next.dislike = false;
    date = yesterday;
    memo = "어제 방문 기록";
  }

  if (action === "dislike") {
    next.dislike = true;
    next.favorite = false;
    memo = "추천 제외 우선";
  }

  if (action === "favorite") {
    next.favorite = true;
    next.dislike = false;
    memo = "재추천 가능";
  }

  state.restaurantStates[id] = next;
  state.history.push({
    id,
    date,
    status,
    memo,
    createdAt: new Date().toISOString()
  });

  state.history = state.history.slice(-80);
  saveState();
  renderAll();
}

function getRecentPenalty(id) {
  const stored = state.restaurantStates[id];
  if (!stored || !stored.lastVisitedDate) return { score: 0, label: "" };

  const days = daysSince(stored.lastVisitedDate);
  if (days === null) return { score: 0, label: "" };
  if (days <= 0) return { score: -45, label: "오늘 이미 방문" };
  if (days === 1) return { score: -35, label: "어제 방문해서 강한 감점" };
  if (days === 2) return { score: -25, label: "2일 전 방문 감점" };
  if (days === 3) return { score: -18, label: "3일 이내 방문 감점" };
  if (days <= 7) return { score: -8, label: "최근 1주 내 방문" };
  return { score: 0, label: "" };
}

function getRecentVisitLabel(id) {
  const stored = state.restaurantStates[id];
  if (!stored || !stored.lastVisitedDate) {
    if (stored?.dislike) return "별로였음";
    if (stored?.favorite) return "재방문 희망";
    return "없음";
  }

  const days = daysSince(stored.lastVisitedDate);
  if (days === 0) return "오늘";
  if (days === 1) return "어제";
  if (days !== null) return `${days}일 전`;
  return stored.lastVisitedDate;
}

function getRecentCategories(limit) {
  return [...state.history]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((entry) => getRestaurantById(entry.id)?.category)
    .filter(Boolean);
}

function buildReason(item) {
  const base = item.details.filter(Boolean).slice(0, 3);
  const restaurant = item.restaurant;
  const prefix = currentMode === MODE_DINNER
    ? "회식 조건을 반영했을 때"
    : "점심 조건을 반영했을 때";

  if (base.length === 0) {
    return `${prefix} 거리, 가격, 메뉴 구성이 무난해서 추천합니다.`;
  }

  return `${prefix} ${base.join(", ")} 요소가 좋아서 추천합니다. ${restaurant.notes || ""}`;
}

function formatPrice(price) {
  if (!price) return "확인 필요";
  return `${price.toLocaleString("ko-KR")}원대`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function statusLabel(status) {
  const labels = {
    visitedToday: "오늘 방문함",
    visitedYesterday: "어제 방문함",
    dislike: "별로였음",
    favorite: "다시 가고 싶음"
  };
  return labels[status] || status;
}

function getRestaurantById(id) {
  return (window.RESTAURANTS || []).find((restaurant) => restaurant.id === id);
}

function daysSince(dateString) {
  if (!dateString) return null;
  const target = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(`${todayKey()}T00:00:00`);
  return Math.floor((today - target) / 86400000);
}

function todayKey() {
  return toDateKey(new Date());
}

function offsetDateKey(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return toDateKey(date);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function seededNoise(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDefaultState() {
  return {
    history: [],
    restaurantStates: {},
    rerollNonce: 0
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return getDefaultState();
    return { ...getDefaultState(), ...JSON.parse(raw) };
  } catch (error) {
    console.warn("방문 이력 로딩 실패", error);
    return getDefaultState();
  }
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

document.addEventListener("DOMContentLoaded", boot);
