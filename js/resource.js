import { API_BASE_URL, apiFetch, auth, authHeaders, getCurrentProfile } from "./common.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
const COLLECTION = "resources";
const WRITABLE_ROLES = ['teacher', 'admin'];
let currentUser = null;
    let currentRole = 'guest';
    let allPosts = [];

    document.getElementById('logout-btn').addEventListener('click', async () => {
        if (confirm("로그아웃 하시겠습니까?")) {
            await signOut(auth);
            location.href = "index.html";
        }
    });

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            alert('로그인이 필요합니다.');
            location.replace('login.html');
            return;
        }

        try {
            currentUser = user;
            const userData = await getCurrentProfile(user);
            currentRole = userData.role || 'member';
            document.getElementById('user-name').style.display = 'inline';
            document.getElementById('user-name').innerText = `${userData.name || '사용자'}님`;

            document.getElementById('logout-btn').style.display = 'inline';
            document.getElementById('login-link').style.display = 'none';

            if (WRITABLE_ROLES.includes(currentRole)) {
                document.getElementById('write-btn').style.display = 'inline';
            }

            await loadPosts();
        } catch (err) {
            console.error(err);
            location.replace('block.html');
        }
    });
    async function loadPosts() {
        try {
            const res = await apiFetch(`/api/deepsky/board/${COLLECTION}`, { headers: await authHeaders(currentUser) });
            if (!res.ok) {
                document.getElementById('resource-list').innerHTML = '<div style="padding:100px; text-align:center; color:#ff4d4d;">서버 연결에 실패했습니다.</div>';
                return;
            }
            allPosts = await res.json();
            renderPosts();
        } catch (err) {
            document.getElementById('resource-list').innerHTML = '<div style="padding:100px; text-align:center; color:#ff4d4d;">서버 연결에 실패했습니다.</div>';
        }
    }

    function renderPosts() {
        const keyword = document.getElementById('search-keyword').value.toLowerCase();
        const category = document.getElementById('filter-category').value;
        const listDiv = document.getElementById('resource-list');

        const filtered = allPosts.filter(p =>
            (category === 'all' || p.category === category) &&
            ((p.title || '').toLowerCase().includes(keyword) || (p.author_name || '').toLowerCase().includes(keyword))
        );

        if (filtered.length === 0) {
            listDiv.innerHTML = '<div style="padding:100px; text-align:center; color:#555;">등록된 자료가 없거나 검색 결과가 없습니다.</div>';
            return;
        }

        const canDelete = (p) => currentUser && (
            p.uid === currentUser.uid ||
            ['admin', 'teacher'].includes(currentRole)
        );

        listDiv.replaceChildren();
        filtered.forEach(post => {
            const item = document.createElement('article');
            item.className = 'resource-item';
            item.tabIndex = 0;
            item.setAttribute('role', 'link');

            const openPost = () => {
                location.href = `view.html?id=${encodeURIComponent(String(post.id))}`;
            };
            item.addEventListener('click', openPost);
            item.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openPost();
                }
            });

            if (canDelete(post)) {
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'btn-delete-left';
                deleteButton.textContent = '삭제';
                deleteButton.addEventListener('click', event => {
                    event.stopPropagation();
                    deletePost(post.id);
                });
                item.appendChild(deleteButton);
            }

            const content = document.createElement('div');
            content.className = 'item-content';

            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.style.cssText = 'margin-bottom:8px; display:inline-block;';
            tag.textContent = post.category || '기타';

            const title = document.createElement('span');
            title.className = 'item-title';
            title.textContent = post.title || '제목 없음';

            const meta = document.createElement('div');
            meta.className = 'item-meta';
            const author = document.createElement('span');
            author.textContent = post.author_name || '익명';
            const separator = document.createElement('span');
            separator.style.opacity = '0.4';
            separator.textContent = '|';
            const date = document.createElement('span');
            date.textContent = post.created_at ? new Date(post.created_at).toLocaleDateString() : '-';
            meta.append(author, separator, date);

            content.append(tag, title, meta);
            item.appendChild(content);
            listDiv.appendChild(item);
        });
    }

    async function deletePost(postId) {
        if (!confirm("이 자료를 삭제하시겠습니까?")) return;
        try {
            const res = await apiFetch(`/api/deepsky/board/${COLLECTION}/${encodeURIComponent(String(postId))}`, {
                method: 'DELETE',
                headers: await authHeaders(currentUser)
            });
            if (res.ok) {
                alert("삭제되었습니다.");
                await loadPosts();
            } else {
                const data = await res.json();
                alert("삭제 실패: " + data.error);
            }
        } catch (err) {
            alert("서버 연결에 실패했습니다.");
        }
    }

    document.getElementById('search-keyword').oninput = renderPosts;
    document.getElementById('filter-category').onchange = renderPosts;
