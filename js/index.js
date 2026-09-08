import { apiRequest, auth, getCurrentProfile } from "./common.js";
import { initializeAnnouncements } from "./announcements.js?v=20260826-home-records";
import { initializeSchedule } from "./schedule.js?v=20260826-home-records";
import { initializeUpdates } from "./updates.js?v=20260826-home-records";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
const loginLink=document.getElementById("login-link");
const logoutBtn=document.getElementById("logout-btn");
const userName=document.getElementById("user-name");

logoutBtn?.addEventListener("click",async()=>{
  await signOut(auth);
  location.href="index.html";
});

onAuthStateChanged(auth,async user=>{
  let profile = null;
  loginLink.style.display = user ? "none" : "inline-flex";
  logoutBtn.style.display = user ? "inline-flex" : "none";
  userName.style.display = user ? "inline" : "none";
  document.getElementById("member-dashboard").hidden = !user;
  document.getElementById("dashboard-posts-section").hidden = !user;
  try {
    if (user) {
      profile=await getCurrentProfile(user);
      userName.textContent=profile.name||user.displayName||"User";
      const response = await apiRequest("/api/deepsky/dashboard", {}, user);
      renderDashboard(await response.json());
    }
  } catch (error) {
    console.error(error);
  }
  await Promise.allSettled([
    initializeSchedule(user, profile),
    initializeAnnouncements(user, profile),
    initializeUpdates(user, profile)
  ]);
});

function renderDashboard(data) {
  document.getElementById("member-dashboard").hidden = false;
  document.getElementById("dashboard-unread").textContent = data.unread_notifications || 0;
  document.getElementById("dashboard-bookmarks").textContent = data.bookmark_count || 0;
  document.getElementById("dashboard-authority").textContent =
    requestStatusLabel(data.authority_request?.status);
  renderPosts(data.recent_posts || []);
}

function renderPosts(items) {
  const section = document.getElementById("dashboard-posts-section");
  const list = document.getElementById("dashboard-post-list");
  section.hidden = false;
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = '<div class="empty-state">확인할 수 있는 최근 자료가 없습니다.</div>';
    return;
  }
  items.forEach(item => {
    const article = document.createElement("article");
    article.className = "feature-item";
    const link = document.createElement("a");
    link.href = item.link;
    const title = document.createElement("h3");
    title.textContent = item.title || "제목 없음";
    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${item.category || "기타"} · ${item.author_name || "익명"} · ${formatDate(item.created_at)}`;
    link.append(title, meta);
    article.appendChild(link);
    list.appendChild(article);
  });
}

function requestStatusLabel(status) {
  return { pending: "대기", approved: "승인", rejected: "반려" }[status] || "없음";
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("ko-KR") : "-";
}
