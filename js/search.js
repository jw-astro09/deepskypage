import { apiRequest, auth, getCurrentProfile, logoutTo } from "./common.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const form = document.getElementById("search-form");
const results = document.getElementById("search-results");
const summary = document.getElementById("search-summary");
let currentUser = null;

document.getElementById("logout-btn").addEventListener("click", () => logoutTo());

onAuthStateChanged(auth, async user => {
    if (!user) {
        location.replace("block.html");
        return;
    }
    try {
        currentUser = user;
        const profile = await getCurrentProfile(user);
        document.getElementById("user-name").textContent = `${profile.name || "사용자"}님`;
        limitCollectionOptions(profile.role);
        const initialQuery = new URLSearchParams(location.search).get("q");
        if (initialQuery) {
            document.getElementById("search-query").value = initialQuery;
            await runSearch();
        }
    } catch {
        location.replace("block.html");
    }
});

form.addEventListener("submit", event => {
    event.preventDefault();
    runSearch();
});

async function runSearch() {
    if (!currentUser) return;
    const params = new URLSearchParams();
    const fields = {
        q: "search-query",
        collection: "search-collection",
        category: "search-category",
        date_from: "search-from",
        date_to: "search-to"
    };
    Object.entries(fields).forEach(([key, id]) => {
        const value = document.getElementById(id).value.trim();
        if (value) params.set(key, value);
    });
    results.innerHTML = '<div class="loading-state">검색 중입니다.</div>';
    summary.textContent = "";
    try {
        const response = await apiRequest(`/api/deepsky/search?${params}`, {}, currentUser);
        const items = await response.json();
        summary.textContent = `${items.length}개의 결과`;
        results.innerHTML = "";
        if (!items.length) {
            results.innerHTML = '<div class="empty-state">조건에 맞는 자료가 없습니다.</div>';
            return;
        }
        items.forEach(item => results.appendChild(renderResult(item)));
    } catch (error) {
        results.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
}

function renderResult(item) {
    const article = document.createElement("article");
    article.className = "feature-item";
    const link = document.createElement("a");
    link.href = item.link;
    const title = document.createElement("h3");
    title.textContent = item.title || "제목 없음";
    const excerpt = document.createElement("p");
    excerpt.textContent = item.excerpt || "내용 미리보기가 없습니다.";
    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${collectionLabel(item.collection_name)} · ${item.category || "기타"} · ${item.author_name || "익명"} · ${formatDate(item.created_at)}`;
    link.append(title, excerpt, meta);
    article.appendChild(link);
    return article;
}

function limitCollectionOptions(role) {
    const allowed = new Set(["resources"]);
    if (["admin", "teacher", "student"].includes(role)) allowed.add("club-board");
    document.querySelectorAll("#search-collection option[value]").forEach(option => {
        if (option.value && !allowed.has(option.value)) option.remove();
    });
}

function collectionLabel(value) {
    return {
        resources: "공용 자료",
        "club-board": "동아리 게시판"
    }[value] || value;
}

function formatDate(value) {
    return value ? new Date(value).toLocaleDateString("ko-KR") : "-";
}

function escapeHtml(value) {
    return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
