import { apiRequest } from "./common.js";

export async function setupPostTools({ user, collection, postId, bookmarkButton, reportButton }) {
    if (!user) {
        bookmarkButton?.classList.add("hidden");
        reportButton?.classList.add("hidden");
        return;
    }
    bookmarkButton?.classList.remove("hidden");
    reportButton?.classList.remove("hidden");
    if (bookmarkButton) {
        const response = await apiRequest(
            `/api/deepsky/bookmarks/${collection}/${encodeURIComponent(String(postId))}`,
            {},
            user
        );
        const data = await response.json();
        setBookmarkLabel(bookmarkButton, data.bookmarked);
        bookmarkButton.onclick = async () => {
            const bookmarked = bookmarkButton.dataset.bookmarked === "true";
            await apiRequest(
                `/api/deepsky/bookmarks/${collection}/${encodeURIComponent(String(postId))}`,
                { method: bookmarked ? "DELETE" : "POST" },
                user
            );
            setBookmarkLabel(bookmarkButton, !bookmarked);
        };
    }
    if (reportButton) {
        reportButton.onclick = () => openReportDialog({
            user,
            targetType: "post",
            collection,
            targetId: postId
        });
    }
}

export function appendCommentReportButton(actions, { user, collection, commentId }) {
    if (!user) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-small";
    button.textContent = "신고";
    button.addEventListener("click", () => openReportDialog({
        user,
        targetType: "comment",
        collection,
        targetId: commentId
    }));
    actions.appendChild(button);
}

function setBookmarkLabel(button, bookmarked) {
    button.dataset.bookmarked = String(bookmarked);
    button.textContent = bookmarked ? "저장됨" : "저장";
}

function openReportDialog({ user, targetType, collection, targetId }) {
    const dialog = getReportDialog();
    dialog.dataset.targetType = targetType;
    dialog.dataset.collection = collection;
    dialog.dataset.targetId = String(targetId);
    dialog.reportUser = user;
    dialog.querySelector("[data-report-status]").textContent = "";
    dialog.querySelector("form").reset();
    dialog.showModal();
}

function getReportDialog() {
    let dialog = document.getElementById("report-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "report-dialog";
    dialog.className = "report-dialog";
    dialog.innerHTML = `
        <form method="dialog">
            <h2>콘텐츠 신고</h2>
            <label for="report-reason">사유</label>
            <select id="report-reason" required>
                <option value="inappropriate">부적절한 내용</option>
                <option value="spam">스팸</option>
                <option value="privacy">개인정보 노출</option>
                <option value="copyright">저작권 침해</option>
                <option value="other">기타</option>
            </select>
            <label for="report-details">상세 내용</label>
            <textarea id="report-details" maxlength="1000" placeholder="관리자가 확인할 내용을 입력해 주세요."></textarea>
            <p class="form-status" data-report-status role="status"></p>
            <div class="actions">
                <button class="btn" type="button" data-report-cancel>취소</button>
                <button class="btn btn-primary" type="submit">신고 접수</button>
            </div>
        </form>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-report-cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const status = dialog.querySelector("[data-report-status]");
        status.textContent = "접수 중입니다.";
        try {
            await apiRequest("/api/deepsky/reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    target_type: dialog.dataset.targetType,
                    collection_name: dialog.dataset.collection,
                    target_id: Number(dialog.dataset.targetId),
                    reason: dialog.querySelector("#report-reason").value,
                    details: dialog.querySelector("#report-details").value.trim()
                })
            }, dialog.reportUser);
            const reportedType = dialog.dataset.targetType;
            const reportedCollection = dialog.dataset.collection;
            dialog.close();
            alert(reportedType === "post"
                ? "신고가 접수되어 관리자 처리 전까지 게시글이 숨겨집니다."
                : "신고가 접수되었습니다.");
            if (reportedType === "post") {
                window.location.replace(reportedCollection === "resources" ? "resource.html" : "talk.html");
            }
        } catch (error) {
            status.textContent = error.message;
        }
    });
    return dialog;
}
