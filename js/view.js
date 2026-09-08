import { apiFetch, apiFetchUrl, auth, authHeaders, getCurrentProfile, normalizeSafeLinkUrl } from "./common.js";
import { appendCommentReportButton, setupPostTools } from "./post-tools.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
const COLLECTION = "resources";
const postId = new URLSearchParams(window.location.search).get('id');
const encodedPostId = postId ? encodeURIComponent(postId) : '';
let currentUser = null;
    let currentRole = 'guest';
    let currentUserName = '익명';
    let postData = null;

    if (!postId) location.replace('block.html');
    document.getElementById('logoutBtn').addEventListener('click', async () => { if (confirm('로그아웃 하시겠습니까?')) { await signOut(auth); location.reload(); } });

    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (!user) {
            setAuthUi(false);
            currentRole = 'guest';
            await loadPost();
            await loadComments();
            return;
        }
        try {
            const userData = await getCurrentProfile(user);
            currentRole = userData.role || 'member';
            currentUserName = userData.name || user.displayName || '사용자';
            setAuthUi(true);
            await loadPost();
            await loadComments();
        } catch (err) {
            console.error(err);
            currentRole = 'member';
            setAuthUi(true);
            await loadPost();
            await loadComments();
        }
    });

    function setAuthUi(isLoggedIn) {
        document.getElementById('loginBtn').classList.toggle('hidden', isLoggedIn);
        document.getElementById('logoutBtn').classList.toggle('hidden', !isLoggedIn);
        document.getElementById('userNameDisplay').classList.toggle('hidden', !isLoggedIn);
        document.getElementById('commentFormArea').classList.toggle('hidden', !isLoggedIn);
        document.getElementById('loginNotice').classList.toggle('hidden', isLoggedIn);
        if (isLoggedIn) document.getElementById('userNameDisplay').innerText = `${currentUserName}님`;
    }

    async function getHeaders(contentType = false) {
        const headers = currentUser ? await authHeaders(currentUser) : { 'ngrok-skip-browser-warning': '69420' };
        if (contentType) headers['Content-Type'] = 'application/json';
        return headers;
    }

    function isFileAttachment(link, href) {
        return link?.type === 'file' || href.includes('/api/deepsky/uploads/');
    }

    async function loadPost() {
        const res = await apiFetch(`/api/deepsky/board/${COLLECTION}/${encodedPostId}`, { headers: await getHeaders() });
        if (!res.ok) { alert('자료를 찾을 수 없습니다.'); location.replace('resource.html'); return; }
        postData = await res.json();
        document.getElementById('viewTitle').innerText = postData.title || '제목 없음';
        document.getElementById('viewAuthor').innerText = `BY. ${postData.author_name || postData.author || '익명'}`;
        document.getElementById('viewCategory').innerText = postData.category || 'RESOURCE';
        document.getElementById('viewDate').innerText = formatDate(postData.created_at || postData.createdAt);
        document.getElementById('viewContent').innerText = postData.content || postData.description || '';
        const linksDiv = document.getElementById('linksContainer');
        linksDiv.innerHTML = '';
        (postData.links || []).forEach((link, index) => {
            const href = normalizeSafeLinkUrl(link.url, { allowUpload: true, resolveUpload: true });
            if (!href) return;
            const isFile = isFileAttachment(link, href);
            if (isFile) {
                const name = link.name || `첨부파일 ${index + 1}`;
                const item = document.createElement('div');
                item.className = 'attachment-item';
                const nameEl = document.createElement('span');
                nameEl.className = 'attachment-name';
                nameEl.textContent = name;
                const actions = document.createElement('div');
                actions.className = 'attachment-actions';
                const previewBtn = document.createElement('button');
                previewBtn.type = 'button';
                previewBtn.className = 'btn-small';
                previewBtn.textContent = '미리보기';
                previewBtn.onclick = () => openAttachment(href, name, 'preview');
                const downloadBtn = document.createElement('button');
                downloadBtn.type = 'button';
                downloadBtn.className = 'btn-small';
                downloadBtn.textContent = '다운로드';
                downloadBtn.onclick = () => openAttachment(href, name, 'download');
                actions.append(previewBtn, downloadBtn);
                item.append(nameEl, actions);
                linksDiv.appendChild(item);
                return;
            }
            const a = document.createElement('a');
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'link-item';
            a.innerHTML = `<span>${escapeHtml(link.name || '첨부 링크')}</span><span style="font-size:12px; opacity:.6;">새 창에서 열기</span>`;
            linksDiv.appendChild(a);
        });
        const isOwner = currentUser && postData.uid === currentUser.uid;
        const canManage = isOwner || ['admin', 'teacher'].includes(currentRole);
        document.getElementById('btnEditPost').classList.toggle('hidden', !isOwner && !['admin', 'teacher'].includes(currentRole));
        document.getElementById('btnDeletePost').classList.toggle('hidden', !canManage);
        await setupPostTools({
            user: currentUser,
            collection: COLLECTION,
            postId,
            bookmarkButton: document.getElementById('btnBookmarkPost'),
            reportButton: document.getElementById('btnReportPost')
        });
    }

    async function loadComments() {
        const res = await apiFetch(`/api/deepsky/board/${COLLECTION}/${encodedPostId}/comments`, { headers: await getHeaders() });
        if (!res.ok) return;
        const comments = await res.json();
        const list = document.getElementById('commentList');
        list.innerHTML = '';
        if (!comments.length) { list.innerHTML = '<div style="text-align:center; color:#555; padding:20px;">등록된 댓글이 없습니다.</div>'; return; }
        comments.forEach(c => {
            const isCommentOwner = currentUser && c.uid === currentUser.uid;
            const isPostOwner = currentUser && postData && postData.uid === currentUser.uid;
            const canDelete = isCommentOwner || isPostOwner || ['admin', 'teacher'].includes(currentRole);
            const item = document.createElement('div');
            item.className = 'comment-item';
            item.id = `comment-${c.id}`;
            if (isCommentOwner) item.style.border = '1px solid var(--accent)';
            const meta = document.createElement('div');
            meta.className = 'comment-meta';
            const author = document.createElement('span');
            author.className = 'comment-author';
            author.textContent = c.author_name || c.author || '익명';
            const date = document.createElement('span');
            date.textContent = formatDate(c.created_at || c.createdAt);
            meta.append(author, date);

            const content = document.createElement('div');
            content.textContent = c.content || '';
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:10px;';
            if (canDelete) {
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'btn-small';
                deleteButton.style.cssText = 'color:#ff4d4d; border-color:#ff4d4d;';
                deleteButton.textContent = '삭제';
                deleteButton.addEventListener('click', () => deleteComment(c.id));
                actions.appendChild(deleteButton);
            }
            appendCommentReportButton(actions, {
                user: currentUser,
                collection: COLLECTION,
                commentId: c.id
            });
            item.append(meta, content, actions);
            list.appendChild(item);
        });
        const targetComment = location.hash ? document.getElementById(location.hash.slice(1)) : null;
        if (targetComment) requestAnimationFrame(() => targetComment.scrollIntoView({ block: 'center' }));
    }

    document.getElementById('btnPostComment').addEventListener('click', async () => {
        const input = document.getElementById('commentInput');
        const content = input.value.trim();
        if (!content || !currentUser) return;
        const btn = document.getElementById('btnPostComment');
        btn.disabled = true;
        btn.innerText = 'SENDING...';
        try {
            const res = await apiFetch(`/api/deepsky/board/${COLLECTION}/${encodedPostId}/comments`, { method:'POST', headers: await getHeaders(true), body: JSON.stringify({ content, authorName: currentUserName }) });
            if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || '댓글 작성 실패'); }
            input.value = '';
            await loadComments();
        } catch (err) { alert(err.message); }
        finally { btn.disabled = false; btn.innerText = 'POST'; }
    });

    async function resolveAttachmentUrl(url, filename, mode) {
        const attachmentUrl = new URL(url);

        // 기존 자료는 /api/download?path=...&mode=download 형식으로 저장되어
        // 있으므로, 현재 로그인 권한으로 용도별 단기 서명 URL을 다시 발급한다.
        if (attachmentUrl.pathname === '/api/download') {
            const path = attachmentUrl.searchParams.get('path');
            if (!path) throw new Error('첨부파일 경로가 올바르지 않습니다.');

            const response = await apiFetch('/api/download-link', {
                method: 'POST',
                headers: await getHeaders(true),
                body: JSON.stringify({ path, filename, mode })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.url) {
                throw new Error(data.error || '파일 열기 주소를 만들 수 없습니다.');
            }
            return new URL(data.url, API_BASE_URL).href;
        }

        // 새 자료 저장소의 파일 주소는 download 쿼리만으로 표시 방식을 구분한다.
        if (mode === 'download') attachmentUrl.searchParams.set('download', '1');
        else attachmentUrl.searchParams.delete('download');
        return attachmentUrl.href;
    }

    function getPreviewMimeType(filename, contentType) {
        const type = String(contentType || '').split(';')[0].trim().toLowerCase();
        const ext = String(filename || '').split('.').pop().toLowerCase();
        const byExt = {
            pdf: 'application/pdf',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            txt: 'text/plain',
            csv: 'text/csv',
            md: 'text/plain',
            json: 'application/json',
            mp3: 'audio/mpeg',
            wav: 'audio/wav',
            mp4: 'video/mp4',
            webm: 'video/webm'
        };
        const allowedTypes = new Set(Object.values(byExt));
        if (allowedTypes.has(type)) return type;
        return byExt[ext] || '';
    }

    async function openAttachment(url, filename, mode = 'preview') {
        let previewWindow = null;
        try {
            if (!currentUser) throw new Error('로그인이 필요합니다.');
            if (mode === 'preview') {
                previewWindow = window.open('about:blank', '_blank');
                if (!previewWindow) throw new Error('팝업이 차단되어 미리보기를 열 수 없습니다.');
                previewWindow.opener = null;
                previewWindow.document.title = '파일 미리보기';
                previewWindow.document.body.textContent = '파일을 불러오는 중입니다...';
            }
            const requestUrl = await resolveAttachmentUrl(url, filename, mode);
            const res = await apiFetchUrl(requestUrl, { headers: await getHeaders() });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || '파일을 열 수 없습니다.');
            }
            const blob = await res.blob();
            if (mode === 'download') {
                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
                return;
            }
            const previewType = getPreviewMimeType(filename, blob.type);
            if (!previewType) throw new Error('이 파일 형식은 미리보기를 지원하지 않습니다. 다운로드 버튼을 사용해 주세요.');
            const previewBlob = blob.type === previewType ? blob : new Blob([blob], { type: previewType });
            const objectUrl = URL.createObjectURL(previewBlob);
            previewWindow.location.href = objectUrl;
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        } catch (err) {
            if (previewWindow && !previewWindow.closed) previewWindow.close();
            alert(err.message || '파일을 열 수 없습니다.');
        }
    }

    async function deleteComment(commentId) {
        if (!confirm('댓글을 삭제하시겠습니까?')) return;
        const res = await apiFetch(`/api/deepsky/board/${COLLECTION}/${encodedPostId}/comments/${encodeURIComponent(String(commentId))}`, { method:'DELETE', headers: await getHeaders() });
        if (res.ok) await loadComments(); else alert('댓글 삭제에 실패했습니다.');
    }

    document.getElementById('btnEditPost').onclick = () => { location.href = `write.html?id=${encodedPostId}`; };
    document.getElementById('btnDeletePost').onclick = async () => {
        if (!confirm('자료를 삭제하시겠습니까? 관련 댓글도 함께 삭제됩니다.')) return;
        const res = await apiFetch(`/api/deepsky/board/${COLLECTION}/${encodedPostId}`, { method:'DELETE', headers: await getHeaders() });
        if (res.ok) location.href = 'resource.html'; else alert('삭제 권한이 없거나 오류가 발생했습니다.');
    };

    function formatDate(value) { if (!value) return '-'; if (value.seconds) return new Date(value.seconds * 1000).toLocaleString(); return new Date(value).toLocaleString(); }
    function escapeHtml(value) { return String(value || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
