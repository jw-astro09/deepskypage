import { apiRequest, auth, authPersistenceReady } from "./common.js?v=20260826-session-auth";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

async function continueAfterAuthentication(user) {
    const response = await apiRequest("/api/deepsky/account-status", {}, user);
    const account = await response.json();
    location.href = account.exists ? "index.html" : "signup.html";
}

document.getElementById("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("login-btn");
    button.disabled = true;
    button.textContent = "Signing in...";
    try {
        if (!await authPersistenceReady) throw new Error("세션 로그인 설정에 실패했습니다.");
        const credential = await signInWithEmailAndPassword(
            auth,
            document.getElementById("email").value.trim(),
            document.getElementById("password").value
        );
        if (!credential.user.emailVerified) {
            alert("Email verification is required.");
            await signOut(auth);
            return;
        }
        await continueAfterAuthentication(credential.user);
    } catch (error) {
        if (error?.code === "auth/user-not-found") {
            location.href = "signup.html";
            return;
        }
        alert("Login failed. Check your email and password.");
    } finally {
        button.disabled = false;
        button.textContent = "Login";
    }
});

document.getElementById("google-btn").addEventListener("click", async () => {
    try {
        if (!await authPersistenceReady) throw new Error("세션 로그인 설정에 실패했습니다.");
        const credential = await signInWithPopup(auth, new GoogleAuthProvider());
        await continueAfterAuthentication(credential.user);
    } catch (error) {
        alert("Google login failed.");
    }
});

document.getElementById("reset-btn").addEventListener("click", async () => {
    const email = prompt("Enter your email address.");
    if (!email) return;
    try {
        await sendPasswordResetEmail(auth, email);
        alert("Password reset email sent.");
    } catch (error) {
        alert("Failed to send reset email.");
    }
});
