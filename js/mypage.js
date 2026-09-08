import { apiFetch, apiRequest, auth, authHeaders, getCurrentProfile, updateCurrentProfile } from "./common.js";
import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, sendPasswordResetEmail, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let currentUser = null;
let currentProfile = null;
const roleMap = {
    admin: "관리자", teacher: "교사",
    student: "동아리 부원", member: "일반 회원"
};

async function logout() {
    await signOut(auth);
    location.href = "index.html";
}

document.getElementById("card-logout-btn").onclick = document.getElementById("logout-btn").onclick = logout;

onAuthStateChanged(auth, async user => {
    if (!user) {
        location.href = "login.html";
        return;
    }
    try {
        currentUser = user;
        currentProfile = await getCurrentProfile(user);
        document.getElementById("login-link").style.display = "none";
        document.getElementById("logout-btn").style.display = "inline";
        document.getElementById("user-name").style.display = "inline";
        document.getElementById("user-name").textContent = currentProfile.name || "User";
        document.getElementById("display-email").value = currentProfile.email || user.email || "";
        document.getElementById("edit-name").value = currentProfile.name || "";
        document.getElementById("display-role").value = roleMap[currentProfile.role] || currentProfile.role;
        configurePasswordManagement(user);
        await Promise.all([loadBookmarks(), loadRecentViews()]);
    } catch (error) {
        console.error(error);
        location.replace("block.html");
    }
});

document.getElementById("update-profile-btn").onclick = async () => {
    const name = document.getElementById("edit-name").value.trim();
    if (!name) return alert("이름을 입력해 주세요.");
    try {
        await updateCurrentProfile({ name, school: currentProfile?.school || "" }, currentUser);
        alert("프로필이 수정되었습니다.");
        location.reload();
    } catch (error) {
        alert(error.message);
    }
};

function configurePasswordManagement(user) {
    const form = document.getElementById("password-change-form");
    const note = document.getElementById("password-account-note");
    const hasPasswordProvider = user.providerData.some(provider => provider.providerId === "password");
    form.hidden = !hasPasswordProvider;
    note.textContent = hasPasswordProvider
        ? "현재 비밀번호로 본인 확인 후 새 비밀번호를 설정할 수 있습니다. 비밀번호는 Firebase Authentication에서 처리됩니다."
        : "Google 로그인 계정의 비밀번호는 Google 계정 보안 설정에서 관리하세요.";
}

document.getElementById("password-change-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser?.email) return setPasswordStatus("로그인 계정의 이메일을 확인할 수 없습니다.", true);

    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;
    if (newPassword.length < 8) return setPasswordStatus("새 비밀번호는 8자 이상이어야 합니다.", true);
    if (newPassword !== confirmPassword) return setPasswordStatus("새 비밀번호가 서로 일치하지 않습니다.", true);
    if (currentPassword === newPassword) return setPasswordStatus("현재 비밀번호와 다른 비밀번호를 입력해 주세요.", true);

    const button = document.getElementById("change-password-btn");
    button.disabled = true;
    button.textContent = "변경 중...";
    setPasswordStatus("현재 비밀번호를 확인하는 중입니다.");
    try {
        const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
        await reauthenticateWithCredential(currentUser, credential);
        await updatePassword(currentUser, newPassword);
        event.currentTarget.reset();
        setPasswordStatus("비밀번호가 변경되었습니다.");
    } catch (error) {
        setPasswordStatus(passwordErrorMessage(error), true);
    } finally {
        button.disabled = false;
        button.textContent = "비밀번호 변경";
    }
});

document.getElementById("send-reset-email-btn").addEventListener("click", async () => {
    if (!currentUser?.email) return setPasswordStatus("로그인 계정의 이메일을 확인할 수 없습니다.", true);
    const button = document.getElementById("send-reset-email-btn");
    button.disabled = true;
    button.textContent = "전송 중...";
    try {
        await sendPasswordResetEmail(auth, currentUser.email);
        setPasswordStatus("비밀번호 재설정 메일을 보냈습니다. 받은편지함과 스팸함을 확인하세요.");
    } catch (error) {
        setPasswordStatus(passwordErrorMessage(error), true);
    } finally {
        button.disabled = false;
        button.textContent = "재설정 메일 보내기";
    }
});

function setPasswordStatus(message, isError = false) {
    const status = document.getElementById("password-status");
    status.textContent = message;
    status.dataset.state = isError ? "error" : "success";
}

function passwordErrorMessage(error) {
    const code = error?.code || "";
    if (["auth/wrong-password", "auth/invalid-credential"].includes(code)) return "현재 비밀번호가 올바르지 않습니다.";
    if (code === "auth/weak-password") return "새 비밀번호가 보안 기준을 충족하지 않습니다.";
    if (code === "auth/requires-recent-login") return "보안을 위해 로그아웃한 뒤 다시 로그인하고 시도해 주세요.";
    if (code === "auth/too-many-requests") return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    if (code === "auth/network-request-failed") return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
    return "비밀번호 처리 중 오류가 발생했습니다.";
}

async function loadBookmarks() {
    const list = document.getElementById("bookmark-list");
    try {
        const response = await apiRequest("/api/deepsky/bookmarks", {}, currentUser);
        renderPostList(list, await response.json(), "저장한 글이 없습니다.", true);
    } catch (error) {
        list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
}

async function loadRecentViews() {
    const list = document.getElementById("recent-list");
    try {
        const response = await apiRequest("/api/deepsky/recent-views", {}, currentUser);
        renderPostList(list, await response.json(), "최근 본 글이 없습니다.", false);
    } catch (error) {
        list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
}

function renderPostList(container, items, emptyMessage, removable) {
    container.innerHTML = "";
    if (!items.length) {
        container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
        return;
    }
    items.forEach(item => {
        const article = document.createElement("article");
        article.className = "feature-item";
        const header = document.createElement("div");
        header.className = "list-item-header";
        const link = document.createElement("a");
        link.href = item.link;
        const title = document.createElement("h3");
        title.textContent = item.title || "제목 없음";
        link.appendChild(title);
        header.appendChild(link);
        if (removable) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn";
            remove.textContent = "삭제";
            remove.addEventListener("click", async () => {
                await apiRequest(`/api/deepsky/bookmarks/${item.collection_name}/${item.id}`, {
                    method: "DELETE"
                }, currentUser);
                await loadBookmarks();
            });
            header.appendChild(remove);
        }
        const meta = document.createElement("div");
        meta.className = "item-meta";
        meta.textContent = `${collectionLabel(item.collection_name)} · ${item.category || "기타"} · ${formatDate(item.bookmarked_at || item.viewed_at)}`;
        article.append(header, meta);
        container.appendChild(article);
    });
}

function collectionLabel(value) {
    return { resources: "공용 자료", "club-board": "동아리 게시판" }[value] || value;
}

function formatDate(value) {
    return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

function escapeHtml(value) {
    return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

document.getElementById("delete-account-btn").onclick = async () => {
    if (!currentUser) return alert("로그인이 필요합니다.");
    if (document.getElementById("delete-confirm-input").value.trim() !== "회원탈퇴") {
        return alert("확인 문구를 정확히 입력해 주세요.");
    }
    if (!confirm("정말 탈퇴하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;

    const button = document.getElementById("delete-account-btn");
    button.disabled = true;
    button.textContent = "처리 중...";
    try {
        const response = await apiFetch("/api/deepsky/account", {
            method: "DELETE",
            headers: await authHeaders(currentUser)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "회원탈퇴에 실패했습니다.");
        await signOut(auth).catch(() => {});
        alert("회원탈퇴가 완료되었습니다.");
        location.replace("index.html");
    } catch (error) {
        alert(error.message || "회원탈퇴에 실패했습니다.");
        button.disabled = false;
        button.textContent = "회원탈퇴";
    }
};
