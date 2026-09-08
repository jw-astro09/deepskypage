import { apiRequest } from "./common.js";

const list = document.getElementById("event-list");
const form = document.getElementById("event-form");
const formStatus = document.getElementById("event-form-status");
const periodButtons = document.querySelectorAll("[data-period]");
let currentUser = null;
let currentProfile = null;
let currentPeriod = "upcoming";
let eventCache = [];

document.getElementById("event-reset-btn").addEventListener("click", resetForm);
periodButtons.forEach(button => {
    button.addEventListener("click", () => {
        currentPeriod = button.dataset.period;
        periodButtons.forEach(item => item.classList.toggle("btn-primary", item === button));
        loadEvents();
    });
});

export async function initializeSchedule(user = null, profile = null) {
    if (!user) {
        currentUser = null;
        currentProfile = null;
        form.hidden = true;
        list.innerHTML = '<div class="empty-state">관측 일정은 로그인 후 확인할 수 있습니다. <a href="login.html">로그인</a></div>';
        return;
    }
    currentUser = user;
    currentProfile = profile;
    configureManagerForm();
    await loadEvents();
}

form.addEventListener("submit", async event => {
    event.preventDefault();
    const id = document.getElementById("event-id").value;
    const payload = {
        title: valueOf("event-title"),
        school_scope: valueOf("event-scope"),
        start_at: valueOf("event-start"),
        end_at: valueOf("event-end"),
        location: valueOf("event-location"),
        target_object: valueOf("event-target"),
        description: valueOf("event-description"),
        checklist: valueOf("event-checklist")
    };
    formStatus.textContent = "저장 중입니다.";
    try {
        await apiRequest(id ? `/api/deepsky/events/${id}` : "/api/deepsky/events", {
            method: id ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }, currentUser);
        resetForm();
        await loadEvents();
    } catch (error) {
        formStatus.textContent = error.message;
    }
});

async function loadEvents() {
    list.innerHTML = '<div class="loading-state">일정을 불러오는 중입니다.</div>';
    try {
        const response = await apiRequest(`/api/deepsky/events?period=${currentPeriod}`, {}, currentUser);
        eventCache = await response.json();
        list.innerHTML = "";
        if (!eventCache.length) {
            list.innerHTML = '<div class="empty-state">등록된 일정이 없습니다.</div>';
            return;
        }
        eventCache.forEach(item => list.appendChild(renderEvent(item)));
    } catch (error) {
        list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
}

function renderEvent(item) {
    const article = document.createElement("article");
    article.className = "feature-item";
    article.id = `event-${item.id}`;
    const header = document.createElement("div");
    header.className = "list-item-header";
    const title = document.createElement("h3");
    title.textContent = item.title;
    const scope = document.createElement("span");
    scope.className = "status-chip";
    scope.textContent = scopeLabel(item.school_scope);
    header.append(title, scope);

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${formatDate(item.start_at)}${item.end_at ? ` - ${formatDate(item.end_at)}` : ""} · ${item.location || "장소 미정"} · 참여 ${item.participant_count || 0}명`;
    const description = document.createElement("p");
    description.textContent = item.description || "상세 설명이 없습니다.";
    article.append(header, meta, description);

    if (item.target_object) {
        const target = document.createElement("p");
        target.textContent = `관측 대상: ${item.target_object}`;
        article.appendChild(target);
    }
    if (item.checklist) {
        const checklist = document.createElement("p");
        checklist.textContent = `준비 항목\n${item.checklist}`;
        article.appendChild(checklist);
    }

    const actions = document.createElement("div");
    actions.className = "item-actions";
    if (currentPeriod === "upcoming") {
        const join = document.createElement("button");
        join.type = "button";
        join.className = item.joined ? "btn" : "btn btn-primary";
        join.textContent = item.joined ? "참여 취소" : "참여";
        join.addEventListener("click", () => toggleParticipation(item));
        actions.appendChild(join);
    }
    if (item.can_manage) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "btn";
        edit.textContent = "수정";
        edit.addEventListener("click", () => fillForm(item));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn";
        remove.textContent = "삭제";
        remove.addEventListener("click", () => deleteEvent(item));
        actions.append(edit, remove);
    }
    article.appendChild(actions);
    return article;
}

async function toggleParticipation(item) {
    await apiRequest(`/api/deepsky/events/${item.id}/participation`, {
        method: item.joined ? "DELETE" : "POST"
    }, currentUser);
    await loadEvents();
}

async function deleteEvent(item) {
    if (!confirm(`"${item.title}" 일정을 삭제하시겠습니까?`)) return;
    await apiRequest(`/api/deepsky/events/${item.id}`, { method: "DELETE" }, currentUser);
    resetForm();
    await loadEvents();
}

function configureManagerForm() {
    const role = currentProfile?.role;
    const manager = ["admin", "teacher"].includes(role);
    form.hidden = !manager;
}

function fillForm(item) {
    document.getElementById("event-form-title").textContent = "일정 수정";
    document.getElementById("event-id").value = item.id;
    document.getElementById("event-title").value = item.title || "";
    document.getElementById("event-scope").value = item.school_scope;
    document.getElementById("event-start").value = toLocalInput(item.start_at);
    document.getElementById("event-end").value = toLocalInput(item.end_at);
    document.getElementById("event-location").value = item.location || "";
    document.getElementById("event-target").value = item.target_object || "";
    document.getElementById("event-description").value = item.description || "";
    document.getElementById("event-checklist").value = item.checklist || "";
    form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm() {
    form.reset();
    document.getElementById("event-id").value = "";
    document.getElementById("event-form-title").textContent = "새 일정";
    formStatus.textContent = "";
}

function toLocalInput(value) {
    if (!value) return "";
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function valueOf(id) {
    return document.getElementById(id).value.trim();
}

function formatDate(value) {
    return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

function scopeLabel(scope) {
    return { all: "전체" }[scope] || scope;
}

function escapeHtml(value) {
    return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
