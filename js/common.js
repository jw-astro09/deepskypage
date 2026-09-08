import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js";
import { browserSessionPersistence, getAuth, onAuthStateChanged, setPersistence, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { normalizeLinkUrl } from "./link-policy.js";

const NGROK_API_BASE_URL = "https://hypocrite-depletion-until.ngrok-free.dev";
const TAILSCALE_API_BASE_URL = "https://bs-server.tail886d19.ts.net";
const CONFIGURED_API_BASE_URL = String(
    globalThis.DEEPSKY_API_BASE_URL || NGROK_API_BASE_URL
).replace(/\/+$/, "");
const API_BASE_CANDIDATES = [...new Set([
    CONFIGURED_API_BASE_URL,
    NGROK_API_BASE_URL,
    TAILSCALE_API_BASE_URL
])];
const API_SELECTION_CACHE_MS = 60_000;
const API_FAILURE_COOLDOWN_MS = 120_000;
const RETRYABLE_RESPONSE_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

export let API_BASE_URL = CONFIGURED_API_BASE_URL;

export function normalizeSafeLinkUrl(value, { allowUpload = false, resolveUpload = false } = {}) {
    return normalizeLinkUrl(value, { allowUpload, resolveUpload, apiBaseUrl: API_BASE_URL });
}

let apiSelectionPromise = null;
let apiSelectionCheckedAt = 0;
const apiFailedUntil = new Map();

function setApiBaseUrl(baseUrl) {
    API_BASE_URL = baseUrl;
    document.documentElement.dataset.apiEndpoint =
        baseUrl === NGROK_API_BASE_URL ? "ngrok" :
        baseUrl === TAILSCALE_API_BASE_URL ? "tailscale" :
        "custom";
}

function markApiFailure(baseUrl) {
    apiFailedUntil.set(baseUrl, Date.now() + API_FAILURE_COOLDOWN_MS);
    apiSelectionCheckedAt = 0;
}

function clearApiFailure(baseUrl) {
    apiFailedUntil.delete(baseUrl);
}

function selectableApiCandidates() {
    const now = Date.now();
    const available = API_BASE_CANDIDATES.filter(
        baseUrl => (apiFailedUntil.get(baseUrl) || 0) <= now
    );
    // 모든 경로가 일시 실패로 표시됐더라도 복구 여부를 다시 확인합니다.
    return available.length ? available : API_BASE_CANDIDATES;
}

async function probeApiBaseUrl(baseUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${baseUrl}/api/deepsky/health`, {
            headers: { "ngrok-skip-browser-warning": "69420" },
            cache: "no-store",
            signal: controller.signal
        });
        if (response.ok) {
            clearApiFailure(baseUrl);
            return true;
        }
        markApiFailure(baseUrl);
        return false;
    } catch {
        markApiFailure(baseUrl);
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

export async function selectAvailableApi(force = false) {
    const now = Date.now();
    if (!force && apiSelectionCheckedAt && now - apiSelectionCheckedAt < API_SELECTION_CACHE_MS) {
        return API_BASE_URL;
    }
    if (apiSelectionPromise) return apiSelectionPromise;

    apiSelectionPromise = (async () => {
        for (const baseUrl of selectableApiCandidates()) {
            if (await probeApiBaseUrl(baseUrl)) {
                setApiBaseUrl(baseUrl);
                apiSelectionCheckedAt = Date.now();
                return baseUrl;
            }
        }
        apiSelectionCheckedAt = Date.now();
        throw new Error("사용 가능한 API 서버가 없습니다.");
    })();

    try {
        return await apiSelectionPromise;
    } finally {
        apiSelectionPromise = null;
    }
}

function isIdempotentRequest(options) {
    const method = String(options.method || "GET").toUpperCase();
    return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isInfrastructureFailure(response) {
    if (RETRYABLE_RESPONSE_STATUSES.has(response.status)) return true;
    if (response.status !== 403 && response.status !== 429) return false;

    // 애플리케이션이 반환한 JSON 권한 오류는 다른 터널로 재시도하지 않습니다.
    // ngrok 한도·경고 페이지처럼 HTML로 온 터널 오류만 전환 대상으로 봅니다.
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    return Boolean(response.headers.get("x-ngrok-error-code")) || !contentType.includes("application/json");
}

export async function apiFetch(path, options = {}) {
    await selectAvailableApi().catch(() => {});

    const mayRetry = isIdempotentRequest(options);
    const maxAttempts = mayRetry ? 2 : 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const requestBaseUrl = API_BASE_URL;
        try {
            const response = await fetch(`${requestBaseUrl}${path}`, options);
            if (!isInfrastructureFailure(response)) {
                clearApiFailure(requestBaseUrl);
                return response;
            }

            markApiFailure(requestBaseUrl);
            if (!mayRetry || attempt + 1 >= maxAttempts) return response;
        } catch (error) {
            lastError = error;
            markApiFailure(requestBaseUrl);
            if (!mayRetry || attempt + 1 >= maxAttempts) throw error;
        }

        await selectAvailableApi(true).catch(() => {});
        if (API_BASE_URL === requestBaseUrl) {
            break;
        }
    }

    if (lastError) throw lastError;
    throw new Error("사용 가능한 API 서버가 없습니다.");
}

// Use the normal tunnel failover for same-origin API file URLs as well as
// JSON requests. Direct fetch() would keep using an expired ngrok origin.
export async function apiFetchUrl(url, options = {}) {
    const target = new URL(url, API_BASE_URL);
    if (target.pathname.startsWith("/api/")) {
        return apiFetch(`${target.pathname}${target.search}`, options);
    }
    return fetch(target.href, options);
}

const SAFE_LOGO_ASSET_PATTERN = /^(?:logo\.png|assets\/logos\/[a-z0-9-]+\.png)$/;

export async function applySiteBranding() {
    try {
        const response = await apiFetch("/api/deepsky/site-settings/logo", {
            headers: { "ngrok-skip-browser-warning": "69420" }
        });
        if (!response.ok) return null;
        const settings = await response.json();
        const asset = String(settings.activeAsset || "");
        if (!SAFE_LOGO_ASSET_PATTERN.test(asset)) return null;
        const version = settings.updatedAt ? `?v=${encodeURIComponent(settings.updatedAt)}` : "";
        const source = `${asset}${version}`;
        document.querySelectorAll("img.nav-logo, img.hero-logo, img.emblem-image").forEach(image => {
            image.src = source;
        });
        document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(link => {
            link.href = source;
        });
        document.documentElement.dataset.activeLogo = String(settings.activeLogo || "classic");
        return settings;
    } catch (error) {
        console.warn("동아리 로고 설정을 불러오지 못해 기본 로고를 사용합니다.", error);
        return null;
    }
}

// 다른 화면 모듈이 초기 데이터를 요청하기 전부터 사용 가능한 경로를 선택합니다.
selectAvailableApi().catch(() => {});

export const firebaseConfig = {
    apiKey: "AIzaSyArvtIZ3QkwUcvz0SLu-AnLRifhkOtQ9CY",
    authDomain: "bokseong-deep-sky.firebaseapp.com",
    projectId: "bokseong-deep-sky",
    storageBucket: "bokseong-deep-sky.firebasestorage.app",
    messagingSenderId: "800777151311",
    appId: "1:800777151311:web:8c901fcf0ded04b1941b3a",
    measurementId: "G-LNZFCW099Z"
};

export const roleLabelMap = {
    admin: "관리자",
    teacher: "교사",
    student: "동아리 부원",
    member: "일반 회원",
    guest: "비회원"
};

const AI_ALLOWED_ROLES = new Set([
    "admin", "teacher", "student"
]);

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let appCheckEnabled = false;
const RECAPTCHA_V3_SITE_KEY = String(
    globalThis.DEEPSKY_RECAPTCHA_V3_SITE_KEY || ""
).trim();

export function ensureAppCheck() {
    if (appCheckEnabled || !RECAPTCHA_V3_SITE_KEY) return;
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
        isTokenAutoRefreshEnabled: true
    });
    appCheckEnabled = true;
}

ensureAppCheck();

export const auth = getAuth(app);
export const authPersistenceReady = setPersistence(auth, browserSessionPersistence)
    .then(() => true)
    .catch(error => {
        console.error("세션 로그인 설정에 실패했습니다.", error);
        return false;
    });

let profileUid = null;
let profilePromise = null;

export async function authHeaders(user = auth.currentUser, json = false) {
    if (!user) throw new Error("로그인이 필요합니다.");
    const headers = {
        Authorization: `Bearer ${await user.getIdToken()}`,
        "ngrok-skip-browser-warning": "69420"
    };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
}

export async function apiRequest(path, options = {}, user = auth.currentUser) {
    const headers = new Headers(options.headers || {});
    const authValues = await authHeaders(user);
    Object.entries(authValues).forEach(([key, value]) => headers.set(key, value));
    const requestOptions = { ...options, headers };
    const response = await apiFetch(path, requestOptions);
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `요청에 실패했습니다. (${response.status})`);
    }
    return response;
}

export function clearProfileCache() {
    profileUid = null;
    profilePromise = null;
}

export async function getCurrentProfile(user = auth.currentUser, force = false) {
    if (!user) return { uid: null, email: "", name: "", school: "", role: "guest" };
    if (!force && profileUid === user.uid && profilePromise) return profilePromise;
    profileUid = user.uid;
    profilePromise = apiRequest("/api/deepsky/me", {}, user)
        .then(response => response.json())
        .catch(error => {
            clearProfileCache();
            throw error;
        });
    return profilePromise;
}

export async function updateCurrentProfile(profile, user = auth.currentUser) {
    const response = await apiRequest("/api/deepsky/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile)
    }, user);
    clearProfileCache();
    return response.json();
}

export async function logoutTo(target = "index.html") {
    clearProfileCache();
    await signOut(auth);
    location.href = target;
}

function getApiStatusBanner() {
    let banner = document.getElementById("api-status-banner");
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "api-status-banner";
    banner.className = "api-status-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.hidden = true;

    const message = document.createElement("span");
    message.textContent = "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "다시 확인";
    retry.addEventListener("click", checkApiAvailability);
    banner.append(message, retry);
    document.body.prepend(banner);
    return banner;
}

export async function checkApiAvailability() {
    const banner = getApiStatusBanner();
    try {
        await selectAvailableApi(true);
        banner.hidden = true;
        return true;
    } catch {
        banner.hidden = false;
        return false;
    }
}

function startApiStatusMonitor() {
    checkApiAvailability();
    window.addEventListener("online", checkApiAvailability);
    setInterval(checkApiAvailability, 5 * 60_000);
}

function addFeatureNavigationLinks() {
    const items = [
        { href: "ai.html", label: "AI" }
    ];
    document.querySelectorAll(".nav-menu").forEach(menu => {
        const suggestionLink = menu.querySelector('a[href="suggest.html"]');
        items.forEach(item => {
            let link = menu.querySelector(`a[href="${item.href}"]`);
            if (!link) {
                link = document.createElement("a");
                link.href = item.href;
                link.textContent = item.label;
                menu.insertBefore(link, suggestionLink);
            }
            if (location.pathname.endsWith(`/${item.href}`)) {
                link.classList.add("active");
                link.setAttribute("aria-current", "page");
            }
        });
    });
}

function createSearchPopover() {
    const userZone = document.querySelector(".auth-user-zone");
    if (!userZone || document.getElementById("search-popover")) return;
    const authBar = userZone.closest(".auth-bar");
    if (authBar) authBar.style.zIndex = "1600";

    const popover = document.createElement("div");
    popover.id = "search-popover";
    popover.className = "search-popover";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "search-trigger";
    trigger.textContent = "검색";
    trigger.title = "통합 검색 열기";
    trigger.setAttribute("aria-label", "통합 검색 열기");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "search-quick-panel");
    trigger.hidden = true;

    const panel = document.createElement("aside");
    panel.id = "search-quick-panel";
    panel.className = "search-quick-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "빠른 통합 검색");

    const header = document.createElement("div");
    header.className = "search-quick-header";
    const title = document.createElement("strong");
    title.textContent = "통합 검색";
    const summary = document.createElement("span");
    summary.className = "search-quick-summary";
    header.append(title, summary);

    const form = document.createElement("form");
    form.className = "search-quick-form";
    const input = document.createElement("input");
    input.type = "search";
    input.maxLength = 120;
    input.placeholder = "제목, 내용, 작성자, 첨부파일";
    input.setAttribute("aria-label", "검색어");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "검색";
    form.append(input, submit);

    const results = document.createElement("div");
    results.className = "search-quick-results";
    results.setAttribute("aria-live", "polite");

    const fullSearchLink = document.createElement("a");
    fullSearchLink.href = "search.html";
    fullSearchLink.className = "search-quick-full-link";
    fullSearchLink.textContent = "상세 검색 열기";

    panel.append(header, form, results, fullSearchLink);
    popover.append(trigger, panel);

    const notificationPopover = userZone.querySelector("#notification-popover");
    const logoutButton = userZone.querySelector("#logout-btn, #logoutBtn");
    userZone.insertBefore(popover, notificationPopover || logoutButton || null);

    let currentUser = null;
    let requestSequence = 0;

    function renderMessage(message) {
        results.replaceChildren();
        const empty = document.createElement("p");
        empty.className = "search-quick-empty";
        empty.textContent = message;
        results.appendChild(empty);
    }

    function renderResults(items) {
        results.replaceChildren();
        summary.textContent = `${items.length}개`;
        if (!items.length) {
            renderMessage("검색 결과가 없습니다.");
            return;
        }
        items.slice(0, 8).forEach(item => {
            const href = safeSiteLink(item.link);
            const result = document.createElement(href ? "a" : "article");
            result.className = "search-quick-item";
            if (href) result.href = href;

            const itemTitle = document.createElement("strong");
            itemTitle.textContent = item.title || "제목 없음";
            const excerpt = document.createElement("p");
            excerpt.textContent = item.excerpt || "내용 미리보기가 없습니다.";
            const meta = document.createElement("span");
            meta.textContent = `${searchCollectionLabel(item.collection_name)} · ${item.category || "기타"}`;
            result.append(itemTitle, excerpt, meta);
            results.appendChild(result);
        });
    }

    async function runQuickSearch() {
        const query = input.value.trim();
        fullSearchLink.href = query ? `search.html?q=${encodeURIComponent(query)}` : "search.html";
        if (!query) {
            summary.textContent = "";
            renderMessage("검색어를 입력해 주세요.");
            return;
        }
        const sequence = ++requestSequence;
        submit.disabled = true;
        submit.textContent = "검색 중";
        summary.textContent = "";
        renderMessage("검색 중입니다.");
        try {
            const response = await apiRequest(
                `/api/deepsky/search?q=${encodeURIComponent(query)}`,
                {},
                currentUser
            );
            const items = await response.json();
            if (sequence === requestSequence) renderResults(items);
        } catch (error) {
            if (sequence === requestSequence) renderMessage(error.message);
        } finally {
            if (sequence === requestSequence) {
                submit.disabled = false;
                submit.textContent = "검색";
            }
        }
    }

    function setOpen(open) {
        panel.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        if (open) {
            window.dispatchEvent(new CustomEvent("deepsky:account-popover-open", {
                detail: { id: popover.id }
            }));
            input.focus();
        }
    }

    trigger.addEventListener("click", () => setOpen(panel.hidden));
    form.addEventListener("submit", event => {
        event.preventDefault();
        runQuickSearch();
    });
    input.addEventListener("input", () => {
        const query = input.value.trim();
        fullSearchLink.href = query ? `search.html?q=${encodeURIComponent(query)}` : "search.html";
    });
    document.addEventListener("click", event => {
        if (!panel.hidden && !popover.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) {
            setOpen(false);
            trigger.focus();
        }
    });
    window.addEventListener("deepsky:account-popover-open", event => {
        if (event.detail?.id !== popover.id && !panel.hidden) setOpen(false);
    });

    renderMessage("검색어를 입력해 주세요.");
    onAuthStateChanged(auth, user => {
        currentUser = user;
        trigger.hidden = !user;
        if (!user) setOpen(false);
    });
}

function createNotificationPopover() {
    const userZone = document.querySelector(".auth-user-zone");
    if (!userZone || document.getElementById("notification-popover")) return;
    const authBar = userZone.closest(".auth-bar");
    if (authBar) authBar.style.zIndex = "1600";

    const popover = document.createElement("div");
    popover.id = "notification-popover";
    popover.className = "notification-popover";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "notification-trigger";
    trigger.textContent = "알림";
    trigger.title = "알림 열기";
    trigger.setAttribute("aria-label", "알림 열기");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "notification-panel");
    trigger.hidden = true;

    const badge = document.createElement("span");
    badge.className = "notification-trigger-badge";
    badge.hidden = true;
    trigger.appendChild(badge);

    const panel = document.createElement("aside");
    panel.id = "notification-panel";
    panel.className = "notification-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "알림 목록");

    const panelHeader = document.createElement("div");
    panelHeader.className = "notification-panel-header";
    const title = document.createElement("strong");
    title.textContent = "새 알림";
    const readAllButton = document.createElement("button");
    readAllButton.type = "button";
    readAllButton.className = "notification-read-all";
    readAllButton.textContent = "전체 읽음";
    readAllButton.disabled = true;
    panelHeader.append(title, readAllButton);

    const list = document.createElement("div");
    list.className = "notification-popover-list";
    list.setAttribute("aria-live", "polite");

    const historyLink = document.createElement("a");
    historyLink.href = "notifications.html";
    historyLink.className = "notification-history-link";
    historyLink.textContent = "지난 알림 기록 보기";

    panel.append(panelHeader, list, historyLink);
    popover.append(trigger, panel);

    const logoutButton = userZone.querySelector("#logout-btn, #logoutBtn");
    userZone.insertBefore(popover, logoutButton || null);

    let currentUser = null;
    let unreadCount = 0;

    function updateCount(count) {
        unreadCount = Math.max(0, Number(count || 0));
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        badge.hidden = unreadCount === 0;
        readAllButton.disabled = unreadCount === 0;
        trigger.setAttribute(
            "aria-label",
            unreadCount ? `읽지 않은 알림 ${unreadCount}개` : "새 알림 없음"
        );
        const dashboardUnread = document.getElementById("dashboard-unread");
        if (dashboardUnread) dashboardUnread.textContent = String(unreadCount);
    }

    function renderEmpty(message = "새로운 알림이 없습니다.") {
        list.replaceChildren();
        const empty = document.createElement("p");
        empty.className = "notification-popover-empty";
        empty.textContent = message;
        list.appendChild(empty);
    }

    function renderNotifications(notifications) {
        list.replaceChildren();
        if (!notifications.length) {
            renderEmpty();
            return;
        }
        notifications.forEach(notification => {
            const item = document.createElement("article");
            item.className = "notification-popover-item";

            const itemTitle = document.createElement("strong");
            itemTitle.textContent = notification.title || "알림";
            const message = document.createElement("p");
            message.textContent = notification.message || "";
            const time = document.createElement("time");
            time.textContent = formatNotificationDate(notification.created_at);
            if (notification.created_at) time.dateTime = notification.created_at;
            item.append(itemTitle, message, time);

            const href = safeNotificationLink(notification.link);
            if (href) {
                item.classList.add("is-link");
                item.tabIndex = 0;
                item.setAttribute("role", "link");
                const openNotification = async () => {
                    await markNotificationRead(notification.id);
                    location.href = href;
                };
                item.addEventListener("click", openNotification);
                item.addEventListener("keydown", event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openNotification();
                    }
                });
            }
            list.appendChild(item);
        });
    }

    async function loadUnreadCount() {
        if (!currentUser) return;
        try {
            const response = await apiRequest("/api/deepsky/notifications/unread-count", {}, currentUser);
            const data = await response.json();
            updateCount(data.count);
        } catch {
            // Keep the last known count when only the count request is interrupted.
        }
    }

    async function loadNotifications() {
        if (!currentUser) return;
        list.innerHTML = '<p class="notification-popover-empty">알림을 불러오는 중입니다.</p>';
        try {
            const response = await apiRequest("/api/deepsky/notifications?unread=1&limit=30", {}, currentUser);
            const notifications = await response.json();
            renderNotifications(notifications);
            updateCount(notifications.length);
            await loadUnreadCount();
        } catch (error) {
            renderEmpty(error.message);
        }
    }

    async function markNotificationRead(id) {
        try {
            await apiRequest(`/api/deepsky/notifications/${encodeURIComponent(String(id))}/read`, {
                method: "PUT"
            }, currentUser);
            updateCount(unreadCount - 1);
        } catch {
            // The destination remains available if recording the read state fails.
        }
    }

    function setOpen(open) {
        panel.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        if (open) {
            window.dispatchEvent(new CustomEvent("deepsky:account-popover-open", {
                detail: { id: popover.id }
            }));
            loadNotifications();
        }
    }

    trigger.addEventListener("click", () => setOpen(panel.hidden));
    readAllButton.addEventListener("click", async () => {
        if (!currentUser || unreadCount === 0) return;
        readAllButton.disabled = true;
        readAllButton.textContent = "처리 중";
        try {
            await apiRequest("/api/deepsky/notifications/read-all", { method: "PUT" }, currentUser);
            updateCount(0);
            renderEmpty();
            window.dispatchEvent(new CustomEvent("deepsky:notifications-cleared"));
        } catch (error) {
            renderEmpty(error.message);
            readAllButton.disabled = false;
        } finally {
            readAllButton.textContent = "전체 읽음";
        }
    });

    document.addEventListener("click", event => {
        if (!panel.hidden && !popover.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) {
            setOpen(false);
            trigger.focus();
        }
    });
    window.addEventListener("deepsky:notifications-cleared", () => {
        updateCount(0);
        renderEmpty();
    });
    window.addEventListener("deepsky:notifications-changed", loadUnreadCount);
    window.addEventListener("deepsky:account-popover-open", event => {
        if (event.detail?.id !== popover.id && !panel.hidden) setOpen(false);
    });

    onAuthStateChanged(auth, user => {
        currentUser = user;
        trigger.hidden = !user;
        if (!user) {
            setOpen(false);
            updateCount(0);
            renderEmpty();
            return;
        }
        loadUnreadCount();
    });
}

function formatNotificationDate(value) {
    return value ? new Date(value).toLocaleString("ko-KR") : "";
}

function safeNotificationLink(value) {
    return safeSiteLink(value);
}

function announcementPopupVersion(announcement) {
    const source = [
        announcement.id,
        announcement.title,
        announcement.content,
        announcement.starts_at,
        announcement.expires_at
    ].join("|");
    let hash = 5381;
    for (let index = 0; index < source.length; index += 1) {
        hash = ((hash << 5) + hash) ^ source.charCodeAt(index);
    }
    return `${announcement.id}-${(hash >>> 0).toString(36)}`;
}

function storageValue(storage, key) {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

function storeValue(storage, key, value) {
    try {
        storage.setItem(key, value);
    } catch {
        // The popup still works when private browsing blocks web storage.
    }
}

function localDateKey() {
    const now = new Date();
    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0")
    ].join("-");
}

function isAnnouncementPopupDismissed(announcement) {
    const version = announcementPopupVersion(announcement);
    return (
        storageValue(sessionStorage, `deepsky:popup:session:${version}`) === "1"
        || storageValue(localStorage, `deepsky:popup:day:${version}`) === localDateKey()
    );
}

function dismissAnnouncementPopups(announcements, forToday) {
    announcements.forEach(announcement => {
        const version = announcementPopupVersion(announcement);
        storeValue(sessionStorage, `deepsky:popup:session:${version}`, "1");
        if (forToday) {
            storeValue(localStorage, `deepsky:popup:day:${version}`, localDateKey());
        }
    });
}

function showAnnouncementPopup(announcements) {
    if (!announcements.length || document.getElementById("site-announcement-dialog")) return;

    const dialog = document.createElement("dialog");
    dialog.id = "site-announcement-dialog";
    dialog.className = "site-announcement-dialog";
    dialog.setAttribute("aria-labelledby", "site-announcement-dialog-title");

    const header = document.createElement("header");
    header.className = "site-announcement-dialog-header";
    const headingGroup = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "site-announcement-dialog-eyebrow";
    eyebrow.textContent = "DEEP SKY NOTICE";
    const heading = document.createElement("h2");
    heading.id = "site-announcement-dialog-title";
    heading.textContent = announcements.length > 1 ? `중요 공지 ${announcements.length}건` : "중요 공지";
    headingGroup.append(eyebrow, heading);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "site-announcement-dialog-close";
    closeButton.textContent = "닫기";
    closeButton.setAttribute("aria-label", "공지 팝업 닫기");
    header.append(headingGroup, closeButton);

    const list = document.createElement("div");
    list.className = "site-announcement-dialog-list";
    announcements.forEach(announcement => {
        const article = document.createElement("article");
        const title = document.createElement("h3");
        title.textContent = announcement.title || "공지";
        const content = document.createElement("p");
        content.textContent = announcement.content || "";
        const time = document.createElement("time");
        if (announcement.created_at) time.dateTime = announcement.created_at;
        time.textContent = announcement.created_at
            ? new Date(announcement.created_at).toLocaleString("ko-KR")
            : "";
        article.append(title, content, time);
        list.appendChild(article);
    });

    const footer = document.createElement("footer");
    footer.className = "site-announcement-dialog-footer";
    const todayLabel = document.createElement("label");
    const todayCheckbox = document.createElement("input");
    todayCheckbox.type = "checkbox";
    todayLabel.append(todayCheckbox, document.createTextNode(" 오늘 하루 보지 않기"));
    const detailsLink = document.createElement("a");
    detailsLink.href = "talk.html#talk-announcement-title";
    detailsLink.className = "btn btn-primary";
    detailsLink.textContent = "전체 공지 보기";
    footer.append(todayLabel, detailsLink);
    dialog.append(header, list, footer);
    document.body.appendChild(dialog);

    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        dismissAnnouncementPopups(announcements, todayCheckbox.checked);
    };
    closeButton.addEventListener("click", () => {
        dismiss();
        dialog.close();
    });
    detailsLink.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", dismiss);
    dialog.addEventListener("click", event => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        const inside = (
            event.clientX >= bounds.left
            && event.clientX <= bounds.right
            && event.clientY >= bounds.top
            && event.clientY <= bounds.bottom
        );
        if (!inside) {
            dismiss();
            dialog.close();
        }
    });
    dialog.showModal();
}

async function createAnnouncementPopup() {
    try {
        const params = new URLSearchParams({ scope: "all", active: "1" });
        const response = await apiFetch(`/api/deepsky/announcements?${params}`, {
            headers: { "ngrok-skip-browser-warning": "69420" }
        });
        if (!response.ok) return;
        const announcements = await response.json();
        const visible = announcements.filter(announcement => (
            announcement.importance === "important"
            && !isAnnouncementPopupDismissed(announcement)
        ));
        showAnnouncementPopup(visible);
    } catch {
        // A failed popup request must not interrupt the rest of the site.
    }
}

function safeSiteLink(value) {
    if (!value) return "";
    try {
        const url = new URL(value, location.href);
        return url.origin === location.origin ? url.href : "";
    } catch {
        return "";
    }
}

function searchCollectionLabel(value) {
    return {
        resources: "공용 자료",
        "club-board": "동아리 게시판"
    }[value] || value || "자료";
}

function createAiLauncher() {
    const page = location.pathname.split("/").pop() || "index.html";
    if (["ai.html", "login.html", "signup.html", "block.html"].includes(page)) return;
    if (document.getElementById("ai-launcher")) return;

    const launcher = document.createElement("div");
    launcher.id = "ai-launcher";
    launcher.className = "ai-launcher";
    launcher.hidden = true;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ai-launcher-toggle";
    toggle.textContent = "AI";
    toggle.title = "DEEP SKY AI 열기";
    toggle.setAttribute("aria-label", "DEEP SKY AI 열기");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "ai-quick-panel");

    const panel = document.createElement("aside");
    panel.id = "ai-quick-panel";
    panel.className = "ai-quick-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "DEEP SKY AI 빠른 질문");

    const header = document.createElement("div");
    header.className = "ai-quick-header";
    const title = document.createElement("strong");
    title.textContent = "DEEP SKY AI";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ai-quick-close";
    close.textContent = "×";
    close.title = "닫기";
    close.setAttribute("aria-label", "AI 창 닫기");
    header.append(title, close);

    const output = document.createElement("div");
    output.className = "ai-quick-output";
    output.setAttribute("role", "status");
    output.setAttribute("aria-live", "polite");
    output.textContent = "천문·물리 질문을 입력해 주세요.";

    const form = document.createElement("form");
    form.className = "ai-quick-form";
    const input = document.createElement("textarea");
    input.maxLength = 500;
    input.rows = 2;
    input.placeholder = "질문 입력";
    input.setAttribute("aria-label", "AI에게 질문");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "btn btn-primary";
    submit.textContent = "보내기";
    form.append(input, submit);

    const fullPage = document.createElement("a");
    fullPage.href = "ai.html";
    fullPage.className = "ai-quick-full-link";
    fullPage.textContent = "AI 페이지에서 계속";

    panel.append(header, output, form, fullPage);
    launcher.append(panel, toggle);
    document.body.append(launcher);

    const setOpen = open => {
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        if (open) input.focus();
    };

    let aiAccessAllowed = false;
    let authSequence = 0;
    onAuthStateChanged(auth, async user => {
        const sequence = ++authSequence;
        aiAccessAllowed = false;
        launcher.hidden = true;
        setOpen(false);
        if (!user) return;
        try {
            const profile = await getCurrentProfile(user);
            if (sequence !== authSequence) return;
            aiAccessAllowed = AI_ALLOWED_ROLES.has(profile.role);
            launcher.hidden = !aiAccessAllowed;
        } catch {
            if (sequence === authSequence) launcher.hidden = true;
        }
    });

    toggle.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) setOpen(false);
    });

    const history = [];
    form.addEventListener("submit", async event => {
        event.preventDefault();
        const message = input.value.trim();
        if (!message) return;
        if (!auth.currentUser || !aiAccessAllowed) {
            location.href = "block.html";
            return;
        }

        submit.disabled = true;
        submit.textContent = "응답 중";
        output.textContent = "답변을 준비하고 있습니다.";
        try {
            const response = await apiRequest("/api/deepsky/ai/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message,
                    history: history.slice(-4),
                    saveConversation: false
                })
            });
            const data = await response.json();
            output.textContent = data.answer;
            history.push(
                { role: "user", content: message },
                { role: "model", content: data.answer }
            );
            input.value = "";
        } catch (error) {
            output.textContent = error.message;
        } finally {
            submit.disabled = false;
            submit.textContent = "보내기";
        }
    });
}

function initializeCommonUi() {
    void applySiteBranding();
    startApiStatusMonitor();
    addFeatureNavigationLinks();
    createSearchPopover();
    createNotificationPopover();
    createAiLauncher();
    createAnnouncementPopup();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeCommonUi, { once: true });
} else {
    initializeCommonUi();
}
