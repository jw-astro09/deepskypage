import { apiFetch, apiRequest } from "./common.js";

export async function loadAnnouncementFeed({
    container,
    user = null,
    scope,
    emptyMessage,
    activeOnly = true,
    onEdit = null,
    onDelete = null
}) {
    container.innerHTML = '<div class="loading-state">공지사항을 불러오는 중입니다.</div>';
    const params = new URLSearchParams({ scope });
    if (activeOnly) params.set("active", "1");
    try {
        const response = user
            ? await apiRequest(`/api/deepsky/announcements?${params}`, {}, user)
            : await apiFetch(`/api/deepsky/announcements?${params}`, {
                headers: { "ngrok-skip-browser-warning": "69420" }
            });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "공지사항을 불러올 수 없습니다.");
        }
        const announcements = await response.json();
        renderAnnouncementFeed(container, announcements, emptyMessage, onEdit, onDelete);
        return announcements;
    } catch (error) {
        container.innerHTML = "";
        const message = document.createElement("div");
        message.className = "empty-state";
        message.textContent = error.message;
        container.appendChild(message);
        return [];
    }
}

function renderAnnouncementFeed(container, announcements, emptyMessage, onEdit, onDelete) {
    container.innerHTML = "";
    if (!announcements.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = emptyMessage;
        container.appendChild(empty);
        return;
    }
    announcements.forEach(announcement => {
        const article = document.createElement("article");
        article.className = `announcement-feed-item${announcement.importance === "important" ? " important" : ""}`;

        const header = document.createElement("div");
        header.className = "list-item-header";
        const title = document.createElement("h3");
        title.textContent = announcement.title;
        const chip = document.createElement("span");
        chip.className = `status-chip${announcement.importance === "important" ? " important" : ""}`;
        chip.textContent = announcementState(announcement);
        header.append(title, chip);

        const content = document.createElement("p");
        content.textContent = announcement.content || "";
        const meta = document.createElement("div");
        meta.className = "item-meta";
        meta.textContent = `${announcement.author_name || "DEEP SKY"} · ${formatDate(announcement.created_at)}`;
        article.append(header, content, meta);
        if (announcement.can_manage && onEdit && onDelete) {
            const actions = document.createElement("div");
            actions.className = "item-actions announcement-actions";
            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "btn";
            edit.textContent = "수정";
            edit.addEventListener("click", () => onEdit(announcement));
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn";
            remove.textContent = "삭제";
            remove.addEventListener("click", () => onDelete(announcement));
            actions.append(edit, remove);
            article.appendChild(actions);
        }
        container.appendChild(article);
    });
}

function announcementState(announcement) {
    const now = Date.now();
    const startsAt = announcement.starts_at ? new Date(announcement.starts_at).getTime() : 0;
    const expiresAt = announcement.expires_at ? new Date(announcement.expires_at).getTime() : 0;
    if (startsAt && startsAt > now) return "예약";
    if (expiresAt && expiresAt <= now) return "종료";
    return announcement.importance === "important" ? "중요" : "공지";
}

function formatDate(value) {
    return value ? new Date(value).toLocaleString("ko-KR") : "-";
}
