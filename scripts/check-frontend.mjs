import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        if (entry.name === ".git" || entry.name === "node_modules") return [];
        const fullPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(fullPath) : [fullPath];
    });
}

function relative(file) {
    return path.relative(root, file).replaceAll("\\", "/");
}

function fail(file, message) {
    failures.push(`${relative(file)}: ${message}`);
}

const files = walk(root);
const htmlFiles = files.filter(file => file.endsWith(".html"));
const jsFiles = files.filter(file => file.endsWith(".js") || file.endsWith(".mjs"));

for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");

    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
        if (!/\balt\s*=/i.test(match[0])) fail(file, "img 요소에 alt 속성이 없습니다.");
    }

    for (const match of html.matchAll(/<nav\b[^>]*>/gi)) {
        if (!/\baria-label(?:ledby)?\s*=/i.test(match[0])) {
            fail(file, "nav 요소에 접근 가능한 이름이 없습니다.");
        }
    }

    for (const match of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
        const tag = match[0];
        if (/\btype\s*=\s*["']hidden["']/i.test(tag)) continue;
        if (/\baria-label(?:ledby)?\s*=/i.test(tag)) continue;
        const id = tag.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
        const hasForLabel = id && new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(html);
        const lastOpenLabel = html.lastIndexOf("<label", match.index);
        const lastCloseLabel = html.lastIndexOf("</label>", match.index);
        if (!hasForLabel && lastOpenLabel <= lastCloseLabel) {
            fail(file, `${tag.slice(0, 80)} 요소에 연결된 label 또는 aria-label이 없습니다.`);
        }
    }

    for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"'#?]+)["']/gi)) {
        const reference = match[1];
        if (/^(?:https?:|mailto:|tel:|data:|javascript:|\/)/i.test(reference)) continue;
        const target = path.resolve(path.dirname(file), reference);
        if (!fs.existsSync(target)) fail(file, `로컬 참조가 존재하지 않습니다: ${reference}`);
    }

    for (const match of html.matchAll(/<a\b[^>]*\btarget\s*=\s*["']_blank["'][^>]*>/gi)) {
        if (!/\brel\s*=\s*["'][^"']*\bnoopener\b[^"']*["']/i.test(match[0])) {
            fail(file, "target=_blank 링크에 rel=noopener가 없습니다.");
        }
    }
}

for (const file of jsFiles) {
    const source = fs.readFileSync(file, "utf8");
    const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], {
        input: source,
        encoding: "utf8"
    });
    if (syntax.status !== 0) fail(file, `JavaScript 문법 오류: ${syntax.stderr.trim()}`);
}

const resourceSource = fs.readFileSync(path.join(root, "js", "resource.js"), "utf8");
if (/innerHTML\s*=\s*filtered\.map/.test(resourceSource)) {
    fail(path.join(root, "js", "resource.js"), "서버 자료를 innerHTML 템플릿으로 렌더링하고 있습니다.");
}
for (const field of ["title", "category", "author_name"]) {
    if (!new RegExp(`\\.textContent\\s*=\\s*post\\.${field}`).test(resourceSource)) {
        fail(path.join(root, "js", "resource.js"), `${field} 필드가 textContent로 렌더링되지 않습니다.`);
    }
}

const signupSource = fs.readFileSync(path.join(root, "js", "signup.js"), "utf8");
if (!/sendEmailVerification\(user\)[\s\S]*?signOut\(auth\)/.test(signupSource)) {
    fail(path.join(root, "js", "signup.js"), "이메일 미인증 가입 세션을 종료하지 않습니다.");
}

const commonSource = fs.readFileSync(path.join(root, "js", "common.js"), "utf8");
for (const requiredPattern of [
    /normalizeLinkUrl/,
    /apiBaseUrl:\s*API_BASE_URL/
]) {
    if (!requiredPattern.test(commonSource)) {
        fail(path.join(root, "js", "common.js"), "공유 링크 URL 보안 정책이 누락되었습니다.");
    }
}

const { normalizeLinkUrl } = await import(pathToFileURL(path.join(root, "js", "link-policy.js")));
const apiBaseUrl = "https://api.example.com";
for (const unsafe of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example/file",
    "https://user:pass@example.com/file",
    "https://example.com\\@evil.example/file",
    "https://example.com/api/deepsky/uploads/resources/file.pdf",
    "/api/deepsky/uploads/resources/../secret.txt",
    "/api/deepsky/uploads/resources/%2e%2e/secret.txt"
]) {
    if (normalizeLinkUrl(unsafe, { allowUpload: true, apiBaseUrl })) {
        fail(path.join(root, "js", "link-policy.js"), `위험한 URL을 허용합니다: ${unsafe}`);
    }
}
if (normalizeLinkUrl("https://example.com/file?q=1") !== "https://example.com/file?q=1") {
    fail(path.join(root, "js", "link-policy.js"), "정상 HTTPS 링크를 거부합니다.");
}
if (normalizeLinkUrl("/api/deepsky/uploads/resources/file.pdf", { allowUpload: true, apiBaseUrl }) !== "/api/deepsky/uploads/resources/file.pdf") {
    fail(path.join(root, "js", "link-policy.js"), "정상 서버 첨부 경로를 거부합니다.");
}
for (const name of ["view.js", "school-view.js", "write.js", "school-write.js"]) {
    const file = path.join(root, "js", name);
    const source = fs.readFileSync(file, "utf8");
    if (!/normalizeSafeLinkUrl/.test(source)) {
        fail(file, "공유 링크 URL 검증 함수를 사용하지 않습니다.");
    }
}

for (const file of files) {
    const size = fs.statSync(file).size;
    if (size > 5 * 1024 * 1024) fail(file, `파일이 5MB를 초과합니다 (${(size / 1024 / 1024).toFixed(1)}MB).`);
}

if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}

console.log(`Frontend checks passed: ${htmlFiles.length} HTML, ${jsFiles.length} JavaScript files.`);
