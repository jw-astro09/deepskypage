import { apiRequest, auth, getCurrentProfile, logoutTo } from "./common.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const list = document.getElementById("notification-list");
const filterButtons = document.querySelectorAll("[data-filter]");
let currentUser = null;
let currentFilter = "all";

document.getElementById("logout-btn").addEventListener("click", () => logoutTo());
document.getElementById("read-all-btn").addEventListener("click", async () => {
    if (!currentUser) return;
    await apiRequest("/api/deepsky/notifications/read-all", { method: "PUT" }, currentUser);
    window.dispatchEvent(new CustomEvent("deepsky:notifications-cleared"));
    await loadNotifications();
});

filterButtons.forEach(button => {
    button.addEventListener("click", () => {
        currentFilter = button.dataset.filter;
        filterButtons.forEach(item => item.classList.toggle("btn-primary", item === button));
        loadNotifications();
    });
});

onAuthStateChanged(auth, async user => {
    if (!user) {
        location.replace("block.html");
        return;
    }
    try {
        currentUser = user;
        const profile = await getCurrentProfile(user);
        document.getElementById("user-name").textContent = `${profile.name || "사용자"}님`;
        await loadNotifications();
    } catch {
        location.replace("block.html");
    }
});

async function loadNotifications() {
    list.innerHTML = '<div class="loading-state">알림을 불러오는 중입니다.</div>';
    try {
        const query = currentFilter === "unread" ? "?unread=1" : "";
        const response = await apiRequest(`/api/deepsky/notifications${query}`, {}, currentUser);
        const notifications = await response.json();
        list.innerHTML = "";
        if (!notifications.length) {
            list.innerHTML = '<div class="empty-state">표시할 알림이 없습니다.</div>';
            return;
        }
        notifications.forEach(notification => list.appendChild(renderNotification(notification)));
    } catch (error) {
        list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
}

function renderNotification(notification) {
    const item = document.createElement("article");
    item.className = `feature-item notification-item${notification.is_read ? "" : " unread"}`;

    const header = document.createElement("div");
    header.className = "list-item-header";
    const title = document.createElement("h3");
    title.textContent = notification.title || "알림";
    const state = document.createElement("span");
    state.className = `status-chip${notification.is_read ? "" : " unread"}`;
    state.textContent = notification.is_read ? "읽음" : "새 알림";
    header.append(title, state);

    const message = document.createElement("p");
    message.textContent = notification.message || "";
    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = formatDate(notification.created_at);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    if (!notification.is_read) {
        const readButton = document.createElement("button");
        readButton.type = "button";
        readButton.className = "btn";
        readButton.textContent = "읽음 처리";
        readButton.addEventListener("click", async () => {
            await markRead(notification.id);
            window.dispatchEvent(new CustomEvent("deepsky:notifications-changed"));
            await loadNotifications();
        });
        actions.appendChild(readButton);
    }
    if (notification.link) {
        const openButton = document.createElement("a");
        openButton.className = "btn btn-primary";
        openButton.href = notification.link;
        openButton.textContent = "확인";
        openButton.addEventListener("click", () => {
            markRead(notification.id);
            window.dispatchEvent(new CustomEvent("deepsky:notifications-changed"));
        });
        actions.appendChild(openButton);
    }
    item.append(header, message, meta, actions);
    return item;
}

async function markRead(id) {
    try {
        await apiRequest(`/api/deepsky/notifications/${encodeURIComponent(String(id))}/read`, {
            method: "PUT"
        }, currentUser);
    } catch {
        // Navigation should still continue when a read receipt fails.
    }
}

function formatDate(value) {
    return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

function escapeHtml(value) {
    return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
