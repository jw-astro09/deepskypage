import { API_BASE_URL, authHeaders, selectAvailableApi } from "./common.js";

export function createDraftController({ key, collect, restore, root, statusElement, clearButton }) {
    let timer = null;
    const save = () => {
        const draft = { ...collect(), savedAt: new Date().toISOString() };
        localStorage.setItem(key, JSON.stringify(draft));
        statusElement.textContent = `임시 저장됨 ${new Date(draft.savedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
        clearButton.hidden = false;
    };
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(save, 700);
    };
    root.addEventListener("input", schedule);
    root.addEventListener("change", schedule);
    clearButton.addEventListener("click", () => clear(true));

    const raw = localStorage.getItem(key);
    if (raw) {
        try {
            const draft = JSON.parse(raw);
            if (confirm("이전에 임시 저장한 내용을 불러오시겠습니까?")) {
                restore(draft);
                statusElement.textContent = `임시 저장본 복원 · ${new Date(draft.savedAt).toLocaleString("ko-KR")}`;
                clearButton.hidden = false;
            }
        } catch {
            localStorage.removeItem(key);
        }
    }

    function clear(showMessage = false) {
        clearTimeout(timer);
        localStorage.removeItem(key);
        clearButton.hidden = true;
        statusElement.textContent = showMessage ? "임시 저장본을 삭제했습니다." : "";
    }
    return { clear, save };
}

export async function uploadFilesWithProgress({
    files,
    user,
    collection,
    progressWrap,
    progressElement,
    statusElement,
    cancelButton
}) {
    if (!files.length) return [];
    progressWrap.hidden = false;
    cancelButton.hidden = false;
    progressElement.value = 0;
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || files.length;
    let completedBytes = 0;
    let currentXhr = null;
    let cancelled = false;
    cancelButton.onclick = () => {
        cancelled = true;
        currentXhr?.abort();
    };
    const uploaded = [];
    try {
        for (let index = 0; index < files.length; index += 1) {
            if (cancelled) throw new Error("파일 업로드를 취소했습니다.");
            const file = files[index];
            statusElement.textContent = `${index + 1}/${files.length} ${file.name} 업로드 중`;
            const result = await uploadOne(file, user, collection, event => {
                const loaded = event.lengthComputable ? event.loaded : 0;
                progressElement.value = Math.min(100, Math.round(((completedBytes + loaded) / totalBytes) * 100));
            }, xhr => {
                currentXhr = xhr;
            });
            completedBytes += file.size || 1;
            uploaded.push(result);
        }
        progressElement.value = 100;
        statusElement.textContent = `${files.length}개 파일 업로드 완료`;
        return uploaded;
    } finally {
        currentXhr = null;
        cancelButton.hidden = true;
    }
}

async function uploadOne(file, user, collection, onProgress, onXhr) {
    const headers = await authHeaders(user);
    await selectAvailableApi();
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        onXhr(xhr);
        xhr.open("POST", `${API_BASE_URL}/api/deepsky/uploads/${collection}`);
        Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
        xhr.upload.addEventListener("progress", onProgress);
        xhr.addEventListener("load", () => {
            const data = parseJson(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else reject(new Error(`${file.name}: ${data.error || "업로드 실패"}`));
        });
        xhr.addEventListener("error", () => reject(new Error(`${file.name}: 네트워크 오류`)));
        xhr.addEventListener("abort", () => reject(new Error("파일 업로드를 취소했습니다.")));
        const body = new FormData();
        body.append("file", file);
        xhr.send(body);
    });
}

function parseJson(value) {
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
}
