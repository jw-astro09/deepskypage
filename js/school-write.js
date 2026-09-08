import { apiFetch, auth, authHeaders as getAuthHeaders, getCurrentProfile, normalizeSafeLinkUrl } from "./common.js";
import { createDraftController, uploadFilesWithProgress } from "./write-tools.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
const SCHOOLS = {
        b: { collection:"club-board", name:"DEEP SKY", student:"student", boardUrl:"talk.html", viewUrl:"school-view.html?school=b" }
    };
    const params = new URLSearchParams(location.search);
    const school = SCHOOLS[params.get("school")];
    const editId = params.get("id");
    if (!school) {
        location.replace("talk.html");
        throw new Error("Invalid school.");
    }
let currentUser = null;
    let currentRole = "guest";
    let currentUserName = "익명";
    let editPost = null;
    let draftController = null;

    document.getElementById("form-title").textContent = editId ? `${school.name} 자료 수정` : `${school.name} 자료 등록`;
    document.getElementById("submit-btn").textContent = editId ? "수정 완료" : "등록";
    document.getElementById("cancel-btn").onclick = () => location.href = editId ? `${school.viewUrl}&id=${editId}` : school.boardUrl;
    document.getElementById("add-link").onclick = () => addLinkField();
    document.getElementById("submit-btn").onclick = submitPost;
    addLinkField();

    const roleAllowed = (role) => ["admin", "teacher", school.student].includes(role);
    const canEditPost = () => editPost && currentUser && (editPost.uid === currentUser.uid || ["admin", "teacher"].includes(currentRole));
    const authHeaders = async () => getAuthHeaders(currentUser);
    document.getElementById("logout-btn").onclick = async () => { if (confirm("로그아웃 하시겠습니까?")) { await signOut(auth); location.href = "index.html"; } };

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
            if (editId) await loadEditData();
            setupDraft();
        } catch (err) {
            console.error(err);
            location.replace("block.html");
        }
    });

    function addLinkField(url = "", name = "") {
        const row = document.createElement("div");
        row.className = "link-row";
        const nameInput = document.createElement("input");
        nameInput.className = "link-name";
        nameInput.type = "text";
        nameInput.placeholder = "링크 이름";
        nameInput.setAttribute("aria-label", "공유 링크 이름");
        nameInput.value = name;
        const urlInput = document.createElement("input");
        urlInput.className = "link-url";
        urlInput.type = "url";
        urlInput.placeholder = "https://...";
        urlInput.setAttribute("aria-label", "공유 링크 주소");
        urlInput.value = url;
        const removeButton = document.createElement("button");
        removeButton.className = "btn";
        removeButton.type = "button";
        removeButton.textContent = "삭제";
        removeButton.onclick = () => row.remove();
        row.append(nameInput, urlInput, removeButton);
        document.getElementById("link-container").appendChild(row);
    }

    async function uploadSelectedFiles() {
        const files = Array.from(document.getElementById("file-input")?.files || []);
        return uploadFilesWithProgress({
            files,
            user: currentUser,
            collection: school.collection,
            progressWrap: document.getElementById("upload-progress-wrap"),
            progressElement: document.getElementById("upload-progress"),
            statusElement: document.getElementById("upload-status"),
            cancelButton: document.getElementById("cancel-upload")
        });
    }

    function setupDraft() {
        draftController = createDraftController({
            key: `deepsky-draft:${school.collection}:${editId || "new"}`,
            root: document.querySelector(".editor"),
            statusElement: document.getElementById("draft-status"),
            clearButton: document.getElementById("clear-draft"),
            collect: () => ({
                title: document.getElementById("post-title").value,
                content: document.getElementById("post-content").value,
                category: document.getElementById("category").value,
                links: [...document.querySelectorAll(".link-row")].map(row => ({
                    name: row.querySelector(".link-name").value,
                    url: row.querySelector(".link-url").value
                }))
            }),
            restore: draft => {
                document.getElementById("post-title").value = draft.title || "";
                document.getElementById("post-content").value = draft.content || "";
                document.getElementById("category").value = draft.category || "기타";
                document.getElementById("link-container").innerHTML = "";
                (draft.links?.length ? draft.links : [{}]).forEach(link => addLinkField(link.url || "", link.name || ""));
            }
        });
    }

    async function loadEditData() {
        const res = await apiFetch(`/api/deepsky/board/${school.collection}/${editId}`, { headers: await authHeaders() });
        if (!res.ok) { location.replace("block.html"); return; }
        editPost = await res.json();
        if (!canEditPost()) { location.replace("block.html"); return; }
        document.getElementById("category").value = editPost.category || "기타";
        document.getElementById("post-title").value = editPost.title || "";
        document.getElementById("post-content").value = editPost.content || "";
        document.getElementById("link-container").innerHTML = "";
        const links = editPost.links && editPost.links.length ? editPost.links : [{}];
        links.forEach(link => addLinkField(link.url || "", link.name || ""));
    }

    async function submitPost() {
        const title = document.getElementById("post-title").value.trim();
        const content = document.getElementById("post-content").value.trim();
        if (!title || !content) { alert("제목과 내용을 입력해주세요."); return; }
        const linkEntries = [...document.querySelectorAll(".link-row")].map(row => {
            const rawUrl = row.querySelector(".link-url").value.trim();
            const url = normalizeSafeLinkUrl(rawUrl, { allowUpload: true });
            return { name:row.querySelector(".link-name").value.trim(), url, invalid:Boolean(rawUrl && !url), type:url.startsWith("/api/deepsky/uploads/") ? "file" : "link" };
        });
        if (linkEntries.some(link => link.invalid)) {
            alert("첨부 링크는 인증 정보가 없는 http 또는 https 주소만 사용할 수 있습니다.");
            return;
        }
        const links = linkEntries.filter(link => link.url);
        links.forEach(link => delete link.invalid);
        const submitBtn = document.getElementById("submit-btn");
        submitBtn.disabled = true;
        submitBtn.textContent = "저장 중...";
        try {
            const uploadedFiles = await uploadSelectedFiles();
            links.push(...uploadedFiles);
            const payload = { title, content, category:document.getElementById("category").value, links, authorName:currentUserName };
            const path = editId ? `/api/deepsky/board/${school.collection}/${editId}` : `/api/deepsky/board/${school.collection}`;
            const res = await apiFetch(path, { method: editId ? "PUT" : "POST", headers:{ ...(await authHeaders()), "Content-Type":"application/json" }, body:JSON.stringify(payload) });
            if (!res.ok) { throw new Error("저장 권한이 없거나 오류가 발생했습니다."); }
            draftController?.clear();
            if (editId) location.href = `${school.viewUrl}&id=${editId}`;
            else {
                const data = await res.json();
                location.href = `${school.viewUrl}&id=${data.id}`;
            }
        } catch (err) {
            alert(err.message || "저장 중 오류가 발생했습니다.");
            submitBtn.disabled = false;
            submitBtn.textContent = editId ? "수정 완료" : "등록";
        }
    }
