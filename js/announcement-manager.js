import { apiRequest } from "./common.js";
import { loadAnnouncementFeed } from "./announcement-feed.js";

export async function initializeAnnouncementSection({
    section,
    container,
    user = null,
    profile = null,
    scope,
    emptyMessage
}) {
    const form = section.querySelector(".announcement-inline-form");
    const openButton = section.querySelector(".announcement-compose-toggle");
    const canManage = user && canManageScope(profile?.role, scope);
    let editingItem = null;

    openButton.hidden = !canManage;
    form.hidden = true;

    const resetForm = () => {
        editingItem = null;
        form.reset();
        form.querySelector('[name="announcement-id"]').value = "";
        form.querySelector(".announcement-inline-title").textContent = "새 공지";
        form.querySelector(".announcement-inline-status").textContent = "";
    };

    const closeForm = () => {
        resetForm();
        form.hidden = true;
        openButton.textContent = "공지 작성";
    };

    const load = () => loadAnnouncementFeed({
        container,
        user,
        scope,
        emptyMessage,
        activeOnly: !canManage,
        onEdit: canManage ? editAnnouncement : null,
        onDelete: canManage ? deleteAnnouncement : null
    });

    const showForm = () => {
        form.hidden = false;
        openButton.textContent = "작성 닫기";
        form.querySelector('[name="announcement-title"]').focus();
    };

    function editAnnouncement(item) {
        editingItem = item;
        form.querySelector(".announcement-inline-title").textContent = "공지 수정";
        form.querySelector('[name="announcement-id"]').value = item.id;
        form.querySelector('[name="announcement-title"]').value = item.title || "";
        form.querySelector('[name="announcement-importance"]').value = item.importance || "normal";
        form.querySelector('[name="announcement-start"]').value = toLocalInput(item.starts_at);
        form.querySelector('[name="announcement-expiry"]').value = toLocalInput(item.expires_at);
        form.querySelector('[name="announcement-pinned"]').checked = Boolean(item.is_pinned);
        form.querySelector('[name="announcement-content"]').value = item.content || "";
        showForm();
        form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    async function deleteAnnouncement(item) {
        if (!confirm(`"${item.title}" 공지를 삭제하시겠습니까?`)) return;
        try {
            await apiRequest(`/api/deepsky/announcements/${encodeURIComponent(String(item.id))}`, {
                method: "DELETE"
            }, user);
            closeForm();
            await load();
        } catch (error) {
            form.hidden = false;
            form.querySelector(".announcement-inline-status").textContent = error.message;
        }
    }

    openButton.onclick = () => {
        if (form.hidden) {
            resetForm();
            showForm();
        } else {
            closeForm();
        }
    };
    form.querySelector(".announcement-inline-cancel").onclick = closeForm;
    form.onsubmit = async event => {
        event.preventDefault();
        if (!canManage) return;
        const id = form.querySelector('[name="announcement-id"]').value;
        const status = form.querySelector(".announcement-inline-status");
        const submit = form.querySelector('button[type="submit"]');
        const payload = {
            title: form.querySelector('[name="announcement-title"]').value.trim(),
            content: form.querySelector('[name="announcement-content"]').value.trim(),
            school_scope: scope,
            importance: form.querySelector('[name="announcement-importance"]').value,
            is_pinned: form.querySelector('[name="announcement-pinned"]').checked,
            starts_at: form.querySelector('[name="announcement-start"]').value,
            expires_at: form.querySelector('[name="announcement-expiry"]').value
        };
        submit.disabled = true;
        submit.textContent = "저장 중";
        status.textContent = "";
        try {
            await apiRequest(id
                ? `/api/deepsky/announcements/${encodeURIComponent(id)}`
                : "/api/deepsky/announcements", {
                method: id ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }, user);
            closeForm();
            await load();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            submit.disabled = false;
            submit.textContent = "저장";
        }
    };

    await load();
}

function toLocalInput(value) {
    if (!value) return "";
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function canManageScope(role, scope) {
    return scope === "all" && ["admin", "teacher"].includes(role);
}
