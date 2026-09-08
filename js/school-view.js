import { apiFetch, apiFetchUrl, auth, authHeaders as getAuthHeaders, getCurrentProfile, normalizeSafeLinkUrl } from "./common.js";
import { appendCommentReportButton, setupPostTools } from "./post-tools.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
const SCHOOLS = {
        b: { collection:"club-board", student:"student", boardUrl:"talk.html", writeUrl:"school-write.html?school=b" }
    };
    const params = new URLSearchParams(location.search);
    const school = SCHOOLS[params.get("school")];
    const postId = params.get("id");
    if (!school || !postId) {
        location.replace("talk.html");
        throw new Error("Invalid school or post id.");
    }
    const encodedPostId = encodeURIComponent(postId);
let currentUser = null;
    let currentRole = "guest";
    let currentUserName = "익명";
    let post = null;

    const roleAllowed = (role) => ["admin", "teacher", school.student].includes(role);
    const canManagePost = () => post && currentUser && (post.uid === currentUser.uid || ["admin", "teacher"].includes(currentRole));
    const headers = async () => getAuthHeaders(currentUser);
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
    const isFileAttachment = (link, href) => link?.type === "file" || href.includes("/api/deepsky/uploads/");

    document.getElementById("logout-btn").onclick = async () => { if (confirm("로그아웃 하시겠습니까?")) { await signOut(auth); location.href = "index.html"; } };
    document.getElementById("btn-list").onclick = () => location.href = school.boardUrl;
    document.getElementById("btn-edit").onclick = () => location.href = `${school.writeUrl}&id=${encodedPostId}`;
    document.getElementById("btn-delete").onclick = deletePost;
    document.getElementById("comment-submit").onclick = createComment;

    onAuthStateChanged(auth, async (user) => {
        if (!user) { location.replace("block.html"); return; }
        try {
            const data = await getCurrentProfile(user);
            const role = data.role || "member";
            if (!roleAllowed(role)) { location.replace("block.html"); return; }
            currentUser = user;
            currentRole = role;
            currentUserName = data.name || "익명";
            document.getElementById("user-name").style.display = "inline";
            document.getElementById("user-name").textContent = `${currentUserName}님`;
            document.getElementById("logout-btn").style.display = "inline";
            document.getElementById("login-link").style.display = "none";
            await loadPost();
            await loadComments();
        } catch (err) {
            console.error(err);
            location.replace("block.html");
        }
    });

    async function loadPost() {
        const res = await apiFetch(`/api/deepsky/board/${school.collection}/${encodedPostId}`, { headers: await headers() });
        if (!res.ok) { location.replace("block.html"); return; }
        post = await res.json();
        document.title = `DEEP SKY | ${post.title || "게시글"}`;
        document.getElementById("post-category").textContent = post.category || "기타";
        document.getElementById("post-author").textContent = post.author_name || "익명";
        document.getElementById("post-date").textContent = post.created_at ? new Date(post.created_at).toLocaleString() : "-";
        document.getElementById("post-title").textContent = post.title || "제목 없음";
        document.getElementById("post-content").textContent = post.content || "";
        const linksEl = document.getElementById("post-links");
        linksEl.innerHTML = "";
        (post.links || []).forEach((link, index) => {
            const href = normalizeSafeLinkUrl(link.url, { allowUpload: true, resolveUpload: true });
            if (!href) return;
            const isFile = isFileAttachment(link, href);
            if (isFile) {
                const name = link.name || `첨부파일 ${index + 1}`;
                const item = document.createElement("div");
                item.className = "attachment-item";
                const nameEl = document.createElement("span");
                nameEl.className = "attachment-name";
                nameEl.textContent = name;
                const actions = document.createElement("div");
                actions.className = "attachment-actions";
                const previewBtn = document.createElement("button");
                previewBtn.type = "button";
                previewBtn.className = "btn-small";
                previewBtn.textContent = "미리보기";
                previewBtn.onclick = () => openAttachment(href, name, "preview");
                const downloadBtn = document.createElement("button");
                downloadBtn.type = "button";
                downloadBtn.className = "btn-small";
                downloadBtn.textContent = "다운로드";
                downloadBtn.onclick = () => openAttachment(href, name, "download");
                actions.append(previewBtn, downloadBtn);
                item.append(nameEl, actions);
                linksEl.appendChild(item);
                return;
            }
            const a = document.createElement("a");
            a.href = href;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = link.name || href;
            linksEl.appendChild(a);
        });
        document.getElementById("btn-edit").classList.toggle("hidden", !canManagePost());
        document.getElementById("btn-delete").classList.toggle("hidden", !canManagePost());
        await setupPostTools({
            user: currentUser,
            collection: school.collection,
            postId,
            bookmarkButton: document.getElementById("btn-bookmark"),
            reportButton: document.getElementById("btn-report")
        });
    }

    async function loadComments() {
        const res = await apiFetch(`/api/deepsky/board/${school.collection}/${encodedPostId}/comments`, { headers: await headers() });
        const list = document.getElementById("comment-list");
        if (!res.ok) { list.innerHTML = ""; return; }
        const comments = await res.json();
        if (comments.length === 0) { list.innerHTML = '<p style="color:#777; text-align:center;">첫 댓글을 남겨보세요.</p>'; return; }
        list.replaceChildren();
        comments.forEach(comment => {
            const item = document.createElement("div");
            item.className = "comment";
            item.id = `comment-${comment.id}`;
            const meta = document.createElement("div");
            meta.className = "comment-meta";
            const author = document.createElement("strong");
            author.textContent = comment.author_name || "익명";
            const date = document.createElement("span");
            date.textContent = comment.created_at ? new Date(comment.created_at).toLocaleString() : "";
            meta.append(author, date);

            const canDelete = comment.uid === currentUser.uid || canManagePost();
            if (canDelete) {
                const deleteButton = document.createElement("button");
                deleteButton.type = "button";
                deleteButton.className = "btn-small btn-danger";
                deleteButton.textContent = "삭제";
                deleteButton.addEventListener("click", () => deleteComment(comment.id));
                meta.appendChild(deleteButton);
            }
            appendCommentReportButton(meta, {
                user: currentUser,
                collection: school.collection,
                commentId: comment.id
            });

            const content = document.createElement("div");
            content.textContent = comment.content || "";
            item.append(meta, content);
            list.appendChild(item);
        });
        const targetComment = location.hash ? document.getElementById(location.hash.slice(1)) : null;
        if (targetComment) requestAnimationFrame(() => targetComment.scrollIntoView({ block: "center" }));
    }

    function withDownloadParam(url) {
        const downloadUrl = new URL(url);
        downloadUrl.searchParams.set("download", "1");
        return downloadUrl.href;
    }

    function getPreviewMimeType(filename, contentType) {
        const type = String(contentType || "").split(";")[0].trim().toLowerCase();
        const ext = String(filename || "").split(".").pop().toLowerCase();
        const byExt = {
            pdf: "application/pdf",
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            txt: "text/plain",
            csv: "text/csv",
            md: "text/plain",
            json: "application/json",
            mp3: "audio/mpeg",
            wav: "audio/wav",
            mp4: "video/mp4",
            webm: "video/webm"
        };
        const allowedTypes = new Set(Object.values(byExt));
        if (allowedTypes.has(type)) return type;
        return byExt[ext] || "";
    }

    async function openAttachment(url, filename, mode = "preview") {
        let previewWindow = null;
        try {
            if (!currentUser) throw new Error("로그인이 필요합니다.");
            if (mode === "preview") {
                previewWindow = window.open("about:blank", "_blank");
                if (!previewWindow) throw new Error("팝업이 차단되어 미리보기를 열 수 없습니다.");
                previewWindow.opener = null;
                previewWindow.document.title = "파일 미리보기";
                previewWindow.document.body.textContent = "파일을 불러오는 중입니다...";
            }
            const requestUrl = mode === "download" ? withDownloadParam(url) : url;
            const res = await apiFetchUrl(requestUrl, { headers: await headers() });
            if (!res.ok) throw new Error("파일을 열 수 없습니다.");
            const blob = await res.blob();
            if (mode === "download") {
                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = objectUrl;
                a.download = filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
                return;
            }
            const previewType = getPreviewMimeType(filename, blob.type);
            if (!previewType) throw new Error("이 파일 형식은 미리보기를 지원하지 않습니다. 다운로드 버튼을 사용해 주세요.");
            const previewBlob = blob.type === previewType ? blob : new Blob([blob], { type: previewType });
            const objectUrl = URL.createObjectURL(previewBlob);
            previewWindow.location.href = objectUrl;
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        } catch (err) {
            if (previewWindow && !previewWindow.closed) previewWindow.close();
            alert(err.message || "파일을 열 수 없습니다.");
        }
    }

    async function createComment() {
        const input = document.getElementById("comment-input");
        const content = input.value.trim();
        if (!content) return;
        const res = await apiFetch(`/api/deepsky/board/${school.collection}/${encodedPostId}/comments`, { method:"POST", headers:{ ...(await headers()), "Content-Type":"application/json" }, body:JSON.stringify({ content, authorName:currentUserName }) });
        if (res.ok) { input.value = ""; await loadComments(); }
        else alert("댓글 등록 권한이 없거나 오류가 발생했습니다.");
    }

    async function deleteComment(commentId) {
        if (!confirm("댓글을 삭제하시겠습니까?")) return;
        const res = await apiFetch(`/api/deepsky/board/${school.collection}/${encodedPostId}/comments/${encodeURIComponent(String(commentId))}`, { method:"DELETE", headers: await headers() });
        if (res.ok) await loadComments();
        else alert("댓글 삭제 권한이 없거나 오류가 발생했습니다.");
    }

    async function deletePost() {
        if (!confirm("게시글을 삭제하시겠습니까?")) return;
        const res = await apiFetch(`/api/deepsky/board/${school.collection}/${encodedPostId}`, { method:"DELETE", headers: await headers() });
        if (res.ok) location.href = school.boardUrl;
        else alert("삭제 권한이 없거나 오류가 발생했습니다.");
    }
