import { apiFetch, auth, authHeaders, getCurrentProfile, normalizeSafeLinkUrl } from "./common.js";
import { createDraftController, uploadFilesWithProgress } from "./write-tools.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
const COLLECTION = "resources";
const WRITABLE_ROLES = ['teacher', 'admin'];
const editPostId = new URLSearchParams(window.location.search).get('id');
    let currentUser = null;
    let currentRole = 'guest';
    let currentUserName = '익명';
    let draftController = null;

    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.addEventListener('click', async () => { if (confirm('로그아웃 하시겠습니까?')) { await signOut(auth); location.replace('index.html'); } });
    document.getElementById('btnAddLink').addEventListener('click', () => addLinkField());

    onAuthStateChanged(auth, async (user) => {
        if (!user) { alert('로그인이 필요합니다.'); location.replace('login.html'); return; }
        try {
            const userData = await getCurrentProfile(user);
            currentRole = userData.role || 'member';
            if (!WRITABLE_ROLES.includes(currentRole)) { alert('작성 권한이 없습니다. 교사 또는 관리자만 작성할 수 있습니다.'); location.replace('resource.html'); return; }
            currentUser = user;
            currentUserName = userData.name || user.displayName || '사용자';
            document.getElementById('user-name').style.display = 'inline';
            document.getElementById('user-name').innerText = `${currentUserName}님`;
            logoutBtn.style.display = 'inline';
            if (editPostId) await loadEditData();
            setupDraft();
        } catch (error) {
            console.error(error);
            alert('권한 확인 중 오류가 발생했습니다.');
            location.replace('resource.html');
        }
    });

    async function getHeaders(contentType = false) {
        const headers = await authHeaders(currentUser);
        if (contentType) headers['Content-Type'] = 'application/json';
        return headers;
    }

    async function loadEditData() {
        document.getElementById('formTitle').innerText = '자료 수정하기';
        document.getElementById('submitBtn').innerText = '수정 완료';
        const res = await apiFetch(`/api/deepsky/board/${COLLECTION}/${encodeURIComponent(editPostId)}`, { headers: await getHeaders() });
        if (!res.ok) { alert('자료를 찾을 수 없습니다.'); location.replace('resource.html'); return; }
        const data = await res.json();
        const canEdit = data.uid === currentUser.uid || WRITABLE_ROLES.includes(currentRole);
        if (!canEdit) { alert('수정 권한이 없습니다.'); location.replace('resource.html'); return; }
        document.getElementById('postTitle').value = data.title || '';
        document.getElementById('postContent').value = data.content || data.description || '';
        document.getElementById('category').value = data.category || '천체 관측 데이터';
        if (data.links && data.links.length > 0) {
            document.getElementById('linkContainer').innerHTML = '';
            data.links.forEach(link => addLinkField(link.url, link.name));
        }
    }

    async function submitPost() {
        const title = document.getElementById('postTitle').value.trim();
        const content = document.getElementById('postContent').value.trim();
        const category = document.getElementById('category').value;
        if (!title || !content) { alert('제목과 내용을 입력해주세요.'); return; }
        const links = Array.from(document.querySelectorAll('.postFileUrl')).map((input, index) => {
            let rawUrl = input.value.trim();
            if (!rawUrl) return null;
            if (!/^[a-z][a-z\d+.-]*:/i.test(rawUrl) && !rawUrl.startsWith('/')) rawUrl = 'https://' + rawUrl;
            const url = normalizeSafeLinkUrl(rawUrl, { allowUpload: true });
            if (!url) return { invalid: true };
            const name = document.querySelectorAll('.postFileName')[index].value.trim() || '첨부 링크';
            return { url, name, type: url.startsWith('/api/deepsky/uploads/') ? 'file' : 'link' };
        }).filter(Boolean);
        if (links.some(link => link.invalid)) { alert('첨부 링크는 인증 정보가 없는 http/https 주소만 사용할 수 있습니다.'); return; }
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.disabled = true;
        submitBtn.innerText = '처리 중...';
        try {
            const uploadedFiles = await uploadSelectedFiles();
            links.push(...uploadedFiles);
            const path = editPostId ? `/api/deepsky/board/${COLLECTION}/${encodeURIComponent(editPostId)}` : `/api/deepsky/board/${COLLECTION}`;
            const res = await apiFetch(path, { method: editPostId ? 'PUT' : 'POST', headers: await getHeaders(true), body: JSON.stringify({ title, content, category, links, authorName: currentUserName }) });
            if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || '저장 실패'); }
            draftController?.clear();
            alert(editPostId ? '수정되었습니다.' : '등록되었습니다.');
            location.replace('resource.html');
        } catch (err) {
            alert('저장 실패: ' + err.message);
            submitBtn.disabled = false;
            submitBtn.innerText = editPostId ? '수정 완료' : '자료 등록하기';
        }
    }

    async function uploadSelectedFiles() {
        const files = Array.from(document.getElementById('fileInput')?.files || []);
        return uploadFilesWithProgress({
            files,
            user: currentUser,
            collection: COLLECTION,
            progressWrap: document.getElementById('uploadProgressWrap'),
            progressElement: document.getElementById('uploadProgress'),
            statusElement: document.getElementById('uploadStatus'),
            cancelButton: document.getElementById('cancelUploadBtn')
        });
    }

    function setupDraft() {
        draftController = createDraftController({
            key: `deepsky-draft:${COLLECTION}:${editPostId || 'new'}`,
            root: document.querySelector('.write-card'),
            statusElement: document.getElementById('draftStatus'),
            clearButton: document.getElementById('clearDraftBtn'),
            collect: () => ({
                title: document.getElementById('postTitle').value,
                content: document.getElementById('postContent').value,
                category: document.getElementById('category').value,
                links: Array.from(document.querySelectorAll('.postFileUrl')).map((input, index) => ({
                    url: input.value,
                    name: document.querySelectorAll('.postFileName')[index].value
                }))
            }),
            restore: draft => {
                document.getElementById('postTitle').value = draft.title || '';
                document.getElementById('postContent').value = draft.content || '';
                document.getElementById('category').value = draft.category || '천체 관측 데이터';
                document.getElementById('linkContainer').innerHTML = '';
                (draft.links?.length ? draft.links : [{}]).forEach(link => addLinkField(link.url || '', link.name || ''));
            }
        });
    }

    function addLinkField(url = '', name = '') {
        const div = document.createElement('div');
        div.className = 'link-item';
        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.className = 'postFileUrl';
        urlInput.value = url;
        urlInput.placeholder = '링크 주소 (https://...)';
        urlInput.setAttribute('aria-label', '공유 링크 주소');
        urlInput.style.cssText = 'flex:2; margin-bottom:0;';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'postFileName';
        nameInput.value = name;
        nameInput.placeholder = '이름';
        nameInput.setAttribute('aria-label', '공유 링크 이름');
        nameInput.style.cssText = 'flex:1; margin-bottom:0;';
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn-remove-link';
        removeButton.textContent = '-';
        removeButton.setAttribute('aria-label', '공유 링크 삭제');
        removeButton.style.cssText = 'width:40px; background:#ff4d4d; color:white; border:none; border-radius:5px; cursor:pointer;';
        div.append(urlInput, nameInput, removeButton);
        document.getElementById('linkContainer').appendChild(div);
        removeButton.onclick = () => div.remove();
    }
    document.getElementById('submitBtn').addEventListener('click', submitPost);
