const UPLOAD_PATH_PREFIX = "/api/deepsky/uploads/";
const LEGACY_DOWNLOAD_PATHS = new Set(["/api/download", "/api/download-link"]);

export function normalizeLinkUrl(value, { allowUpload = false, resolveUpload = false, apiBaseUrl = "" } = {}) {
    const raw = String(value || "").trim();
    if (!raw || raw.startsWith("//") || /[\u0000-\u001f\u007f\\]/.test(raw)) return "";
    try {
        const api = apiBaseUrl ? new URL(apiBaseUrl) : null;
        const rawPath = raw.split(/[?#]/, 1)[0];
        const decodedRawPath = decodeURIComponent(rawPath);
        if (decodedRawPath.split("/").some(part => part === "." || part === "..")) return "";
        const url = new URL(raw, raw.startsWith("/") ? api : undefined);
        const decodedPath = decodeURIComponent(url.pathname);
        const isUpload = url.pathname.startsWith(UPLOAD_PATH_PREFIX);
        const isLegacyDownload = LEGACY_DOWNLOAD_PATHS.has(url.pathname);
        if (allowUpload && (isUpload || isLegacyDownload)) {
            if (
                !api ||
                url.origin !== api.origin ||
                url.username ||
                url.password ||
                decodedPath.split("/").some(part => part === "." || part === "..") ||
                (isUpload && (url.search || url.hash))
            ) return "";
            // Rebind approved API paths to the currently selected API origin.
            if (isLegacyDownload) return `${api.origin}${url.pathname}${url.search}`;
            return resolveUpload ? `${api.origin}${url.pathname}` : url.pathname;
        }
        if (
            !["http:", "https:"].includes(url.protocol) ||
            !url.hostname ||
            url.username ||
            url.password ||
            isUpload ||
            isLegacyDownload
        ) return "";
        return url.href;
    } catch {
        return "";
    }
}
