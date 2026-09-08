import { apiRequest, auth, getCurrentProfile, logoutTo } from "./common.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const SUGGESTION_ROLES = new Set([
    "admin", "teacher", "student"
]);

const loginLink = document.getElementById("login-link");
const logoutBtn = document.getElementById("logout-btn");
const userNameDisplay = document.getElementById("user-name");
const form = document.getElementById("suggestion-form");
const nameInput = document.getElementById("user-name-input");
const anonCheck = document.getElementById("anon-check");
const anonymousOption = document.getElementById("anonymous-option");
const categorySelect = document.getElementById("category");
const authorityFields = document.getElementById("authority-fields");
const roleSelect = document.getElementById("request-role");
const subjectGroup = document.getElementById("subject-input-group");
const subjectInput = document.getElementById("subject");
const contentInput = document.getElementById("content");
const contentLabel = document.getElementById("content-label");
const imageGroup = document.getElementById("suggestion-image-group");
const imageInput = document.getElementById("suggestion-images");
const imagePreview = document.getElementById("suggestion-image-preview");
const submitButton = document.querySelector(".submit-btn");

let currentUser = null;
let currentProfile = null;

logoutBtn.addEventListener("click", () => logoutTo());
categorySelect.addEventListener("change", applyCategoryMode);
anonCheck.addEventListener("change", syncAnonymousState);
imageInput.addEventListener("change", renderSelectedImages);

onAuthStateChanged(auth, async user => {
    if (!user) {
        location.replace("block.html");
        return;
    }
    try {
        currentUser = user;
        currentProfile = await getCurrentProfile(user);
        loginLink.style.display = "none";
        userNameDisplay.style.display = "inline";
        userNameDisplay.textContent = `${currentProfile.name || "사용자"}님`;
        logoutBtn.style.display = "inline";
        nameInput.value = currentProfile.name || "";

        if (!SUGGESTION_ROLES.has(currentProfile.role)) {
            [...categorySelect.options].forEach(option => {
                if (option.value !== "등급 조정") option.remove();
            });
            categorySelect.value = "등급 조정";
            categorySelect.disabled = true;
        } else if (new URLSearchParams(location.search).get("category") === "authority") {
            categorySelect.value = "등급 조정";
        }
        applyCategoryMode();
    } catch (error) {
        console.error(error);
        location.replace("block.html");
    }
});

form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser) return;
    const authorityMode = categorySelect.value === "등급 조정";
    submitButton.disabled = true;
    submitButton.textContent = authorityMode ? "요청 중..." : "제출 중...";
    try {
        if (authorityMode) {
            await submitAuthorityRequest();
            alert("등급 조정 요청이 제출되었습니다.");
            location.href = "mypage.html";
            return;
        }
        await submitSuggestion();
        alert("소중한 의견이 제출되었습니다. 관리자가 확인 후 반영하겠습니다.");
        form.reset();
        nameInput.value = currentProfile?.name || "";
        renderSelectedImages();
        applyCategoryMode();
    } catch (error) {
        alert(`제출 중 오류가 발생했습니다: ${error.message}`);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = authorityMode ? "등급 조정 요청" : "제출하기";
    }
});

async function submitAuthorityRequest() {
    const response = await apiRequest("/api/deepsky/authority-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: nameInput.value.trim(),
            requestedRole: roleSelect.value,
            reason: contentInput.value.trim()
        })
    }, currentUser);
    return response.json();
}

async function submitSuggestion() {
    const isAnonymous = anonCheck.checked;
    const images = Array.from(imageInput.files || []);
    if (images.length > 3) throw new Error("이미지는 최대 3장까지 첨부할 수 있습니다.");
    const formData = new FormData();
    formData.append("authorName", isAnonymous ? "익명" : nameInput.value.trim());
    formData.append("isAnonymous", String(isAnonymous));
    formData.append("category", categorySelect.value);
    formData.append("subject", subjectInput.value.trim());
    formData.append("content", contentInput.value.trim());
    images.forEach(image => formData.append("images", image, image.name));
    const response = await apiRequest("/api/deepsky/suggestions", {
        method: "POST",
        body: formData
    }, currentUser);
    return response.json();
}

function applyCategoryMode() {
    const authorityMode = categorySelect.value === "등급 조정";
    authorityFields.hidden = !authorityMode;
    imageGroup.hidden = authorityMode;
    anonymousOption.hidden = authorityMode;
    subjectGroup.hidden = authorityMode;
    subjectInput.required = !authorityMode;
    roleSelect.required = authorityMode;
    anonCheck.checked = authorityMode ? false : anonCheck.checked;
    contentLabel.textContent = authorityMode ? "요청 사유" : "내용";
    contentInput.placeholder = authorityMode
        ? "등급 조정이 필요한 이유를 작성해주세요."
        : "건의 내용을 상세히 작성해주세요.";
    submitButton.textContent = authorityMode ? "등급 조정 요청" : "제출하기";
    syncAnonymousState();
}

function renderSelectedImages() {
    const files = Array.from(imageInput.files || []);
    imagePreview.replaceChildren();
    if (files.length > 3) {
        imageInput.value = "";
        alert("이미지는 최대 3장까지 첨부할 수 있습니다.");
        return;
    }
    files.forEach(file => {
        const item = document.createElement("figure");
        const image = document.createElement("img");
        const caption = document.createElement("figcaption");
        const objectUrl = URL.createObjectURL(file);
        image.src = objectUrl;
        image.alt = `${file.name} 미리보기`;
        image.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
        image.addEventListener("error", () => URL.revokeObjectURL(objectUrl), { once: true });
        caption.textContent = file.name;
        item.append(image, caption);
        imagePreview.appendChild(item);
    });
}

function syncAnonymousState() {
    const anonymous = !anonymousOption.hidden && anonCheck.checked;
    nameInput.disabled = anonymous;
    nameInput.required = !anonymous;
    nameInput.placeholder = anonymous ? "익명으로 안전하게 제출합니다" : "성함을 입력하세요";
    if (anonymous) nameInput.value = "";
    else if (!nameInput.value && currentProfile) nameInput.value = currentProfile.name || "";
}
