import { apiFetch, apiRequest } from "./common.js";

const elements = {
    compose: document.getElementById("update-compose-toggle"),
    form: document.getElementById("update-form"),
    formTitle: document.getElementById("update-form-title"),
    id: document.getElementById("update-id"),
    version: document.getElementById("update-version"),
    publishedAt: document.getElementById("update-published-at"),
    title: document.getElementById("update-title"),
    content: document.getElementById("update-content"),
    pinned: document.getElementById("update-pinned"),
    status: document.getElementById("update-form-status"),
    cancel: document.getElementById("update-cancel"),
    list: document.getElementById("update-list")
};

let currentUser = null;
let canManage = false;

elements.compose.addEventListener("click", () => {
    if (elements.form.hidden) openForm();
    else closeForm();
});
elements.cancel.addEventListener("click", closeForm);

function openForm(item = null) {
    elements.form.reset();
    elements.status.textContent = "";
    elements.id.value = item?.id || "";
    elements.version.value = item?.version || "";
    elements.title.value = item?.title || "";
    elements.content.value = item?.content || "";
    elements.pinned.checked = Boolean(item?.is_pinned);
    elements.publishedAt.value = toLocalInput(item?.published_at);
    elements.formTitle.textContent = item ? "업데이트 기록 수정" : "새 업데이트 기록";
    elements.form.hidden = false;
    elements.compose.textContent = "작성 닫기";
    elements.title.focus();
}

function closeForm() {
    elements.form.reset();
    elements.id.value = "";
    elements.status.textContent = "";
    elements.form.hidden = true;
    elements.compose.textContent = "기록 작성";
}

elements.form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser || !canManage) return;
    const id = elements.id.value;
    const submit = elements.form.querySelector('button[type="submit"]');
    const payload = {
        version: elements.version.value.trim(),
        title: elements.title.value.trim(),
        content: elements.content.value.trim(),
        is_pinned: elements.pinned.checked,
        published_at: elements.publishedAt.value
    };
    submit.disabled = true;
    submit.textContent = "저장 중";
    elements.status.textContent = "";
    try {
        await apiRequest(id ? `/api/deepsky/updates/${encodeURIComponent(id)}` : "/api/deepsky/updates", {
            method: id ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }, currentUser);
        closeForm();
        await loadUpdates();
    } catch (error) {
        elements.status.textContent = error.message;
    } finally {
        submit.disabled = false;
        submit.textContent = "저장";
    }
});

async function deleteUpdate(item) {
    if (!confirm(`"${item.title}" 업데이트 기록을 삭제하시겠습니까?`)) return;
    try {
        await apiRequest(`/api/deepsky/updates/${encodeURIComponent(String(item.id))}`, {
            method: "DELETE"
        }, currentUser);
        closeForm();
        await loadUpdates();
    } catch (error) {
        alert(error.message);
    }
}

async function loadUpdates() {
    elements.list.replaceChildren(createState("업데이트 기록을 불러오는 중입니다.", "loading-state"));
    try {
        const response = currentUser
            ? await apiRequest("/api/deepsky/updates", {}, currentUser)
            : await apiFetch("/api/deepsky/updates", { headers: { "ngrok-skip-browser-warning": "69420" } });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "업데이트 기록을 불러올 수 없습니다.");
        }
        const items = await response.json();
        renderUpdates(items);
    } catch (error) {
        elements.list.replaceChildren(createState(error.message, "empty-state"));
    }
}

function renderUpdates(items) {
    elements.list.replaceChildren();
    if (!items.length) {
        elements.list.appendChild(createState("등록된 업데이트 기록이 없습니다.", "empty-state"));
        return;
    }
    items.forEach(item => {
        const article = document.createElement("article");
        article.className = `update-record${item.is_pinned ? " pinned" : ""}`;

        const header = document.createElement("div");
        header.className = "update-record-header";
        const heading = document.createElement("div");
        const version = document.createElement("span");
        version.className = "update-version";
        version.textContent = item.version || "UPDATE";
        const title = document.createElement("h3");
        title.textContent = item.title || "제목 없음";
        heading.append(version, title);
        const time = document.createElement("time");
        if (item.published_at) time.dateTime = item.published_at;
        time.textContent = formatDate(item.published_at);
        header.append(heading, time);

        const content = document.createElement("p");
        content.className = "update-content";
        content.textContent = item.content || "";
        const meta = document.createElement("p");
        meta.className = "update-meta";
        meta.textContent = `작성자 ${item.author_name || "DEEP SKY"}`;
        article.append(header, content, meta);

        if (item.can_manage && canManage) {
            const actions = document.createElement("div");
            actions.className = "item-actions";
            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "btn";
            edit.textContent = "수정";
            edit.addEventListener("click", () => openForm(item));
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn";
            remove.textContent = "삭제";
            remove.addEventListener("click", () => deleteUpdate(item));
            actions.append(edit, remove);
            article.appendChild(actions);
        }
        elements.list.appendChild(article);
    });
}

function createState(message, className) {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = message;
    return element;
}

function formatDate(value) {
    return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

function toLocalInput(value) {
    if (!value) return "";
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

export async function initializeUpdates(user = null, profile = null) {
    currentUser = user;
    canManage = Boolean(user && ["admin", "teacher"].includes(profile?.role));
    elements.compose.hidden = !canManage;
    if (!canManage) closeForm();
    await loadUpdates();
}
