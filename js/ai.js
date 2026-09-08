import { apiRequest, auth, getCurrentProfile } from "./common.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const elements = {
    form: document.getElementById("ai-form"),
    mode: document.getElementById("ai-mode"),
    input: document.getElementById("ai-input"),
    send: document.getElementById("ai-send-btn"),
    messages: document.getElementById("chat-messages"),
    suggestions: document.getElementById("prompt-suggestions"),
    save: document.getElementById("save-conversation"),
    charCount: document.getElementById("ai-char-count"),
    usage: document.getElementById("ai-usage"),
    conversationList: document.getElementById("conversation-list"),
    newChat: document.getElementById("new-chat-btn"),
    loginLink: document.getElementById("login-link"),
    logout: document.getElementById("logout-btn"),
    userName: document.getElementById("user-name")
};

const state = {
    user: null,
    conversationId: null,
    history: [],
    available: false
};

function setUsage(used) {
    elements.usage.textContent = `오늘 ${used}회 · 서버 자체 AI`;
}

function updateInputLimit() {
    const limit = elements.mode.value === "analyze" ? 4000 : 2000;
    elements.input.maxLength = limit;
    elements.input.placeholder = {
        concept: "설명할 개념을 입력하세요",
        search: "찾을 자료의 핵심어를 입력하세요",
        analyze: "분석할 내용이나 자료를 붙여 넣으세요",
        server: "확인할 서버 상태를 입력하세요"
    }[elements.mode.value];
    if (elements.input.value.length > limit) elements.input.value = elements.input.value.slice(0, limit);
    elements.charCount.textContent = `${elements.input.value.length} / ${limit}`;
}

function setBusy(busy) {
    elements.send.disabled = busy || !state.available;
    elements.input.disabled = busy || !state.available;
    elements.send.textContent = busy ? "응답 중" : "보내기";
}

function scrollToLatest() {
    elements.messages.scrollTop = elements.messages.scrollHeight;
}

function addFeedbackControls(container, responseId) {
    if (!responseId) return;
    const controls = document.createElement("div");
    controls.className = "message-feedback";

    for (const [label, rating] of [["도움됨", 1], ["개선 필요", -1]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", async () => {
            try {
                await apiRequest("/api/deepsky/ai/feedback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ responseId, rating })
                });
                controls.querySelectorAll("button").forEach(item => {
                    item.disabled = true;
                });
                button.textContent = "반영됨";
            } catch (error) {
                alert(error.message);
            }
        }, { once: true });
        controls.append(button);
    }
    container.append(controls);
}

function addMessage(role, content, options = {}) {
    const article = document.createElement("article");
    article.className = `chat-message ${role === "user" ? "user" : "assistant"}`;

    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent = role === "user" ? "나" : "DEEP SKY AI";

    const body = document.createElement("p");
    body.className = "message-content";
    body.textContent = content;
    article.append(label, body);

    if (Array.isArray(options.sources) && options.sources.length) {
        const sources = document.createElement("div");
        sources.className = "message-sources";
        for (const source of options.sources) {
            const link = document.createElement("a");
            link.href = source.url;
            link.textContent = source.title;
            sources.append(link);
        }
        article.append(sources);
    }

    if (role !== "user") addFeedbackControls(article, options.responseId);
    elements.messages.append(article);
    scrollToLatest();
    return article;
}

function removeDynamicMessages() {
    elements.messages.querySelectorAll(".chat-message, .prompt-suggestions").forEach(node => node.remove());
}

function resetChat() {
    state.conversationId = null;
    state.history = [];
    elements.save.checked = false;
    removeDynamicMessages();
    addMessage("model", "새 대화를 시작했습니다. 천문·물리와 관측에 관해 질문해 주세요.");
    document.querySelectorAll(".conversation-item").forEach(item => item.classList.remove("active"));
    elements.input.focus();
}

async function refreshConversations() {
    if (!state.user) return;
    try {
        const response = await apiRequest("/api/deepsky/ai/conversations");
        const conversations = await response.json();
        elements.conversationList.replaceChildren();
        if (!conversations.length) {
            const empty = document.createElement("p");
            empty.className = "ai-muted";
            empty.textContent = "저장된 대화가 없습니다.";
            elements.conversationList.append(empty);
            return;
        }

        for (const conversation of conversations) {
            const item = document.createElement("div");
            item.className = "conversation-item";
            item.dataset.id = conversation.id;
            if (conversation.id === state.conversationId) item.classList.add("active");

            const open = document.createElement("button");
            open.type = "button";
            open.className = "conversation-open";
            open.textContent = conversation.title;
            open.title = conversation.title;
            open.addEventListener("click", () => loadConversation(conversation.id));

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "conversation-delete";
            remove.textContent = "×";
            remove.title = "대화 삭제";
            remove.setAttribute("aria-label", `${conversation.title} 삭제`);
            remove.addEventListener("click", () => deleteConversation(conversation.id));
            item.append(open, remove);
            elements.conversationList.append(item);
        }
    } catch (error) {
        console.error(error);
    }
}

async function loadConversation(id) {
    try {
        const response = await apiRequest(`/api/deepsky/ai/conversations/${encodeURIComponent(id)}`);
        const data = await response.json();
        state.conversationId = id;
        state.history = [];
        elements.save.checked = true;
        removeDynamicMessages();

        for (const message of data.messages) {
            const role = message.role === "user" ? "user" : "model";
            addMessage(role, message.content, { responseId: message.response_id });
            state.history.push({ role, content: message.content });
        }
        await refreshConversations();
    } catch (error) {
        alert(error.message);
    }
}

async function deleteConversation(id) {
    if (!confirm("이 대화를 삭제하시겠습니까?")) return;
    try {
        await apiRequest(`/api/deepsky/ai/conversations/${encodeURIComponent(id)}`, {
            method: "DELETE"
        });
        if (state.conversationId === id) resetChat();
        await refreshConversations();
    } catch (error) {
        alert(error.message);
    }
}

async function sendMessage(message) {
    const priorHistory = state.history.slice(-8);
    addMessage("user", message);
    state.history.push({ role: "user", content: message });
    setBusy(true);

    try {
        const response = await apiRequest("/api/deepsky/ai/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message,
                mode: elements.mode.value,
                history: priorHistory,
                saveConversation: elements.save.checked,
                conversationId: state.conversationId
            })
        });
        const data = await response.json();
        state.conversationId = data.conversationId || null;
        state.history.push({ role: "model", content: data.answer });
        addMessage("model", data.answer, {
            responseId: data.responseId,
            sources: data.sources
        });
        if (data.usage) setUsage(data.usage.used);
        if (state.conversationId) await refreshConversations();
    } catch (error) {
        state.history.pop();
        addMessage("model", error.message);
    } finally {
        setBusy(false);
    }
}

elements.form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = elements.input.value.trim();
    if (!message || !state.user || !state.available) return;
    elements.input.value = "";
    elements.charCount.textContent = `0 / ${elements.input.maxLength}`;
    await sendMessage(message);
});

elements.input.addEventListener("input", () => {
    elements.charCount.textContent = `${elements.input.value.length} / ${elements.input.maxLength}`;
});

elements.input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        elements.form.requestSubmit();
    }
});

elements.suggestions?.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
        if (button.dataset.mode) elements.mode.value = button.dataset.mode;
        updateInputLimit();
        elements.input.value = button.textContent;
        elements.input.dispatchEvent(new Event("input"));
        elements.input.focus();
    });
});

elements.newChat.addEventListener("click", resetChat);
elements.mode.addEventListener("change", updateInputLimit);
elements.save.addEventListener("change", () => {
    if (!elements.save.checked) state.conversationId = null;
});

elements.logout.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "index.html";
});

setBusy(false);
updateInputLimit();

onAuthStateChanged(auth, async user => {
    if (!user) return;
    state.user = user;
    try {
        const [profile, statusResponse] = await Promise.all([
            getCurrentProfile(user),
            apiRequest("/api/deepsky/ai/status")
        ]);
        const status = await statusResponse.json();
        elements.loginLink.style.display = "none";
        elements.logout.style.display = "inline-flex";
        elements.userName.style.display = "inline";
        elements.userName.textContent = profile.name || user.displayName || "User";
        if (profile.role !== "admin") {
            elements.mode.querySelector('option[value="server"]')?.remove();
        }
        state.available = status.available;
        setUsage(status.used);
        if (!status.available) {
            addMessage("model", "서버 자체 AI가 시작되지 않았습니다. 관리자에게 알려 주세요.");
        }
        setBusy(false);
        await refreshConversations();
    } catch (error) {
        addMessage("model", error.message);
        setBusy(false);
    }
});
