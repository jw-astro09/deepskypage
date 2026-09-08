import { apiRequest, auth, getCurrentProfile, logoutTo } from "./common.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const loginLink = document.getElementById("login-link");
const logoutButton = document.getElementById("logout-btn");
const userName = document.getElementById("user-name");
const formSection = document.getElementById("photo-form-section");
const form = document.getElementById("photo-form");
const imageInput = document.getElementById("photo-images");
const selection = document.getElementById("photo-selection");
const formStatus = document.getElementById("photo-form-status");
const submitButton = document.getElementById("photo-submit");
const boardStatus = document.getElementById("photo-board-status");
const grid = document.getElementById("photo-grid");
const searchInput = document.getElementById("photo-search");
const dialog = document.getElementById("photo-dialog");
const dialogImage = document.getElementById("photo-dialog-image");
const dialogCaption = document.getElementById("photo-dialog-caption");

let currentUser = null;
let currentProfile = null;
let permissions = {};
let photos = [];
let dialogItems = [];
let dialogIndex = 0;
const objectUrls = new Set();

logoutButton.addEventListener("click", () => logoutTo());
imageInput.addEventListener("change", renderSelection);
searchInput.addEventListener("input", renderFilteredPhotos);
form.addEventListener("submit", submitPhotoPost);
document.getElementById("photo-dialog-close").addEventListener("click", () => dialog.close());
document.getElementById("photo-dialog-prev").addEventListener("click", () => moveDialog(-1));
document.getElementById("photo-dialog-next").addEventListener("click", () => moveDialog(1));
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
window.addEventListener("beforeunload", clearObjectUrls);

onAuthStateChanged(auth, async user => {
    if (!user) {
        location.replace("login.html");
        return;
    }
    currentUser = user;
    try {
        [currentProfile, permissions] = await Promise.all([
            getCurrentProfile(user),
            apiRequest("/api/deepsky/me/permissions", {}, user).then(response => response.json())
        ]);
        loginLink.hidden = true;
        userName.hidden = false;
        userName.textContent = `${currentProfile.name || "사용자"}님`;
        logoutButton.hidden = false;
        formSection.hidden = !permissions["gallery.upload"];
        await loadPhotos();
    } catch (error) {
        boardStatus.textContent = error.message;
        boardStatus.classList.add("error");
    }
});

async function loadPhotos() {
    boardStatus.textContent = "사진을 불러오는 중입니다.";
    boardStatus.classList.remove("error");
    const response = await apiRequest("/api/deepsky/photos", {}, currentUser);
    photos = await response.json();
    await renderFilteredPhotos();
}

async function renderFilteredPhotos() {
    const query = searchInput.value.trim().toLocaleLowerCase("ko");
    const filtered = photos.filter(photo => {
        const text = `${photo.title || ""} ${photo.content || ""} ${photo.author_name || ""}`.toLocaleLowerCase("ko");
        return !query || text.includes(query);
    });
    clearObjectUrls();
    grid.replaceChildren();
    if (!filtered.length) {
        boardStatus.textContent = query ? "검색 결과가 없습니다." : "등록된 활동 사진이 없습니다.";
        return;
    }
    boardStatus.textContent = `${filtered.length}개의 사진 기록`;
    for (const photo of filtered) grid.appendChild(await createPhotoCard(photo));
}

async function createPhotoCard(photo) {
    const card = document.createElement("article");
    card.className = "photo-card";
    card.id = `photo-${photo.id}`;
    const attachments = Array.isArray(photo.attachments) ? photo.attachments : [];
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "photo-card-preview";
    preview.disabled = !attachments.length;
    if (attachments.length) {
        try {
            const url = await loadImage(attachments[0].url);
            const image = document.createElement("img");
            image.src = url;
            image.alt = photo.title || "활동 사진";
            preview.appendChild(image);
            if (attachments.length > 1) {
                const count = document.createElement("span");
                count.textContent = `+${attachments.length - 1}`;
                preview.appendChild(count);
            }
            preview.addEventListener("click", () => openDialog(photo, attachments));
        } catch (error) {
            preview.textContent = "이미지를 불러오지 못했습니다.";
            preview.title = error.message;
        }
    } else {
        preview.textContent = "첨부 이미지 없음";
    }
    const body = document.createElement("div");
    body.className = "photo-card-body";
    const title = document.createElement("h3");
    title.textContent = photo.title || "제목 없음";
    const content = document.createElement("p");
    content.textContent = photo.content || "활동 설명이 없습니다.";
    const meta = document.createElement("div");
    meta.className = "photo-card-meta";
    meta.textContent = `${photo.author_name || "사용자"} · ${formatDate(photo.created_at)}`;
    body.append(title, content, meta);
    if (photo.uid === currentUser.uid || permissions["gallery.manage"]) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "photo-delete";
        remove.textContent = "삭제";
        remove.addEventListener("click", () => deletePhoto(photo.id));
        body.appendChild(remove);
    }
    card.append(preview, body);
    return card;
}

async function loadImage(path) {
    const response = await apiRequest(path, { cache: "no-store" }, currentUser);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("올바른 이미지 응답이 아닙니다.");
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return url;
}

async function openDialog(photo, attachments) {
    try {
        dialogItems = await Promise.all(attachments.map(async attachment => ({
            url: await loadImage(attachment.url),
            name: attachment.name || photo.title || "활동 사진"
        })));
        dialogIndex = 0;
        updateDialog();
        dialog.showModal();
    } catch (error) {
        alert(error.message);
    }
}

function moveDialog(offset) {
    if (!dialogItems.length) return;
    dialogIndex = (dialogIndex + offset + dialogItems.length) % dialogItems.length;
    updateDialog();
}

function updateDialog() {
    const item = dialogItems[dialogIndex];
    if (!item) return;
    dialogImage.src = item.url;
    dialogImage.alt = item.name;
    dialogCaption.textContent = `${item.name} (${dialogIndex + 1}/${dialogItems.length})`;
    const multiple = dialogItems.length > 1;
    document.getElementById("photo-dialog-prev").hidden = !multiple;
    document.getElementById("photo-dialog-next").hidden = !multiple;
}

function renderSelection() {
    const files = Array.from(imageInput.files || []);
    selection.replaceChildren();
    if (files.length > 10) {
        imageInput.value = "";
        formStatus.textContent = "사진은 한 번에 최대 10장까지 등록할 수 있습니다.";
        formStatus.classList.add("error");
        return;
    }
    formStatus.textContent = "";
    formStatus.classList.remove("error");
    files.forEach(file => {
        const item = document.createElement("span");
        item.textContent = file.name;
        selection.appendChild(item);
    });
}

async function submitPhotoPost(event) {
    event.preventDefault();
    const images = Array.from(imageInput.files || []);
    if (!images.length || images.length > 10) {
        formStatus.textContent = "사진을 1장 이상 10장 이하로 선택해 주세요.";
        formStatus.classList.add("error");
        return;
    }
    const data = new FormData();
    data.append("title", document.getElementById("photo-title").value.trim());
    data.append("content", document.getElementById("photo-content").value.trim());
    images.forEach(image => data.append("images", image, image.name));
    submitButton.disabled = true;
    submitButton.textContent = "업로드 중...";
    formStatus.textContent = "이미지를 서버에 저장하고 있습니다.";
    formStatus.classList.remove("error");
    try {
        await apiRequest("/api/deepsky/photos", { method: "POST", body: data }, currentUser);
        form.reset();
        renderSelection();
        formStatus.textContent = "사진 게시물이 등록되었습니다.";
        await loadPhotos();
    } catch (error) {
        formStatus.textContent = error.message;
        formStatus.classList.add("error");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "사진 게시하기";
    }
}

async function deletePhoto(id) {
    if (!confirm("이 사진 게시물과 첨부 이미지를 삭제하시겠습니까?")) return;
    try {
        await apiRequest(`/api/deepsky/photos/${encodeURIComponent(String(id))}`, { method: "DELETE" }, currentUser);
        await loadPhotos();
    } catch (error) {
        alert(error.message);
    }
}

function clearObjectUrls() {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls.clear();
    dialogItems = [];
}

function formatDate(value) {
    if (!value) return "날짜 없음";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ko-KR");
}
