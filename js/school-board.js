import { apiFetch, auth, authHeaders as getAuthHeaders, getCurrentProfile } from "./common.js";
import { initializeAnnouncementSection } from "./announcement-manager.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
const SCHOOLS = {
        b: { collection:"club-board", title:"DEEP SKY 동아리 게시판", boardTitle:"동아리 게시글", subtitle:"동아리 부원 전용 소통과 활동 기록 공간", student:"student", writeUrl:"school-write.html?school=b", viewUrl:"school-view.html?school=b", hero:"url('assets/images/stellar-nursery.webp')" }
    };

    const params = new URLSearchParams(location.search);
    const currentPage = location.pathname.split("/").pop() || "index.html";
    const schoolKey = params.get("school") || (currentPage === "talk.html" ? "b" : "");
    const school = SCHOOLS[schoolKey];
    if (!school) {
        location.replace("talk.html");
        throw new Error("Invalid school.");
    }

    document.documentElement.style.setProperty("--hero-image", school.hero);
    document.title = `DEEP SKY | ${school.boardTitle}`;
    document.getElementById("hero-title").textContent = school.title;
    document.getElementById("hero-subtitle").textContent = school.subtitle;
    document.getElementById("board-title").textContent = school.boardTitle;
    document.getElementById("write-btn").onclick = () => location.href = school.writeUrl;
let currentUser = null;
    let currentRole = "guest";
    let allPosts = [];

    const roleAllowed = (role) => ["admin", "teacher", school.student].includes(role);
    const canManage = (post) => currentUser && (post.uid === currentUser.uid || ["admin", "teacher"].includes(currentRole));
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));

    document.getElementById("logout-btn").addEventListener("click", async () => {
        if (confirm("로그아웃 하시겠습니까?")) {
            await signOut(auth);
            location.href = "index.html";
        }
    });

    onAuthStateChanged(auth, async (user) => {
        if (!user) { location.replace("block.html"); return; }
        try {
            const userData = await getCurrentProfile(user);
            const role = userData.role || "member";
            if (!roleAllowed(role)) { location.replace("block.html"); return; }
            currentUser = user;
            currentRole = role;
            document.getElementById("user-name").style.display = "inline";
            document.getElementById("user-name").textContent = `${userData.name || "사용자"}님`;
            document.getElementById("logout-btn").style.display = "inline";
            document.getElementById("login-link").style.display = "none";
            document.getElementById("write-btn").style.display = "inline";
            await Promise.all([
                loadPosts(),
                initializeAnnouncementSection({
                    section: document.getElementById("school-announcement-section"),
                    container: document.getElementById("school-announcement-list"),
                    user,
                    profile: userData,
                    scope: "all",
                    emptyMessage: "등록된 동아리 공지가 없습니다."
                })
            ]);
        } catch (err) {
            console.error(err);
            location.replace("block.html");
        }
    });

    async function authHeaders() {
        return getAuthHeaders(currentUser);
    }

    async function loadPosts() {
        try {
            const res = await apiFetch(`/api/deepsky/board/${school.collection}`, { headers: await authHeaders() });
            if (!res.ok) { location.replace("block.html"); return; }
            allPosts = await res.json();
            renderPosts();
        } catch (err) {
            document.getElementById("resource-list").innerHTML = '<div class="empty-msg">서버 연결에 실패했습니다.</div>';
        }
    }

    function renderPosts() {
        const keyword = document.getElementById("search-keyword").value.toLowerCase();
        const category = document.getElementById("filter-category").value;
        const filtered = allPosts.filter(p => (category === "all" || p.category === category) && ((p.title || "").toLowerCase().includes(keyword) || (p.author_name || "").toLowerCase().includes(keyword)));
        const listDiv = document.getElementById("resource-list");
        if (filtered.length === 0) {
            listDiv.innerHTML = '<div class="empty-msg">등록된 자료가 없습니다.</div>';
            return;
        }
        listDiv.replaceChildren();
        filtered.forEach(post => {
            const item = document.createElement("article");
            item.className = "resource-item";
            item.tabIndex = 0;
            item.setAttribute("role", "link");

            const openPost = () => {
                location.href = `${school.viewUrl}&id=${encodeURIComponent(String(post.id))}`;
            };
            item.addEventListener("click", openPost);
            item.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openPost();
                }
            });

            if (canManage(post)) {
                const deleteButton = document.createElement("button");
                deleteButton.type = "button";
                deleteButton.className = "btn-delete-left";
                deleteButton.textContent = "삭제";
                deleteButton.addEventListener("click", event => {
                    event.stopPropagation();
                    deletePost(post.id);
                });
                item.appendChild(deleteButton);
            }

            const content = document.createElement("div");
            content.className = "item-content";
            const title = document.createElement("span");
            title.className = "item-title";
            title.textContent = post.title || "제목 없음";
            const meta = document.createElement("div");
            meta.className = "item-meta";
            const tag = document.createElement("span");
            tag.className = "tag";
            tag.textContent = post.category || "기타";
            const author = document.createElement("span");
            author.textContent = post.author_name || "익명";
            const separator = document.createElement("span");
            separator.textContent = "|";
            const date = document.createElement("span");
            date.textContent = post.created_at ? new Date(post.created_at).toLocaleDateString() : "-";
            meta.append(tag, author, separator, date);
            content.append(title, meta);
            item.appendChild(content);
            listDiv.appendChild(item);
        });
    }

    async function deletePost(postId) {
        if (!confirm("이 자료를 삭제하시겠습니까?")) return;
        const res = await apiFetch(`/api/deepsky/board/${school.collection}/${encodeURIComponent(String(postId))}`, { method:"DELETE", headers: await authHeaders() });
        if (res.ok) await loadPosts();
        else alert("삭제 권한이 없거나 오류가 발생했습니다.");
    }

    document.getElementById("search-keyword").oninput = renderPosts;
    document.getElementById("filter-category").onchange = renderPosts;
