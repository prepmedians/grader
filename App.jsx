import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  matchesPracticeTest1,
  PRACTICE_TEST_1_SCORING,
  scorePracticeTest1,
} from "./actPracticeTest1Scoring.js";
import { generateRecommendations } from "./studyRecommendations.js";

const _rawBackendUrl = (
  import.meta.env.VITE_BACKEND_BASE_URL || "http://localhost:5000"
).replace(/\/$/, "");
const BACKEND_BASE_URL = /^https?:\/\//.test(_rawBackendUrl)
  ? _rawBackendUrl
  : `https://${_rawBackendUrl}`;
const TESTS_ENDPOINT = `${BACKEND_BASE_URL}/tests`;
const ADMIN_TESTS_ENDPOINT = `${BACKEND_BASE_URL}/admin/tests`;
const ADMIN_IMPORT_ENDPOINT = `${BACKEND_BASE_URL}/admin/tests/import-pdf`;
const FEEDBACK_ENDPOINT = `${BACKEND_BASE_URL}/feedback`;
const AUTH_REGISTER_ENDPOINT = `${BACKEND_BASE_URL}/auth/register`;
const AUTH_LOGIN_ENDPOINT = `${BACKEND_BASE_URL}/auth/login`;
const AUTH_LOGOUT_ENDPOINT = `${BACKEND_BASE_URL}/auth/logout`;
const AUTH_ME_ENDPOINT = `${BACKEND_BASE_URL}/auth/me`;
const MY_RESULTS_ENDPOINT = `${BACKEND_BASE_URL}/me/results`;
const SAVE_RESULT_ENDPOINT = `${BACKEND_BASE_URL}/me/results`;
const EMAIL_RESULTS_ENDPOINT = `${BACKEND_BASE_URL}/me/email-results`;
const ADMIN_USERS_ENDPOINT = `${BACKEND_BASE_URL}/admin/users`;
const ADMIN_ALL_RESULTS_ENDPOINT = `${BACKEND_BASE_URL}/admin/results`;
const ADMIN_ANALYTICS_ENDPOINT = `${BACKEND_BASE_URL}/admin/analytics`;
const SET_USER_ROLE_ENDPOINT = (id) => `${BACKEND_BASE_URL}/admin/users/${id}/role`;

const LETTER_TO_NUMERIC = { A: 1, B: 2, C: 3, D: 4, F: 1, G: 2, H: 3, J: 4 };

const API_ENDPOINTS = {
  parse: {
    label: "Score Report",
    url: `${BACKEND_BASE_URL}/parse-omr`,
    successMessage: "Your score report is ready.",
  },
};
const ADMIN_USERNAME = import.meta.env.VITE_ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "omr123";

const SECTION_CONFIG = [
  { key: "english", title: "English", total: 50 },
  { key: "math", title: "Math", total: 45 },
  { key: "reading", title: "Reading", total: 36 },
  { key: "science", title: "Science", total: 40 },
];

const ODD_LABELS = {
  1: "A",
  2: "B",
  3: "C",
  4: "D",
};

const EVEN_LABELS = {
  1: "F",
  2: "G",
  3: "H",
  4: "J",
};

const styles = `
  :root {
    --bg: #edf5f1;
    --bg-accent: #d7e7df;
    --surface: rgba(255, 255, 255, 0.88);
    --surface-soft: #f5faf8;
    --surface-strong: #ffffff;
    --line: rgba(16, 40, 35, 0.1);
    --text: #10231f;
    --muted: #64756f;
    --shadow: 0 28px 90px rgba(20, 54, 47, 0.16);
    --shadow-soft: 0 14px 38px rgba(20, 54, 47, 0.1);
    --accent: #0d7c66;
    --accent-strong: #075f50;
    --accent-soft: #d9f4ea;
    --info: #2563eb;
    --info-soft: #dbeafe;
    --warning: #b45309;
    --warning-soft: #fef3c7;
    --danger: #b91c1c;
    --danger-soft: #fee2e2;
    --blank: #94a3b8;
    --filled: #0f172a;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-family: "Aptos", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    background:
      radial-gradient(circle at 8% -8%, rgba(13, 124, 102, 0.22), transparent 28rem),
      radial-gradient(circle at 88% 2%, rgba(180, 83, 9, 0.16), transparent 24rem),
      linear-gradient(135deg, var(--bg) 0%, #fbfdfb 48%, var(--bg-accent) 100%);
    color: var(--text);
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  .app-shell {
    min-height: 100vh;
    padding: 18px 20px 52px;
    position: relative;
    overflow: hidden;
  }

  .app-shell::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(16, 35, 31, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(16, 35, 31, 0.035) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.75), transparent 74%);
  }

  .app-container {
    width: min(1160px, 100%);
    margin: 0 auto;
    display: grid;
    gap: 16px;
    position: relative;
    z-index: 1;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    position: sticky;
    top: 14px;
    z-index: 30;
    padding: 10px 12px;
    border: 1px solid rgba(255, 255, 255, 0.72);
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 18px 50px rgba(20, 54, 47, 0.1);
    backdrop-filter: blur(18px);
  }

  .header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 10px;
  }

  .educator-profile {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-soft);
  }

  .profile-avatar {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-size: 0.82rem;
    font-weight: 900;
  }

  .profile-name {
    margin: 0;
    font-size: 0.88rem;
    font-weight: 800;
  }

  .profile-role {
    margin: 1px 0 0;
    color: var(--muted);
    font-size: 0.76rem;
  }

  .brand-mark {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .brand-logo {
    width: 48px;
    height: 48px;
    object-fit: contain;
    border-radius: 16px;
    background: #ffffff;
    box-shadow: var(--shadow-soft);
  }

  .brand-title {
    margin: 0;
    font-size: 1rem;
    line-height: 1.2;
  }

  .brand-subtitle {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 0.82rem;
  }

  .hero-card,
  .panel-card,
  .result-card,
  .answer-card,
  .saved-test-card {
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(18px);
  }

  .hero-card {
    position: relative;
    overflow: hidden;
    border-radius: 28px;
    padding: clamp(22px, 3vw, 34px);
    display: grid;
    gap: 22px;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(245, 250, 248, 0.88)),
      radial-gradient(circle at 92% 12%, rgba(13, 124, 102, 0.16), transparent 22rem);
    animation: rise 0.7s ease both;
  }

  .hero-card::after {
    content: "";
    position: absolute;
    width: 260px;
    height: 260px;
    right: -92px;
    top: -110px;
    border-radius: 999px;
    background: rgba(13, 124, 102, 0.12);
    filter: blur(2px);
    animation: breathe 7s ease-in-out infinite;
  }

  .hero-top {
    display: grid;
    gap: 12px;
    position: relative;
    z-index: 1;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
    padding: 7px 11px;
    border-radius: 999px;
    background: rgba(13, 124, 102, 0.1);
    color: var(--accent);
    font-size: 0.76rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .hero-title {
    margin: 0;
    max-width: 840px;
    font-size: clamp(2.15rem, 4vw, 4.15rem);
    line-height: 0.96;
    letter-spacing: -0.045em;
  }

  .hero-copy {
    margin: 0;
    max-width: 720px;
    color: var(--muted);
    font-size: 1.05rem;
    line-height: 1.6;
  }

  .hero-highlights {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    margin-top: 4px;
  }

  .hero-highlight {
    padding: 9px 11px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.86rem;
    font-weight: 800;
  }

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.08fr) minmax(310px, 0.82fr);
    gap: 16px;
    align-items: start;
    position: relative;
    z-index: 1;
  }

  .panel-card {
    border-radius: 22px;
    padding: 18px;
    animation: rise 0.85s ease both;
    transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
  }

  .panel-card:hover,
  .result-card:hover,
  .saved-test-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow);
    border-color: rgba(13, 124, 102, 0.16);
  }

  .upload-card {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 251, 249, 0.92));
  }

  .insight-card {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(245, 250, 248, 0.82));
    animation-delay: 0.08s;
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
    margin-bottom: 14px;
  }

  .panel-title {
    margin: 0;
    font-size: 1.15rem;
  }

  .panel-subtitle {
    margin: 6px 0 0;
    color: var(--muted);
    line-height: 1.5;
    font-size: 0.94rem;
  }

  .status-chip {
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(13, 124, 102, 0.1);
    color: var(--accent);
    font-weight: 700;
    font-size: 0.82rem;
    white-space: nowrap;
  }

  .stack {
    display: grid;
    gap: 12px;
  }

  .field {
    display: grid;
    gap: 8px;
  }

  .field label {
    font-size: 0.9rem;
    font-weight: 700;
  }

  .text-input,
  .textarea-input,
  .file-input {
    width: 100%;
    border-radius: 14px;
    border: 1px solid var(--line);
    padding: 13px 14px;
    background: var(--surface-strong);
    color: var(--text);
    transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .text-input:focus,
  .textarea-input:focus,
  .file-input:focus {
    outline: none;
    border-color: rgba(31, 111, 95, 0.35);
    box-shadow: 0 0 0 4px rgba(31, 111, 95, 0.12);
    transform: translateY(-1px);
  }

  .textarea-input {
    min-height: 90px;
    resize: vertical;
  }

  .file-pick {
    display: grid;
    gap: 10px;
  }

  .file-name {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    color: var(--muted);
    font-size: 0.92rem;
    word-break: break-word;
  }

  .file-input::file-selector-button {
    margin-right: 12px;
    border: 0;
    border-radius: 12px;
    padding: 10px 12px;
    background: var(--info-soft);
    color: var(--info);
    font-weight: 800;
    cursor: pointer;
  }

  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .primary-button,
  .secondary-button {
    border: 0;
    border-radius: 14px;
    padding: 13px 17px;
    cursor: pointer;
    transition: transform 0.18s ease, opacity 0.18s ease, box-shadow 0.18s ease;
    font-weight: 700;
  }

  .primary-button {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
    color: white;
    box-shadow: 0 12px 26px rgba(31, 111, 95, 0.22);
  }

  .secondary-button {
    background: rgba(16, 35, 31, 0.08);
    color: var(--text);
  }

  .primary-button:hover,
  .secondary-button:hover {
    transform: translateY(-2px);
  }

  .primary-button:disabled,
  .secondary-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    transform: none;
    box-shadow: none;
  }

  .helper-text {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .photo-checklist {
    display: grid;
    gap: 9px;
    padding: 12px;
    border-radius: 18px;
    background: var(--surface-soft);
    border: 1px solid var(--line);
  }

  .photo-checklist-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 800;
  }

  .photo-checklist-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .photo-check-item {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 0.88rem;
  }

  .photo-check-icon {
    width: 24px;
    height: 20px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-size: 0.62rem;
    font-weight: 900;
    flex: 0 0 auto;
  }

  .photo-preview-card {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: 18px;
    background: var(--surface-soft);
    border: 1px solid var(--line);
  }

  .photo-preview-image {
    width: 100%;
    max-height: 220px;
    object-fit: contain;
    border-radius: 14px;
    background: #ffffff;
    border: 1px solid var(--line);
  }

  .photo-guide {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 2px;
  }

  .photo-example {
    display: grid;
    gap: 8px;
    padding: 10px;
    border-radius: 14px;
    background: #ffffff;
    border: 1px solid var(--line);
  }

  .photo-example-label {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 800;
    color: var(--muted);
  }

  .sample-photo {
    height: 86px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #e8f3f1, #f9fbfc);
    overflow: hidden;
  }

  .sample-photo.bad {
    background: linear-gradient(135deg, #f4e7df, #f9fbfc);
  }

  .sample-sheet {
    width: 54px;
    height: 70px;
    border-radius: 4px;
    background:
      repeating-linear-gradient(to bottom, transparent 0 9px, rgba(15, 23, 42, 0.12) 9px 11px),
      #ffffff;
    border: 2px solid rgba(15, 23, 42, 0.2);
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
  }

  .sample-photo.bad .sample-sheet {
    transform: rotate(-13deg) translateX(10px);
    filter: blur(1px);
    opacity: 0.72;
  }

  .message {
    border-radius: 16px;
    padding: 14px 16px;
    font-size: 0.94rem;
    line-height: 1.5;
  }

  .message.error {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .message.success {
    background: rgba(31, 111, 95, 0.12);
    color: var(--accent);
  }

  .message.warning {
    background: var(--warning-soft);
    color: var(--warning);
  }

  .results-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .result-card {
    border-radius: 22px;
    padding: 18px;
    display: grid;
    gap: 18px;
    animation: rise 0.75s ease both;
    transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
  }

  .results-grid .result-card:nth-child(2) {
    animation-delay: 0.04s;
  }

  .results-grid .result-card:nth-child(3) {
    animation-delay: 0.08s;
  }

  .results-grid .result-card:nth-child(4) {
    animation-delay: 0.12s;
  }

  .result-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .result-title {
    margin: 0;
    font-size: 1.08rem;
  }

  .result-meta {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .answers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
    gap: 8px;
  }

  .score-summary {
    display: grid;
    gap: 14px;
    padding: 16px;
    border-radius: 18px;
    background: rgba(31, 111, 95, 0.08);
    border: 1px solid rgba(31, 111, 95, 0.14);
  }

  .score-overview {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .score-pill,
  .score-category-card {
    border-radius: 8px;
    padding: 11px 12px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(59, 48, 36, 0.08);
  }

  .score-label,
  .score-category-name {
    color: var(--muted);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .score-value,
  .score-category-value {
    margin-top: 4px;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--filled);
  }

  .score-category-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
  }

  .results-banner {
    grid-column: 1 / -1;
  }

  .scan-warning-list {
    margin: 8px 0 0;
    padding-left: 18px;
  }

  .scan-warning-list li {
    margin-top: 4px;
  }

  .study-plan-shell {
    display: grid;
    gap: 16px;
  }

  .study-plan-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }

  .study-plan-card {
    display: grid;
    gap: 16px;
    align-content: start;
  }

  .study-plan-header {
    display: grid;
    gap: 6px;
  }

  .study-plan-copy {
    margin: 0;
    color: var(--muted);
    font-size: 0.93rem;
    line-height: 1.5;
  }

  .study-category-list,
  .study-strategy-list,
  .study-module-list {
    display: grid;
    gap: 10px;
    align-content: start;
  }

  .study-category-card,
  .study-strategy-card,
  .study-module-card {
    border-radius: 16px;
    border: 1px solid rgba(59, 48, 36, 0.08);
    background: rgba(255, 255, 255, 0.72);
  }

  .study-category-card {
    padding: 14px;
    display: grid;
    gap: 12px;
  }

  .study-category-head,
  .study-module-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .study-category-title,
  .study-module-title {
    margin: 0;
    font-size: 0.96rem;
  }

  .study-category-score,
  .study-module-subtitle {
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .study-category-reason {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
    line-height: 1.55;
  }

  .study-module-card,
  .study-strategy-card {
    padding: 12px 14px;
  }

  .study-priority {
    padding: 7px 10px;
    border-radius: 999px;
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .study-priority.high {
    background: rgba(182, 71, 71, 0.12);
    color: var(--danger);
  }

  .study-priority.medium {
    background: rgba(158, 113, 54, 0.14);
    color: #8b5a1f;
  }

  .study-priority.low {
    background: rgba(31, 111, 95, 0.12);
    color: var(--accent);
  }

  .study-strategy-title {
    margin: 0;
    font-size: 0.92rem;
  }

  .answer-card {
    border-radius: 16px;
    padding: 10px;
    min-height: 66px;
    display: grid;
    align-content: center;
    gap: 6px;
    border: 1px solid rgba(59, 48, 36, 0.08);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .answer-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 24px rgba(20, 54, 47, 0.08);
    border-color: rgba(31, 111, 95, 0.18);
  }

  .answer-card.blank {
    color: var(--blank);
    background: rgba(196, 184, 170, 0.12);
  }

  .answer-card.filled {
    color: var(--filled);
    background: rgba(255, 255, 255, 0.85);
  }

  .answer-card.correct {
    background: rgba(34, 197, 94, 0.18);
    border-color: rgba(34, 197, 94, 0.55);
    color: #14532d;
  }

  .answer-card.correct .answer-value {
    color: #166534;
    text-shadow: 0 0 0.5px rgba(22, 101, 52, 0.45);
  }

  .answer-card.incorrect {
    background: rgba(239, 68, 68, 0.18);
    border-color: rgba(239, 68, 68, 0.55);
    color: #7f1d1d;
  }

  .answer-card.incorrect .answer-value {
    color: #991b1b;
    text-shadow: 0 0 0.5px rgba(153, 27, 27, 0.45);
  }

  .answer-card.flagged {
    outline: 2px dashed rgba(202, 138, 4, 0.7);
    outline-offset: 2px;
  }

  .answer-card.edited {
    border-color: rgba(99, 102, 241, 0.5);
  }

  .answer-card.editing {
    border-color: rgba(31, 111, 95, 0.6);
    box-shadow: 0 0 0 3px rgba(31, 111, 95, 0.15);
  }

  .answer-edit-input {
    width: 28px;
    height: 28px;
    text-align: center;
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    border: none;
    background: transparent;
    outline: none;
    padding: 0;
    color: inherit;
    caret-color: var(--accent, #1f6f5f);
  }

  .answer-edited-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(99, 102, 241, 0.7);
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 2px;
  }

  .answer-card-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .answer-flag-btn {
    appearance: none;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 6px;
    opacity: 0.45;
    transition: opacity 0.15s ease, background 0.15s ease, transform 0.15s ease;
  }

  .answer-flag-btn:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.05);
  }

  .answer-flag-btn.is-flagged {
    opacity: 1;
    background: rgba(202, 138, 4, 0.18);
    transform: scale(1.05);
  }

  .entry-mode-toggle {
    display: inline-flex;
    border: 1px solid rgba(31, 111, 95, 0.25);
    border-radius: 999px;
    padding: 3px;
    background: rgba(255, 255, 255, 0.7);
    align-self: flex-start;
  }

  .entry-mode-toggle button {
    appearance: none;
    border: none;
    background: transparent;
    padding: 7px 16px;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .entry-mode-toggle button.active {
    background: var(--accent, #1f6f5f);
    color: #fff;
  }

  .manual-entry-section {
    display: grid;
    gap: 10px;
  }

  .manual-entry-section h4 {
    margin: 0;
    font-size: 0.95rem;
  }

  .manual-entry-section textarea {
    width: 100%;
    min-height: 70px;
    border-radius: 12px;
    padding: 10px 12px;
    border: 1px solid rgba(59, 48, 36, 0.18);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.95rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    resize: vertical;
  }

  .manual-entry-counter {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .manual-entry-counter.complete {
    color: #166534;
    font-weight: 600;
  }

  .answer-question {
    font-size: 0.84rem;
    color: var(--muted);
  }

  .answer-value {
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  .admin-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
  }

  .saved-tests {
    display: grid;
    gap: 14px;
  }

  .preview-card {
    border-radius: 22px;
    padding: 18px;
    display: grid;
    gap: 16px;
    background: var(--surface);
    backdrop-filter: blur(18px);
    border: 1px solid rgba(255, 255, 255, 0.58);
    box-shadow: var(--shadow-soft);
    animation: rise 0.8s ease both;
  }

  .preview-image {
    width: 100%;
    max-height: 520px;
    object-fit: contain;
    border-radius: 8px;
    border: 1px solid rgba(59, 48, 36, 0.08);
    background: rgba(255, 255, 255, 0.72);
  }

  .preview-code {
    margin: 0;
    border-radius: 8px;
    padding: 18px;
    overflow: auto;
    background: rgba(32, 28, 23, 0.92);
    color: #f7f3ee;
    font-size: 0.88rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .endpoint-list {
    display: grid;
    gap: 10px;
  }

  .endpoint-item {
    display: grid;
    gap: 6px;
    padding: 13px 14px;
    border-radius: 18px;
    background: var(--surface-soft);
    border: 1px solid rgba(59, 48, 36, 0.08);
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }

  .endpoint-item:hover {
    transform: translateY(-2px);
    border-color: rgba(13, 124, 102, 0.2);
    background: #ffffff;
  }

  .endpoint-item strong {
    font-size: 0.95rem;
  }

  .endpoint-url {
    color: var(--muted);
    font-size: 0.84rem;
    word-break: break-word;
  }

  .saved-test-card {
    border-radius: 18px;
    padding: 16px;
    display: grid;
    gap: 12px;
  }

  .saved-test-title {
    margin: 0;
    font-size: 1rem;
  }

  .saved-test-date {
    color: var(--muted);
    font-size: 0.88rem;
  }

  .saved-test-sections {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .saved-section-pill {
    border-radius: 999px;
    padding: 10px 12px;
    background: rgba(32, 28, 23, 0.05);
    font-size: 0.88rem;
    color: var(--muted);
  }

  .empty-state {
    padding: 26px 18px;
    border-radius: 22px;
    border: 1px dashed rgba(59, 48, 36, 0.18);
    color: var(--muted);
    text-align: center;
    background: var(--surface);
  }

  .quiet-button {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-weight: 700;
    text-align: left;
  }

  .quiet-button:hover {
    color: var(--text);
  }

  /* ─── Auth modal ─────────────────────────────────── */
  .auth-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(10, 30, 26, 0.55);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 20px;
  }

  .auth-modal {
    background: #fff;
    border-radius: 24px;
    padding: 32px;
    width: 100%;
    max-width: 420px;
    display: grid;
    gap: 20px;
    box-shadow: 0 24px 64px rgba(10, 30, 26, 0.22);
  }

  .auth-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 2px solid rgba(59, 48, 36, 0.1);
    padding-bottom: 0;
  }

  .auth-tab {
    appearance: none;
    border: none;
    background: transparent;
    padding: 8px 18px;
    font-weight: 700;
    font-size: 0.95rem;
    cursor: pointer;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color 0.15s, border-color 0.15s;
  }

  .auth-tab.active {
    color: var(--accent, #1f6f5f);
    border-bottom-color: var(--accent, #1f6f5f);
  }

  .auth-form {
    display: grid;
    gap: 14px;
  }

  .auth-close {
    appearance: none;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 1.3rem;
    color: var(--muted);
    justify-self: end;
    line-height: 1;
    padding: 2px 6px;
  }

  /* ─── User chip in header ──────────────────────────── */
  .user-chip {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .user-avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--accent, #1f6f5f);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 0.9rem;
    flex-shrink: 0;
  }

  .user-name {
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--text);
  }

  .user-role-badge {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ─── History panel ───────────────────────────────── */
  .history-panel {
    display: grid;
    gap: 12px;
  }

  .history-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(59, 48, 36, 0.08);
  }

  .history-meta {
    display: grid;
    gap: 2px;
  }

  .history-test {
    font-weight: 700;
    font-size: 0.9rem;
  }

  .history-date {
    font-size: 0.78rem;
    color: var(--muted);
  }

  .history-source {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: rgba(59, 48, 36, 0.07);
    padding: 3px 8px;
    border-radius: 999px;
  }

  /* ─── Educator table ──────────────────────────────── */
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .data-table th {
    text-align: left;
    padding: 8px 12px;
    color: var(--muted);
    font-weight: 700;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 2px solid rgba(59, 48, 36, 0.1);
  }

  .data-table td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(59, 48, 36, 0.07);
    vertical-align: top;
  }

  .data-table tr:last-child td {
    border-bottom: none;
  }

  .role-select {
    font-size: 0.8rem;
    border: 1px solid rgba(59, 48, 36, 0.18);
    border-radius: 6px;
    padding: 3px 6px;
    background: #fff;
    cursor: pointer;
  }

  .email-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 18px;
    border-radius: 999px;
    border: 1.5px solid var(--accent, #1f6f5f);
    background: transparent;
    color: var(--accent, #1f6f5f);
    font-weight: 700;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .email-btn:hover:not(:disabled) {
    background: var(--accent, #1f6f5f);
    color: #fff;
  }

  .email-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .analytics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }

  .analytics-card {
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(59, 48, 36, 0.08);
    border-radius: 16px;
    padding: 16px 18px;
    display: grid;
    gap: 4px;
  }

  .analytics-value {
    font-size: 1.8rem;
    font-weight: 800;
    color: var(--accent, #1f6f5f);
    line-height: 1.1;
  }

  .analytics-label {
    font-size: 0.8rem;
    color: var(--muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .section-score-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid rgba(59, 48, 36, 0.07);
    font-size: 0.875rem;
  }

  .section-score-row:last-child {
    border-bottom: none;
  }

  .educator-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 2px solid rgba(59, 48, 36, 0.1);
    margin-bottom: 20px;
  }

  .educator-tab {
    appearance: none;
    border: none;
    background: transparent;
    padding: 8px 18px;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color 0.15s, border-color 0.15s;
  }

  .educator-tab.active {
    color: var(--accent, #1f6f5f);
    border-bottom-color: var(--accent, #1f6f5f);
  }

  .score-report-head {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    align-items: stretch;
    scroll-margin-top: 24px;
    border-radius: 24px;
  }

  .results-action-bar {
    position: sticky;
    top: 12px;
    z-index: 12;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(12px);
  }

  .results-action-copy {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .score-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
    width: 100%;
  }

  .score-kpi {
    min-width: 0;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--surface-soft);
  }

  .score-kpi-label {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .score-kpi-value {
    margin-top: 6px;
    font-size: clamp(1.35rem, 2.4vw, 1.75rem);
    font-weight: 900;
    color: var(--filled);
    line-height: 1.05;
  }

  .scan-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    margin-top: 14px;
  }

  .scan-summary-card {
    min-width: 0;
    padding: 12px;
    border-radius: 18px;
    background: var(--surface-soft);
    border: 1px solid var(--line);
  }

  .scan-summary-label {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .scan-summary-value {
    margin-top: 4px;
    font-size: clamp(1.05rem, 2vw, 1.25rem);
    font-weight: 900;
    line-height: 1.15;
  }

  .section-status {
    border-radius: 999px;
    padding: 8px 10px;
    font-size: 0.78rem;
    font-weight: 900;
  }

  .section-status.good {
    background: var(--accent-soft);
    color: var(--accent-strong);
  }

  .section-status.review {
    background: var(--warning-soft);
    color: var(--warning);
  }

  .section-status.poor {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .low-confidence-card {
    display: grid;
    gap: 10px;
    padding: 16px;
    border-radius: 18px;
    background: var(--warning-soft);
    color: var(--warning);
  }

  .answer-review {
    display: grid;
    gap: 14px;
  }

  .answer-review summary {
    cursor: pointer;
    width: fit-content;
    color: var(--accent);
    font-weight: 800;
  }

  .answer-review summary:focus {
    outline: 3px solid rgba(15, 118, 110, 0.18);
    outline-offset: 4px;
    border-radius: 6px;
  }

  .loading-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(15, 23, 42, 0.42);
    backdrop-filter: blur(10px);
    animation: fadeIn 0.18s ease both;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(15, 23, 42, 0.46);
    backdrop-filter: blur(10px);
    animation: fadeIn 0.18s ease both;
  }

  .login-modal {
    width: min(430px, 100%);
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow);
    padding: 22px;
    display: grid;
    gap: 18px;
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
  }

  .icon-button {
    border: 0;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: var(--surface-soft);
    color: var(--muted);
    cursor: pointer;
    font-size: 1.25rem;
    line-height: 1;
  }

  .loading-modal {
    width: min(440px, 100%);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.62);
    background: #ffffff;
    box-shadow: var(--shadow);
    padding: 24px;
    display: grid;
    gap: 18px;
    text-align: center;
  }

  .loading-ring {
    width: 54px;
    height: 54px;
    margin: 0 auto;
    border-radius: 50%;
    border: 5px solid var(--accent-soft);
    border-top-color: var(--accent);
    animation: spin 0.85s linear infinite;
  }

  .loading-title {
    margin: 0;
    font-size: 1.25rem;
  }

  .loading-copy {
    margin: 0;
    color: var(--muted);
    line-height: 1.55;
  }

  .modal-steps {
    display: grid;
    gap: 8px;
    text-align: left;
  }

  .modal-step {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--surface-soft);
    color: var(--muted);
    font-size: 0.9rem;
    opacity: 0.46;
    transform: translateX(-4px);
    transition: opacity 0.25s ease, transform 0.25s ease, background 0.25s ease, color 0.25s ease;
  }

  .modal-step.active {
    background: var(--accent-soft);
    color: var(--accent-strong);
    opacity: 1;
    transform: translateX(0);
  }

  .modal-step.complete {
    opacity: 0.78;
    transform: translateX(0);
  }

  .modal-step-dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: currentColor;
    flex: 0 0 auto;
    opacity: 0.42;
  }

  .modal-step.active .modal-step-dot {
    opacity: 1;
    animation: pulseDot 0.9s ease-in-out infinite;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(22px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes breathe {
    0%,
    100% {
      transform: scale(1) translate3d(0, 0, 0);
      opacity: 0.7;
    }

    50% {
      transform: scale(1.08) translate3d(-10px, 12px, 0);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 0.001ms !important;
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes pulseDot {
    0%,
    100% {
      transform: scale(0.9);
      opacity: 0.55;
    }

    50% {
      transform: scale(1.28);
      opacity: 1;
    }
  }

  @media (max-width: 980px) {
    .hero-grid,
    .results-grid,
    .admin-grid,
    .study-plan-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .app-shell {
      padding: 14px 12px 36px;
    }

    .hero-card,
    .panel-card,
    .result-card {
      padding: 16px;
      border-radius: 8px;
    }

    .app-header {
      align-items: flex-start;
    }

    .header-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .hero-title {
      font-size: 2rem;
    }

    .panel-head,
    .result-head {
      flex-direction: column;
      align-items: flex-start;
    }

    .answers-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .saved-test-sections {
      grid-template-columns: 1fr;
    }

    .photo-checklist-grid {
      grid-template-columns: 1fr;
    }

    .score-overview,
    .score-category-grid,
    .scan-summary,
    .photo-guide {
      grid-template-columns: 1fr;
    }

    .results-action-bar {
      position: static;
      align-items: flex-start;
      flex-direction: column;
    }

    .loading-modal {
      padding: 20px;
    }
  }

  /* ─── Landing Page ──────────────────────────────────── */

  .landing {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .landing-bg {
    position: fixed;
    inset: 0;
    z-index: 0;
    background:
      radial-gradient(ellipse 80% 60% at 20% 10%, rgba(13,124,102,0.12) 0%, transparent 60%),
      radial-gradient(ellipse 60% 50% at 80% 80%, rgba(13,124,102,0.08) 0%, transparent 55%),
      var(--bg);
    pointer-events: none;
  }

  .landing-bg-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0;
    animation: orbFloat 12s ease-in-out infinite, fadeIn 1.5s ease forwards;
  }

  .landing-bg-orb:nth-child(1) {
    width: 420px; height: 420px;
    top: -80px; left: -100px;
    background: rgba(13,124,102,0.15);
    animation-delay: 0s;
  }

  .landing-bg-orb:nth-child(2) {
    width: 340px; height: 340px;
    bottom: -60px; right: -80px;
    background: rgba(13,124,102,0.10);
    animation-delay: 4s;
  }

  .landing-bg-orb:nth-child(3) {
    width: 200px; height: 200px;
    top: 40%; left: 55%;
    background: rgba(37,99,235,0.08);
    animation-delay: 8s;
  }

  @keyframes orbFloat {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(20px, -15px) scale(1.05); }
    66% { transform: translate(-10px, 10px) scale(0.97); }
  }

  .landing-header {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24px 40px;
    animation: landSlideDown 0.7s ease both;
  }

  @keyframes landSlideDown {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .landing-header .brand-mark {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .landing-header .brand-logo {
    width: 42px;
    height: 42px;
    border-radius: 10px;
  }

  .landing-header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .landing-hero {
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 24px 60px;
    gap: 32px;
  }

  .landing-hero-content {
    max-width: 680px;
    animation: landRise 0.9s ease both;
    animation-delay: 0.15s;
  }

  @keyframes landRise {
    from { opacity: 0; transform: translateY(36px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .landing-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    border-radius: 100px;
    margin-bottom: 24px;
  }

  .landing-badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulseDot 2s ease-in-out infinite;
  }

  .landing-title {
    font-size: clamp(2.4rem, 5.5vw, 3.6rem);
    font-weight: 800;
    line-height: 1.1;
    color: var(--text);
    letter-spacing: -0.03em;
    margin: 0 0 20px;
  }

  .landing-title-accent {
    background: linear-gradient(135deg, var(--accent), #10b981);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .landing-subtitle {
    font-size: clamp(1.05rem, 2vw, 1.2rem);
    color: var(--muted);
    line-height: 1.6;
    margin: 0 auto 36px;
    max-width: 540px;
  }

  .landing-cta-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .landing-cta-primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 32px;
    background: linear-gradient(135deg, var(--accent), var(--accent-strong));
    color: #fff;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 4px 20px rgba(13,124,102,0.3);
  }

  .landing-cta-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(13,124,102,0.4);
  }

  .landing-cta-secondary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 28px;
    background: var(--surface-strong);
    color: var(--text);
    font-size: 1rem;
    font-weight: 600;
    border: 1.5px solid var(--line);
    border-radius: 12px;
    cursor: pointer;
    transition: transform 0.2s, border-color 0.2s;
  }

  .landing-cta-secondary:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
  }

  .landing-features {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    max-width: 840px;
    width: 100%;
    margin: 0 auto;
    padding: 0 24px;
    animation: landRise 0.9s ease both;
    animation-delay: 0.4s;
  }

  .landing-feature-card {
    background: var(--surface);
    backdrop-filter: blur(16px);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 28px 24px;
    text-align: center;
    transition: transform 0.25s, box-shadow 0.25s;
  }

  .landing-feature-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-soft);
  }

  .landing-feature-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 1.3rem;
    margin-bottom: 14px;
  }

  .landing-feature-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text);
    margin: 0 0 6px;
  }

  .landing-feature-desc {
    font-size: 0.85rem;
    color: var(--muted);
    line-height: 1.5;
    margin: 0;
  }

  .landing-footer {
    position: relative;
    z-index: 2;
    text-align: center;
    padding: 40px 24px 28px;
    color: var(--muted);
    font-size: 0.8rem;
    animation: landRise 0.9s ease both;
    animation-delay: 0.6s;
  }

  @media (max-width: 640px) {
    .landing-header {
      padding: 16px 18px;
    }

    .landing-features {
      grid-template-columns: 1fr;
      max-width: 400px;
    }

    .landing-cta-row {
      flex-direction: column;
    }

    .landing-cta-primary,
    .landing-cta-secondary {
      width: 100%;
      justify-content: center;
    }
  }

  @media (max-width: 980px) {
    .landing-features {
      grid-template-columns: 1fr 1fr;
    }
  }

  /* ─── Unified Admin Panel ───────────────────────────── */

  .admin-panel {
    animation: rise 0.5s ease both;
  }

  .admin-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 8px;
  }

  .admin-panel-title {
    font-size: 1.35rem;
    font-weight: 800;
    color: var(--text);
    margin: 0;
  }

  .admin-panel-subtitle {
    font-size: 0.88rem;
    color: var(--muted);
    margin: 4px 0 0;
  }

  .admin-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 2px solid var(--line);
    margin-bottom: 24px;
    overflow-x: auto;
  }

  .admin-tab {
    appearance: none;
    border: none;
    background: transparent;
    padding: 10px 20px;
    font-weight: 700;
    font-size: 0.88rem;
    cursor: pointer;
    color: var(--muted);
    border-bottom: 2.5px solid transparent;
    margin-bottom: -2px;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }

  .admin-tab:hover {
    color: var(--text);
  }

  .admin-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .admin-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin-bottom: 24px;
  }

  .admin-kpi-card {
    background: var(--surface-strong);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .admin-kpi-value {
    font-size: 2rem;
    font-weight: 800;
    color: var(--accent);
    line-height: 1.1;
  }

  .admin-kpi-label {
    font-size: 0.78rem;
    color: var(--muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .admin-scores-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }

  .admin-score-card {
    background: var(--surface-strong);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px 16px;
    text-align: center;
  }

  .admin-score-section {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }

  .admin-score-value {
    font-size: 1.6rem;
    font-weight: 800;
    color: var(--text);
  }

  .admin-week-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    font-size: 0.88rem;
  }

  .admin-week-row:last-child {
    border-bottom: none;
  }

  .admin-week-bar {
    height: 6px;
    background: var(--accent);
    border-radius: 3px;
    flex: 1;
    max-width: 180px;
    margin: 0 12px;
  }

  .admin-list {
    display: grid;
    gap: 10px;
  }

  .admin-list-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    background: var(--surface-strong);
    border: 1px solid var(--line);
    border-radius: 12px;
    transition: box-shadow 0.2s;
  }

  .admin-list-item:hover {
    box-shadow: var(--shadow-soft);
  }

  .admin-list-avatar {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 0.88rem;
    flex-shrink: 0;
  }

  .admin-list-info {
    flex: 1;
    min-width: 0;
  }

  .admin-list-name {
    font-weight: 700;
    font-size: 0.92rem;
    color: var(--text);
  }

  .admin-list-meta {
    font-size: 0.8rem;
    color: var(--muted);
    margin-top: 2px;
  }

  .admin-list-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 100px;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .admin-list-badge.student {
    background: var(--info-soft);
    color: var(--info);
  }

  .admin-list-badge.educator {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .admin-list-stat {
    text-align: right;
    flex-shrink: 0;
  }

  .admin-list-stat-value {
    font-weight: 800;
    font-size: 1rem;
    color: var(--text);
  }

  .admin-list-stat-label {
    font-size: 0.72rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .admin-result-card {
    padding: 16px 18px;
    background: var(--surface-strong);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: grid;
    gap: 10px;
  }

  .admin-result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .admin-result-student {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--text);
  }

  .admin-result-date {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .admin-result-test {
    font-size: 0.85rem;
    color: var(--muted);
  }

  .admin-result-scores {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .admin-result-score-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 100px;
    background: var(--accent-soft);
    font-size: 0.82rem;
    font-weight: 600;
  }

  .admin-result-score-pill .section-label {
    color: var(--muted);
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.03em;
  }

  .admin-result-score-pill .section-value {
    color: var(--accent);
    font-weight: 800;
  }

  .admin-result-source {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 100px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--surface-soft);
    color: var(--muted);
    border: 1px solid var(--line);
  }

  .admin-setup-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .admin-test-library-item {
    padding: 16px;
    background: var(--surface-soft);
    border: 1px solid var(--line);
    border-radius: 12px;
    display: grid;
    gap: 8px;
  }

  .admin-test-library-name {
    font-weight: 700;
    font-size: 1rem;
    color: var(--text);
    margin: 0;
  }

  .admin-test-library-meta {
    font-size: 0.82rem;
    color: var(--muted);
  }

  .admin-test-library-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .admin-test-library-pill {
    padding: 4px 10px;
    border-radius: 100px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .admin-section-title {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 12px;
  }

  @media (max-width: 980px) {
    .admin-setup-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .admin-kpi-grid {
      grid-template-columns: 1fr 1fr;
    }

    .admin-result-scores {
      flex-direction: column;
    }
  }
`;

function mapAnswer(value, questionNumber) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 4) {
    return "-";
  }

  const labels = questionNumber % 2 === 1 ? ODD_LABELS : EVEN_LABELS;
  return labels[numericValue] || "-";
}

function countAnswers(sectionAnswers = []) {
  const answered = sectionAnswers.filter(
    (value) => value !== null && value !== undefined && value !== ""
  ).length;

  return {
    answered,
    blank: sectionAnswers.length - answered,
  };
}

function summarizeResults(results) {
  if (!results) {
    return {
      answered: 0,
      blank: 0,
      total: SECTION_CONFIG.reduce((sum, section) => sum + section.total, 0),
      percentAnswered: 0,
      hasManyBlanks: false,
      isLowConfidence: false,
    };
  }

  const totals = SECTION_CONFIG.reduce(
    (summary, { key, total }) => {
      const answers = Array.isArray(results[key]) ? results[key] : [];
      const counts = countAnswers(answers);
      summary.answered += counts.answered;
      summary.blank += total - counts.answered;
      summary.total += total;
      return summary;
    },
    { answered: 0, blank: 0, total: 0 }
  );

  const percentAnswered = totals.total ? totals.answered / totals.total : 0;

  return {
    ...totals,
    percentAnswered,
    hasManyBlanks: percentAnswered < 0.75,
    isLowConfidence: totals.answered < 10 || percentAnswered < 0.08,
  };
}

function getSectionScanStatus(counts, total) {
  const answeredPercent = total ? counts.answered / total : 0;

  if (counts.answered === 0 || answeredPercent < 0.2) {
    return {
      label: "Needs a new photo",
      className: "poor",
    };
  }

  if (answeredPercent < 0.8) {
    return {
      label: "Needs review",
      className: "review",
    };
  }

  if (counts.blank > 0) {
    return {
      label: "Some blanks",
      className: "review",
    };
  }

  return {
    label: "Looks good",
    className: "good",
  };
}

function parseJsonLike(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeDetectedAnswer(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const cleaned = String(value).trim().toUpperCase();
  if (!cleaned || cleaned === "NULL" || cleaned === "-") {
    return null;
  }

  const labelMap = {
    A: 1,
    B: 2,
    C: 3,
    D: 4,
    F: 1,
    G: 2,
    H: 3,
    J: 4,
  };

  if (labelMap[cleaned]) {
    return labelMap[cleaned];
  }

  const numericValue = Number(cleaned);
  return Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= 4
    ? numericValue
    : null;
}

function coerceSectionAnswers(value, total) {
  const parsedValue = parseJsonLike(value);
  let answers = null;

  if (Array.isArray(parsedValue)) {
    answers = parsedValue;
  } else if (parsedValue && typeof parsedValue === "object") {
    const numericKeys = Object.keys(parsedValue)
      .map((key) => Number(key))
      .filter((key) => Number.isInteger(key))
      .sort((left, right) => left - right);

    if (numericKeys.length) {
      const zeroBased = numericKeys.includes(0);
      answers = Array(total).fill(null);

      numericKeys.forEach((key) => {
        const index = zeroBased ? key : key - 1;
        if (index >= 0 && index < total) {
          answers[index] = parsedValue[key] ?? parsedValue[String(key)];
        }
      });
    }
  }

  if (!answers) {
    return null;
  }

  return Array.from({ length: total }, (_, index) =>
    normalizeDetectedAnswer(answers[index])
  );
}

function normalizeAnswerKeyPayload(payload, depth = 0) {
  if (depth > 4) {
    return null;
  }

  const parsedPayload = parseJsonLike(payload);

  if (Array.isArray(parsedPayload)) {
    for (const item of parsedPayload) {
      const normalized = normalizeAnswerKeyPayload(item, depth + 1);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  if (!parsedPayload || typeof parsedPayload !== "object") {
    return null;
  }

  const normalizedSections = {};
  const hasAllSections = SECTION_CONFIG.every(({ key, total }) => {
    const answers = coerceSectionAnswers(parsedPayload[key], total);
    if (!answers) {
      return false;
    }

    normalizedSections[key] = answers;
    return true;
  });

  if (hasAllSections) {
    return {
      ...normalizedSections,
      _status: parsedPayload._status || "ok",
      _warnings: Array.isArray(parsedPayload._warnings)
        ? parsedPayload._warnings
        : [],
    };
  }

  for (const key of ["json", "body", "data", "result", "results", "response"]) {
    if (key in parsedPayload) {
      const normalized = normalizeAnswerKeyPayload(parsedPayload[key], depth + 1);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function formatSavedDate(isoDate) {
  try {
    return new Date(isoDate).toLocaleString();
  } catch {
    return isoDate;
  }
}

function getDisplayedCategoryScores(sectionKey, sectionScore) {
  const config = PRACTICE_TEST_1_SCORING[sectionKey];
  if (!config || !sectionScore) {
    return [];
  }

  return config.categoryOrder
    .map((categoryCode) => {
      const sourceScore = config.groupedCategories[categoryCode]
        ? sectionScore.groupedCategoryScores[categoryCode]
        : sectionScore.categoryScores[categoryCode];

      if (!sourceScore) {
        return null;
      }

      return {
        code: categoryCode,
        label: config.categoryDisplayNames[categoryCode] || categoryCode,
        ...sourceScore,
      };
    })
    .filter(Boolean);
}

async function readApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return {
      type: "json",
      contentType,
      data: await response.json(),
    };
  }

  if (contentType.startsWith("image/")) {
    const imageBlob = await response.blob();
    return {
      type: "image",
      contentType,
      data: URL.createObjectURL(imageBlob),
    };
  }

  const rawText = await response.text();

  try {
    return {
      type: "json",
      contentType: contentType || "text/plain",
      data: JSON.parse(rawText),
    };
  } catch {
    return {
      type: "text",
      contentType: contentType || "text/plain",
      data: rawText,
    };
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload.detail || payload.error || `Request failed with status ${response.status}`
    );
  }

  return payload;
}

function buildBasicAuthHeader(username, password) {
  if (typeof window === "undefined") {
    return "";
  }

  return `Basic ${window.btoa(`${username}:${password}`)}`;
}

export default function App() {
  const uploadRef = useRef(null);
  const resultsRef = useRef(null);
  const answersRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFilePreviewUrl, setSelectedFilePreviewUrl] = useState("");
  const [fileInputResetKey, setFileInputResetKey] = useState(0);
  const [isAnswerReviewOpen, setIsAnswerReviewOpen] = useState(false);
  const [selectedTestId, setSelectedTestId] = useState("");
  const [availableTests, setAvailableTests] = useState([]);
  const [testsLoading, setTestsLoading] = useState(false);
  const [testsError, setTestsError] = useState("");
  const [results, setResults] = useState(null);
  const [apiPreview, setApiPreview] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState("");

  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminCredentials, setAdminCredentials] = useState({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });
  const [adminError, setAdminError] = useState("");
  const [adminSuccess, setAdminSuccess] = useState("");
  const [testName, setTestName] = useState("");
  const [scoringRubricFile, setScoringRubricFile] = useState(null);
  const [recommendationFiles, setRecommendationFiles] = useState({
    english: null,
    math: null,
    reading: null,
    science: null,
  });
  const [savedTests, setSavedTests] = useState([]);
  const [isSavingTest, setIsSavingTest] = useState(false);
  const [adminUploadResetKey, setAdminUploadResetKey] = useState(0);

  const [entryMode, setEntryMode] = useState("scan");
  const [manualAnswers, setManualAnswers] = useState(() =>
    SECTION_CONFIG.reduce((acc, { key }) => {
      acc[key] = "";
      return acc;
    }, {})
  );
  const [resultsSource, setResultsSource] = useState(null);
  const [flaggedAnswers, setFlaggedAnswers] = useState(() => new Set());
  const [editingCell, setEditingCell] = useState(null); // {section, questionNumber}
  const [editedCells, setEditedCells] = useState(() => new Set());

  // Auth
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState("login"); // "login" | "register"
  const [authForm, setAuthForm] = useState({ username: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Student history
  const [myResults, setMyResults] = useState(null);
  const [myResultsLoading, setMyResultsLoading] = useState(false);

  // Educator view
  const [educatorTab, setEducatorTab] = useState("overview"); // "overview" | "tests" | "students" | "results"
  const [educatorUsers, setEducatorUsers] = useState(null);
  const [educatorResults, setEducatorResults] = useState(null);
  const [educatorAnalytics, setEducatorAnalytics] = useState(null);
  const [educatorLoading, setEducatorLoading] = useState(false);

  // Email results
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState(""); // "" | "sent" | "error"

  const selectedTest = useMemo(
    () =>
      availableTests.find((test) => String(test.id) === String(selectedTestId)) ||
      null,
    [availableTests, selectedTestId]
  );
  const practiceTest1ScoringState = useMemo(() => {
    const practiceTestReference = `${selectedTest?.name || ""} ${
      selectedTest?.sourceFilename || ""
    }`;
    const isPracticeTest1 = matchesPracticeTest1(practiceTestReference);

    if (!results || !isPracticeTest1) {
      return {
        isPracticeTest1,
        scores: null,
        error: "",
      };
    }

    try {
      return {
        isPracticeTest1,
        scores: scorePracticeTest1(results),
        error: "",
      };
    } catch (scoringError) {
      console.error("Score calculation failed", scoringError);
      return {
        isPracticeTest1,
        scores: null,
        error: "We could not calculate this test score yet.",
      };
    }
  }, [results, selectedTest]);
  const studyRecommendations = useMemo(() => {
    if (!practiceTest1ScoringState.scores) {
      return null;
    }

    return generateRecommendations(practiceTest1ScoringState.scores);
  }, [practiceTest1ScoringState.scores]);
  const resultReadSummary = useMemo(() => summarizeResults(results), [results]);
  const scoreSummaryItems = useMemo(
    () =>
      SECTION_CONFIG.map(({ key, title }) => {
        const sectionScore = practiceTest1ScoringState.scores?.[key];
        const answers = Array.isArray(results?.[key]) ? results[key] : [];
        const counts = countAnswers(answers);

        return {
          key,
          title,
          primary: resultReadSummary.isLowConfidence
            ? "Review"
            : sectionScore
              ? sectionScore.scaleScore
              : counts.answered,
          label: resultReadSummary.isLowConfidence
            ? "Scan quality"
            : sectionScore
              ? "ACT score"
              : "Answered",
          meta: resultReadSummary.isLowConfidence
            ? "Try a clearer photo"
            : sectionScore
            ? `${sectionScore.rawScore} of ${sectionScore.totalPossible} questions correct`
            : `${counts.blank} blank`,
        };
      }),
    [practiceTest1ScoringState.scores, resultReadSummary.isLowConfidence, results]
  );

  // ─── Auth handlers ─────────────────────────────────────
  useEffect(() => {
    fetch(AUTH_ME_ENDPOINT, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((user) => setCurrentUser(user || null))
      .catch(() => setCurrentUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const openAuthModal = (tab = "login") => {
    setAuthTab(tab);
    setAuthForm({ username: "", email: "", password: "" });
    setAuthError("");
    setAuthSuccess("");
    setIsAuthModalOpen(true);
  };

  const handleAuthFormChange = (field, value) => {
    setAuthForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    setAuthSubmitting(true);
    const isRegister = authTab === "register";
    const url = isRegister ? AUTH_REGISTER_ENDPOINT : AUTH_LOGIN_ENDPOINT;
    const body = isRegister
      ? { username: authForm.username, email: authForm.email, password: authForm.password }
      : { username: authForm.username, password: authForm.password };
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAuthError(data.detail || "Something went wrong. Please try again.");
        return;
      }
      if (isRegister) {
        // Don't auto-login — switch to login tab with success message
        setAuthTab("login");
        setAuthForm({ username: authForm.username, email: "", password: "" });
        setAuthSuccess("Account created! Please sign in with your credentials.");
        // Log out the cookie that the backend set during registration
        fetch(AUTH_LOGOUT_ENDPOINT, { method: "POST", credentials: "include" }).catch(() => {});
      } else {
        setCurrentUser(data);
        setIsAuthModalOpen(false);
      }
    } catch {
      setAuthError("Could not reach the server. Check your connection.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleUserLogout = async () => {
    await fetch(AUTH_LOGOUT_ENDPOINT, { method: "POST", credentials: "include" }).catch(() => {});
    setCurrentUser(null);
    setMyResults(null);
    setEducatorUsers(null);
    setEducatorResults(null);
  };

  // ─── Student history ───────────────────────────────────
  const loadMyResults = useCallback(async () => {
    if (!currentUser) return;
    setMyResultsLoading(true);
    try {
      const response = await fetch(MY_RESULTS_ENDPOINT, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setMyResults(data.results || []);
      }
    } catch {
      /* silent */
    } finally {
      setMyResultsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && currentUser.role === "student") {
      loadMyResults();
    }
  }, [currentUser, loadMyResults]);

  // Save results (scan or manual) with scores once available
  useEffect(() => {
    if (!currentUser || !results || !resultsSource) return;
    // Wait until scoring has been attempted (scores may be null if not practice test 1)
    const scores = practiceTest1ScoringState.scores ?? null;
    fetch(SAVE_RESULT_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results,
        scores,
        testId: selectedTest?.id ?? null,
        testName: selectedTest?.name ?? null,
        source: resultsSource,
      }),
    })
      .then((r) => r.ok && loadMyResults())
      .catch(() => {});
  }, [results, resultsSource, practiceTest1ScoringState.scores]);

  // ─── Educator data ─────────────────────────────────────
  const loadEducatorData = useCallback(async () => {
    if (!currentUser || currentUser.role !== "educator") return;
    setEducatorLoading(true);
    try {
      const [usersRes, resultsRes, analyticsRes] = await Promise.all([
        fetch(ADMIN_USERS_ENDPOINT, { credentials: "include" }),
        fetch(ADMIN_ALL_RESULTS_ENDPOINT, { credentials: "include" }),
        fetch(ADMIN_ANALYTICS_ENDPOINT, { credentials: "include" }),
      ]);
      if (usersRes.ok) setEducatorUsers((await usersRes.json()).users || []);
      if (resultsRes.ok) setEducatorResults((await resultsRes.json()).results || []);
      if (analyticsRes.ok) setEducatorAnalytics(await analyticsRes.json());
    } catch {
      /* silent */
    } finally {
      setEducatorLoading(false);
    }
  }, [currentUser]);

  const handleSendEmail = async () => {
    if (!currentUser || emailSending) return;
    setEmailSending(true);
    setEmailStatus("");
    try {
      const response = await fetch(EMAIL_RESULTS_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testName: selectedTest?.name ?? null,
          answers: results,
          scores: practiceTest1ScoringState.scores ?? null,
          createdAt: new Date().toISOString().slice(0, 10),
        }),
      });
      setEmailStatus(response.ok ? "sent" : "error");
    } catch {
      setEmailStatus("error");
    } finally {
      setEmailSending(false);
    }
  };

  useEffect(() => {
    if (currentUser?.role === "educator") loadEducatorData();
  }, [currentUser, loadEducatorData]);

  const handleSetUserRole = async (userId, role) => {
    await fetch(SET_USER_ROLE_ENDPOINT(userId), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }).catch(() => {});
    loadEducatorData();
  };

  const loadPublicTests = async () => {
    setTestsLoading(true);
    setTestsError("");

    try {
      const payload = await fetchJson(TESTS_ENDPOINT);
      const tests = Array.isArray(payload.tests) ? payload.tests : [];
      setAvailableTests(tests);
      setSelectedTestId((current) => {
        if (current && tests.some((test) => String(test.id) === String(current))) {
          return current;
        }

        return tests[0] ? String(tests[0].id) : "";
      });
    } catch (loadError) {
      const friendlyMessage =
        loadError.message &&
        !/failed to fetch|networkerror|load failed|request failed/i.test(loadError.message)
          ? loadError.message
          : "We could not load the test list. Please try again.";
      setTestsError(friendlyMessage);
    } finally {
      setTestsLoading(false);
    }
  };

  const loadAdminTests = async (credentials = adminCredentials) => {
    const authHeader = buildBasicAuthHeader(
      credentials.username.trim(),
      credentials.password.trim()
    );
    const payload = await fetchJson(ADMIN_TESTS_ENDPOINT, {
      headers: {
        Authorization: authHeader,
      },
    });
    setSavedTests(Array.isArray(payload.tests) ? payload.tests : []);
  };

  const loadingModal = isSavingTest
    ? {
        title: "Saving test",
        copy: "We are reading the scoring guide and study materials. This can take a little while for larger PDFs.",
        steps: [
          "Reading the scoring guide",
          "Preparing study recommendations",
          "Saving the test for students",
        ],
      }
    : {
        title: "Building your score report",
        copy: "We are reading the sheet, checking each section, and preparing your results.",
        steps: [
          "Reading answer marks",
          "Scoring each section",
          "Preparing study recommendations",
        ],
      };

  useEffect(() => {
    loadPublicTests();
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setSelectedFilePreviewUrl("");
      return undefined;
    }

    const isHeic =
      /hei[cf]/i.test(selectedFile.type) ||
      /\.hei[cf]$/i.test(selectedFile.name);

    if (isHeic) {
      setSelectedFilePreviewUrl("");
      return undefined;
    }

    const nextPreviewUrl = URL.createObjectURL(selectedFile);
    setSelectedFilePreviewUrl(nextPreviewUrl);

    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [selectedFile]);

  useEffect(() => {
    if (!results) {
      setIsAnswerReviewOpen(false);
      return undefined;
    }

    const scrollTimer = window.setTimeout(() => {
      handleViewResults();
    }, 250);

    return () => window.clearTimeout(scrollTimer);
  }, [results]);

  useEffect(() => {
    if (!isLoading && !isSavingTest) {
      setLoadingStepIndex(0);
      return undefined;
    }

    setLoadingStepIndex(0);
    const stepTimer = window.setInterval(() => {
      setLoadingStepIndex((current) => (current + 1) % loadingModal.steps.length);
    }, 1250);

    return () => window.clearInterval(stepTimer);
  }, [isLoading, isSavingTest, loadingModal.steps.length]);

  useEffect(() => {
    if (!apiPreview || apiPreview.type !== "image") {
      return undefined;
    }

    return () => {
      URL.revokeObjectURL(apiPreview.data);
    };
  }, [apiPreview]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setError("");
    setResults(null);
    setApiPreview(null);
    setUploadSuccess("");
  };

  const handleViewResults = () => {
    resultsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleBackToUpload = () => {
    uploadRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleReviewAnswers = () => {
    setIsAnswerReviewOpen(true);
    window.setTimeout(() => {
      answersRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  };

  const handleStartOver = () => {
    setSelectedFile(null);
    setResults(null);
    setApiPreview(null);
    setError("");
    setUploadSuccess("");
    setIsAnswerReviewOpen(false);
    setFileInputResetKey((current) => current + 1);
    setResultsSource(null);
    setFlaggedAnswers(new Set());
    setEditingCell(null);
    setEditedCells(new Set());
    setEmailStatus("");
    window.setTimeout(handleBackToUpload, 80);
    if (currentUser?.role === "student") loadMyResults();
  };

  const parseManualSection = (text, total) => {
    const letters = String(text || "")
      .toUpperCase()
      .replace(/[^A-DFGHJ]/g, "")
      .split("");
    const answers = Array(total).fill(null);
    for (let i = 0; i < Math.min(letters.length, total); i += 1) {
      const numeric = LETTER_TO_NUMERIC[letters[i]];
      if (numeric) {
        answers[i] = numeric;
      }
    }
    return answers;
  };

  const manualCounts = useMemo(
    () =>
      SECTION_CONFIG.reduce((acc, { key, total }) => {
        const answers = parseManualSection(manualAnswers[key], total);
        acc[key] = answers.filter((value) => value != null).length;
        return acc;
      }, {}),
    [manualAnswers]
  );

  const manualHasAny = useMemo(
    () => Object.values(manualCounts).some((count) => count > 0),
    [manualCounts]
  );

  const handleManualChange = (sectionKey, value) => {
    setManualAnswers((current) => ({ ...current, [sectionKey]: value }));
  };

  const handleManualSubmit = (event) => {
    event.preventDefault();
    if (!selectedTestId) {
      setError("Please select a test before scoring your answers.");
      return;
    }
    if (!manualHasAny) {
      setError("Type at least one answer before scoring.");
      return;
    }
    setError("");
    setUploadSuccess("");
    setApiPreview(null);
    setFlaggedAnswers(new Set());
    const payload = SECTION_CONFIG.reduce((acc, { key, total }) => {
      acc[key] = parseManualSection(manualAnswers[key], total);
      return acc;
    }, {});
    setResults(payload);
    setResultsSource("manual");
    setUploadSuccess("Your answers were scored against the answer key.");
    setIsAnswerReviewOpen(true);
    window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const toggleFlag = (sectionKey, questionNumber, detectedNumeric, detectedLetter) => {
    const flagKey = `${sectionKey}-${questionNumber}`;
    setFlaggedAnswers((current) => {
      const next = new Set(current);
      const wasFlagged = next.has(flagKey);
      if (wasFlagged) {
        next.delete(flagKey);
      } else {
        next.add(flagKey);
      }

      if (!wasFlagged) {
        const sectionConfig = PRACTICE_TEST_1_SCORING[sectionKey] || null;
        const expectedNumeric =
          sectionConfig?.answerKey?.[questionNumber] ?? null;
        fetch(FEEDBACK_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            testId: selectedTest?.id ?? null,
            testName: selectedTest?.name ?? null,
            section: sectionKey,
            questionNumber,
            detectedNumeric,
            detectedLetter,
            expectedNumeric,
            source: resultsSource || "scan",
            timestamp: new Date().toISOString(),
          }),
        }).catch(() => {
          /* fire-and-forget; ignore network errors */
        });
      }
      return next;
    });
  };

  const handleEditCommit = (sectionKey, questionNumber, rawInput) => {
    setEditingCell(null);
    const letter = String(rawInput || "").trim().toUpperCase().slice(0, 1);
    const numeric = LETTER_TO_NUMERIC[letter] ?? null;
    const index = questionNumber - 1;
    setResults((prev) => {
      if (!prev) return prev;
      const sectionAnswers = Array.isArray(prev[sectionKey])
        ? [...prev[sectionKey]]
        : [];
      sectionAnswers[index] = numeric;
      return { ...prev, [sectionKey]: sectionAnswers };
    });
    const cellKey = `${sectionKey}-${questionNumber}`;
    setEditedCells((prev) => {
      const next = new Set(prev);
      if (numeric !== null) next.add(cellKey);
      else next.delete(cellKey);
      return next;
    });
  };

  const runEndpointAction = async (actionKey) => {
    if (!selectedFile) {
      setError("Please upload an answer sheet image first.");
      return;
    }

    if (actionKey === "parse" && !selectedTestId) {
      setError("Please select a test before getting results.");
      return;
    }

    const endpoint = API_ENDPOINTS[actionKey];
    setIsLoading(true);
    setError("");
    setUploadSuccess("");
    setResults(null);
    setApiPreview(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      if (actionKey === "parse" && selectedTest) {
        formData.append("testId", String(selectedTest.id));
        formData.append("testName", selectedTest.name);
      }

      const response = await fetch(endpoint.url, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          "We could not create the score report from this image. Please try a clearer photo or try again."
        );
      }

      const payload = await readApiResponse(response);
      const normalizedResults =
        payload.type === "json" ? normalizeAnswerKeyPayload(payload.data) : null;

      if (normalizedResults) {
        setResults(normalizedResults);
        setResultsSource("scan");
        setFlaggedAnswers(new Set());
        setUploadSuccess(endpoint.successMessage);
      } else {
        setApiPreview({
          ...payload,
          endpointLabel: endpoint.label,
          endpointUrl: endpoint.url,
        });
        setError(
          "We received a response, but could not turn it into a score report yet."
        );
      }
    } catch (uploadError) {
      const friendlyMessage =
        uploadError.message &&
          !/failed to fetch|networkerror|load failed|request failed/i.test(uploadError.message)
          ? uploadError.message
          : "We could not reach the scoring service. Please check your connection and try again.";
      setError(friendlyMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (entryMode === "manual") {
      handleManualSubmit(event);
      return;
    }
    await runEndpointAction("parse");
  };

  const handleAdminCredentialChange = (event) => {
    const { name, value } = event.target;
    setAdminCredentials((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleRecommendationFileChange = (sectionKey, file) => {
    setRecommendationFiles((current) => ({
      ...current,
      [sectionKey]: file,
    }));
  };

  const handleAdminLogin = async (event) => {
    event.preventDefault();
    setAdminError("");
    setAdminSuccess("");

    try {
      await loadAdminTests(adminCredentials);
      setIsAdminAuthenticated(true);
      setIsAdminOpen(true);
      setIsLoginModalOpen(false);
      setAdminSuccess("You are signed in.");
    } catch (loginError) {
      setIsAdminAuthenticated(false);
      setSavedTests([]);
      setAdminError(
        loginError.message &&
          !/failed to fetch|networkerror|load failed|request failed/i.test(loginError.message)
          ? loginError.message
          : "We could not sign you in. Please check the details and try again."
      );
    }
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    setIsAdminOpen(false);
    setIsLoginModalOpen(false);
    setSavedTests([]);
    setAdminError("");
    setAdminSuccess("");
  };

  const handleSaveTest = async (event) => {
    event.preventDefault();
    setAdminError("");
    setAdminSuccess("");

    if (!testName.trim()) {
      setAdminError("Add a test name before saving.");
      return;
    }

    if (!scoringRubricFile) {
      setAdminError("Upload the scoring guide PDF before saving.");
      return;
    }

    const missingRecommendationSections = SECTION_CONFIG.filter(
      ({ key }) => !recommendationFiles[key]
    );
    if (missingRecommendationSections.length) {
      setAdminError(
        `Upload study-material PDFs for ${missingRecommendationSections
          .map(({ title }) => title)
          .join(", ")} before saving.`
      );
      return;
    }

    setIsSavingTest(true);

    try {
      const formData = new FormData();
      formData.append("name", testName.trim());
      formData.append("scoringRubricFile", scoringRubricFile);
      SECTION_CONFIG.forEach(({ key }) => {
        const fieldName = `${key}RecommendationFile`;
        if (recommendationFiles[key]) {
          formData.append(fieldName, recommendationFiles[key]);
        }
      });

      const authHeader = buildBasicAuthHeader(
        adminCredentials.username.trim(),
        adminCredentials.password.trim()
      );

      const payload = await fetchJson(ADMIN_IMPORT_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: authHeader,
        },
        body: formData,
      });

      const createdTest = payload.test || null;
      setTestName("");
      setScoringRubricFile(null);
      setRecommendationFiles({
        english: null,
        math: null,
        reading: null,
        science: null,
      });
      setAdminUploadResetKey((current) => current + 1);

      await loadPublicTests();
      await loadAdminTests(adminCredentials);

      if (createdTest?.id) {
        setSelectedTestId(String(createdTest.id));
      }

      setAdminSuccess(
        createdTest?.extractionSummary
          ? `Saved test. ${createdTest.extractionSummary}`
          : "Saved test and prepared the scoring and study materials."
      );
    } catch (saveError) {
      setAdminError(
        saveError.message &&
          !/failed to fetch|networkerror|load failed|request failed/i.test(saveError.message)
          ? saveError.message
          : "We could not save the test right now. Please try again."
      );
    } finally {
      setIsSavingTest(false);
    }
  };
  // ─── Landing page (unauthenticated) ────────────────
  if (!currentUser && !authLoading) {
    return (
      <div className="landing">
        <style>{styles}</style>

        <div className="landing-bg">
          <div className="landing-bg-orb" />
          <div className="landing-bg-orb" />
          <div className="landing-bg-orb" />
        </div>

        <header className="landing-header">
          <div className="brand-mark">
            <img className="brand-logo" src="/prepmedians-logo.jpg" alt="Prepmedians" />
            <div>
              <p className="brand-title" style={{ margin: 0, fontWeight: 700, fontSize: "1.05rem", color: "var(--text)" }}>Prepmedians</p>
            </div>
          </div>
          <div className="landing-header-actions">
            <button type="button" className="landing-cta-secondary" style={{ padding: "10px 22px", fontSize: "0.9rem" }} onClick={() => openAuthModal("login")}>
              Sign In
            </button>
          </div>
        </header>

        <main className="landing-hero">
          <div className="landing-hero-content">
            <div className="landing-badge">
              <span className="landing-badge-dot" />
              ACT Practice Scoring
            </div>
            <h1 className="landing-title">
              Score your ACT sheet.<br />
              <span className="landing-title-accent">Get your study plan.</span>
            </h1>
            <p className="landing-subtitle">
              Upload a photo of your completed bubble sheet or type your answers.
              Get section scores, category breakdowns, and a personalized study
              plan in seconds.
            </p>
            <div className="landing-cta-row">
              <button type="button" className="landing-cta-primary" onClick={() => openAuthModal("register")}>
                Get Started
                <span aria-hidden="true">&rarr;</span>
              </button>
              <button type="button" className="landing-cta-secondary" onClick={() => openAuthModal("login")}>
                I have an account
              </button>
            </div>
          </div>

          <div className="landing-features">
            <div className="landing-feature-card">
              <div className="landing-feature-icon" aria-hidden="true">&#x1F4F7;</div>
              <p className="landing-feature-title">Scan or Type</p>
              <p className="landing-feature-desc">Upload a photo of your answer sheet or enter answers manually.</p>
            </div>
            <div className="landing-feature-card">
              <div className="landing-feature-icon" aria-hidden="true">&#x1F4CA;</div>
              <p className="landing-feature-title">Instant Scores</p>
              <p className="landing-feature-desc">Get scaled ACT scores and per-category breakdowns instantly.</p>
            </div>
            <div className="landing-feature-card">
              <div className="landing-feature-icon" aria-hidden="true">&#x1F4D6;</div>
              <p className="landing-feature-title">Study Plan</p>
              <p className="landing-feature-desc">Receive a personalized study plan based on your weakest areas.</p>
            </div>
          </div>
        </main>

        <footer className="landing-footer">
          Prepmedians &middot; ACT practice scoring and study guidance
        </footer>

        {isAuthModalOpen ? (
          <div className="auth-backdrop" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setIsAuthModalOpen(false); }}>
            <div className="auth-modal">
              <button className="auth-close" aria-label="Close" onClick={() => setIsAuthModalOpen(false)}>&times;</button>
              <div className="auth-tabs">
                <button className={`auth-tab ${authTab === "login" ? "active" : ""}`} onClick={() => { setAuthTab("login"); setAuthError(""); }}>Sign in</button>
                <button className={`auth-tab ${authTab === "register" ? "active" : ""}`} onClick={() => { setAuthTab("register"); setAuthError(""); setAuthSuccess(""); }}>Create account</button>
              </div>
              {authSuccess ? <div className="message success">{authSuccess}</div> : null}
              <form className="auth-form" onSubmit={handleAuthSubmit}>
                <div className="field">
                  <label htmlFor="auth-username">Username</label>
                  <input id="auth-username" className="text-input" type="text" autoComplete="username" value={authForm.username} onChange={(e) => handleAuthFormChange("username", e.target.value)} required />
                </div>
                {authTab === "register" && (
                  <div className="field">
                    <label htmlFor="auth-email">Email</label>
                    <input id="auth-email" className="text-input" type="email" autoComplete="email" value={authForm.email} onChange={(e) => handleAuthFormChange("email", e.target.value)} required />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="auth-password">Password</label>
                  <input id="auth-password" className="text-input" type="password" autoComplete={authTab === "login" ? "current-password" : "new-password"} value={authForm.password} onChange={(e) => handleAuthFormChange("password", e.target.value)} required minLength={6} />
                </div>
                {authError ? <div className="message error">{authError}</div> : null}
                <button type="submit" className="primary-button" disabled={authSubmitting}>
                  {authSubmitting ? "Please wait\u2026" : authTab === "login" ? "Sign in" : "Create account"}
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ─── Auth loading state ───────────────────────────────
  if (authLoading) {
    return (
      <div className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <style>{styles}</style>
        <div className="loading-ring" aria-label="Loading" />
      </div>
    );
  }

  // ─── Authenticated app ────────────────────────────────
  return (
    <div className="app-shell">
      <style>{styles}</style>

      <div className="app-container">
        <header className="app-header">
          <div className="brand-mark">
            <img className="brand-logo" src="/prepmedians-logo.jpg" alt="Prepmedians" />
            <div>
              <p className="brand-title">Prepmedians Score Report</p>
              <p className="brand-subtitle">ACT scoring and study guidance</p>
            </div>
          </div>

          <div className="header-actions">
            <div className="user-chip">
              <div className="user-avatar" aria-hidden="true">
                {currentUser.username.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="user-name">{currentUser.username}</p>
                <p className="user-role-badge">{currentUser.role}</p>
              </div>
            </div>
            {isAdminAuthenticated && (
              <div className="user-chip" style={{ background: "var(--accent-soft)" }}>
                <div className="user-avatar" aria-hidden="true" style={{ background: "var(--accent)", color: "#fff" }}>
                  {adminCredentials.username.trim().slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="user-name">{adminCredentials.username.trim()}</p>
                  <p className="user-role-badge">admin</p>
                </div>
              </div>
            )}
            {currentUser.role === "educator" && (
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  if (!isAdminAuthenticated) {
                    setAdminError("");
                    setAdminSuccess("");
                    setIsLoginModalOpen(true);
                  } else {
                    setIsAdminOpen((c) => !c);
                  }
                }}
              >
                {isAdminAuthenticated ? (isAdminOpen ? "Close Setup" : "Test Setup") : "Admin Login"}
              </button>
            )}
            <button
              type="button"
              className="quiet-button"
              onClick={handleUserLogout}
            >
              Sign Out
            </button>
          </div>
        </header>

        {(isLoading || isSavingTest) ? (
          <div className="loading-backdrop" role="dialog" aria-modal="true">
            <div className="loading-modal">
              <div className="loading-ring" aria-hidden="true" />
              <div>
                <h2 className="loading-title">{loadingModal.title}</h2>
                <p className="loading-copy">{loadingModal.copy}</p>
              </div>
              <div className="modal-steps">
                {loadingModal.steps.map((step, index) => (
                  <div
                    key={step}
                    className={`modal-step ${
                      index === loadingStepIndex
                        ? "active"
                        : index < loadingStepIndex
                          ? "complete"
                          : ""
                    }`}
                  >
                    <span className="modal-step-dot" aria-hidden="true" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {isLoginModalOpen && !isAdminAuthenticated ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="educator-login-title">
            <form className="login-modal" onSubmit={handleAdminLogin}>
              <div className="modal-head">
                <div>
                  <h2 id="educator-login-title" className="panel-title">
                    Educator Login
                  </h2>
                  <p className="panel-subtitle">
                    Sign in to manage tests and study materials.
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close educator login"
                  onClick={() => setIsLoginModalOpen(false)}
                >
                  x
                </button>
              </div>

              <div className="field">
                <label htmlFor="admin-username">Username</label>
                <input
                  id="admin-username"
                  name="username"
                  className="text-input"
                  type="text"
                  value={adminCredentials.username}
                  onChange={handleAdminCredentialChange}
                  placeholder="Username"
                />
              </div>

              <div className="field">
                <label htmlFor="admin-password">Password</label>
                <input
                  id="admin-password"
                  name="password"
                  className="text-input"
                  type="password"
                  value={adminCredentials.password}
                  onChange={handleAdminCredentialChange}
                  placeholder="Password"
                />
              </div>

              {adminError ? <div className="message error">{adminError}</div> : null}

              <div className="button-row">
                <button type="submit" className="primary-button">
                  Sign In
                </button>
              </div>
            </form>
          </div>
        ) : null}

        <section ref={uploadRef} className="hero-card">
          <div className="hero-top">
            <span className="eyebrow">Prepmedians ACT Results</span>
            <h1 className="hero-title">Upload your answer sheet and get your Prepmedians score report.</h1>
            <p className="hero-copy">
              Pick your test, upload a clear image of your answer sheet, and see
              your section scores, category breakdowns, and recommended study
              plan in one place.
            </p>
            <div className="hero-highlights" aria-label="Report highlights">
              <span className="hero-highlight">Fast score report</span>
              <span className="hero-highlight">Personalized study plan</span>
              <span className="hero-highlight">Built for ACT practice</span>
            </div>
          </div>

          <div className="hero-grid">
            <form className="panel-card upload-card stack" onSubmit={handleUpload}>
              <div className="panel-head">
                <div>
                  <h2 className="panel-title">Score Your Test</h2>
                  <p className="panel-subtitle">
                    Choose your test, upload your sheet, and we'll handle the
                    reading and scoring.
                  </p>
                </div>
                <span className="status-chip">
                  {isLoading ? "Scoring" : "Ready"}
                </span>
              </div>

              <div className="field">
                <label htmlFor="student-test-selector">Select test</label>
                <select
                  id="student-test-selector"
                  className="text-input"
                  value={selectedTestId}
                  onChange={(event) => setSelectedTestId(event.target.value)}
                  disabled={testsLoading || !availableTests.length}
                >
                  <option value="">
                    {testsLoading
                      ? "Loading tests..."
                      : availableTests.length
                        ? "Select a test"
                        : "No tests available yet"}
                  </option>
                  {availableTests.map((test) => (
                    <option key={test.id} value={String(test.id)}>
                      {test.name}
                    </option>
                  ))}
                </select>
              </div>

              {testsError ? <div className="message error">{testsError}</div> : null}

              <div className="field">
                <label>How would you like to enter answers?</label>
                <div className="entry-mode-toggle" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={entryMode === "scan"}
                    className={entryMode === "scan" ? "active" : ""}
                    onClick={() => setEntryMode("scan")}
                  >
                    Scan a sheet
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={entryMode === "manual"}
                    className={entryMode === "manual" ? "active" : ""}
                    onClick={() => setEntryMode("manual")}
                  >
                    Type my answers
                  </button>
                </div>
              </div>

              {entryMode === "scan" ? (
              <div className="field">
                <label htmlFor="omr-file">Upload answer sheet</label>
                <div className="file-pick">
                  <input
                    key={`student-upload-${fileInputResetKey}`}
                    id="omr-file"
                    className="file-input"
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                  />
                  <div className="file-name">
                    {selectedFile ? selectedFile.name : "No image selected yet"}
                  </div>
                </div>
              </div>
              ) : (
              <div className="field">
                <p className="helper-text">
                  Type your answers below. Use letters only (A-D for odd
                  questions, F-J for even). Spaces, commas, and line breaks are
                  ignored, so &quot;ABCD&quot; and &quot;A B C D&quot; both work.
                </p>
                {SECTION_CONFIG.map(({ key, title, total }) => {
                  const count = manualCounts[key] || 0;
                  const isComplete = count === total;
                  return (
                    <div key={`manual-${key}`} className="manual-entry-section">
                      <h4>
                        {title}{" "}
                        <span
                          className={`manual-entry-counter ${
                            isComplete ? "complete" : ""
                          }`}
                        >
                          {count} / {total} answers
                        </span>
                      </h4>
                      <textarea
                        value={manualAnswers[key]}
                        onChange={(event) =>
                          handleManualChange(key, event.target.value)
                        }
                        placeholder={`Type ${total} letters for ${title}`}
                        spellCheck={false}
                      />
                    </div>
                  );
                })}
              </div>
              )}

              {entryMode === "scan" && selectedFilePreviewUrl ? (
                <div className="photo-preview-card">
                  <p className="photo-checklist-title">Preview your photo</p>
                  <img
                    className="photo-preview-image"
                    src={selectedFilePreviewUrl}
                    alt="Selected answer sheet preview"
                  />
                  <p className="helper-text">
                    If the page looks cut off, blurry, or tilted here, try
                    another photo before scoring.
                  </p>
                </div>
              ) : entryMode === "scan" && selectedFile ? (
                <div className="photo-preview-card">
                  <p className="photo-checklist-title">Photo selected</p>
                  <p className="helper-text">
                    {selectedFile.name} is an iPhone HEIC file. Your browser
                    can&rsquo;t show a preview, but the file will upload and
                    score normally.
                  </p>
                </div>
              ) : null}

              {entryMode === "scan" ? (
              <div className="photo-checklist" aria-label="Photo checklist">
                <p className="photo-checklist-title">Before you upload, check the photo:</p>
                <div className="photo-checklist-grid">
                  {[
                    "Full page visible",
                    "Good lighting",
                    "No blur",
                    "Sheet not tilted",
                    "Bubbles filled darkly",
                  ].map((item) => (
                    <div key={item} className="photo-check-item">
                      <span className="photo-check-icon" aria-hidden="true">
                        OK
                      </span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <div className="photo-guide" aria-hidden="true">
                  <div className="photo-example">
                    <div className="sample-photo">
                      <div className="sample-sheet" />
                    </div>
                    <p className="photo-example-label">Good photo</p>
                  </div>
                  <div className="photo-example">
                    <div className="sample-photo bad">
                      <div className="sample-sheet" />
                    </div>
                    <p className="photo-example-label">Avoid blurry or tilted photos</p>
                  </div>
                </div>
              </div>
              ) : null}

              {error ? <div className="message error">{error}</div> : null}
              {uploadSuccess ? (
                <div className="message success">{uploadSuccess}</div>
              ) : null}

              <div className="button-row">
                {results ? (
                  <>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleViewResults}
                    >
                      See My Results
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleStartOver}
                    >
                      Start a New Scan
                    </button>
                  </>
                ) : (
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={
                      isLoading ||
                      !selectedTestId ||
                      (entryMode === "scan" ? !selectedFile : !manualHasAny)
                    }
                  >
                    {isLoading
                      ? "Building Your Report..."
                      : entryMode === "manual"
                        ? "Score My Answers"
                        : "Get My Results"}
                  </button>
                )}
              </div>

              <p className="helper-text">
                Use a straight, well-lit photo with the full page visible for
                the most accurate read.
              </p>
            </form>

            <div className="panel-card insight-card stack">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title">What You'll Get</h2>
                  <p className="panel-subtitle">
                    Your report is designed to be easy to read and easy to act on.
                  </p>
                </div>
              </div>

              <div className="endpoint-list">
                <div className="endpoint-item">
                  <strong>Section Scores</strong>
                  <div className="endpoint-url">
                    English, Math, Reading, and Science scores in one report.
                  </div>
                </div>
                <div className="endpoint-item">
                  <strong>Category Breakdown</strong>
                  <div className="endpoint-url">
                    See exactly which question types need the most work.
                  </div>
                </div>
                <div className="endpoint-item">
                  <strong>Study Plan</strong>
                  <div className="endpoint-url">
                    Get targeted Prepmedians modules matched to your weak spots.
                  </div>
                </div>
                <div className="endpoint-item">
                  <strong>Ready-to-Score Tests</strong>
                  <div className="endpoint-url">
                    {testsLoading
                      ? "Loading tests..."
                      : availableTests.length
                        ? `${availableTests.length} tests ready to choose from`
                        : "No tests available yet"}
                  </div>
                </div>
              </div>

              <p className="helper-text">
                You can still review the answers we found if you want a
                question-by-question view.
              </p>
            </div>
          </div>
        </section>

        {results ? (
          <>
            <section ref={resultsRef} className="panel-card score-report-head">
              <div>
                <h2 className="panel-title">Score Report</h2>
                <p className="panel-subtitle">
                  {selectedTest?.name || "Selected test"} results are ready.
                </p>
                <div className="scan-summary">
                  <div className="scan-summary-card">
                    <div className="scan-summary-label">Answers found</div>
                    <div className="scan-summary-value">
                      {resultReadSummary.answered}
                    </div>
                  </div>
                  <div className="scan-summary-card">
                    <div className="scan-summary-label">Blanks</div>
                    <div className="scan-summary-value">
                      {resultReadSummary.blank}
                    </div>
                  </div>
                  <div className="scan-summary-card">
                    <div className="scan-summary-label">Read quality</div>
                    <div className="scan-summary-value">
                      {resultReadSummary.isLowConfidence
                        ? "Needs review"
                        : resultReadSummary.hasManyBlanks
                          ? "Some blanks"
                          : "Looks good"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="score-kpis">
                {scoreSummaryItems.map((item) => (
                  <div key={item.key} className="score-kpi">
                    <div className="score-kpi-label">{item.title}</div>
                    <div className="score-kpi-value">{item.primary}</div>
                    <div className="result-meta">
                      {item.label} | {item.meta}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="results-action-bar">
              <p className="results-action-copy">
                Want to double-check the scan? You can review the detected
                answers or start over with a clearer photo.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleReviewAnswers}
                >
                  Review Answers
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleBackToUpload}
                >
                  Back to Upload
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleStartOver}
                >
                  Start a New Scan
                </button>
                {currentUser ? (
                  <button
                    type="button"
                    className="email-btn"
                    disabled={emailSending}
                    onClick={handleSendEmail}
                  >
                    {emailSending ? "Sending…" : "✉ Email my results"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="email-btn"
                    onClick={() => openAuthModal("register")}
                  >
                    ✉ Email my results
                  </button>
                )}
              </div>
              {emailStatus === "sent" ? (
                <div className="message success" style={{ marginTop: 10 }}>
                  Report sent to {currentUser?.email}. Check your inbox!
                </div>
              ) : emailStatus === "error" ? (
                <div className="message error" style={{ marginTop: 10 }}>
                  Could not send the email. Please try again.
                </div>
              ) : null}
            </section>

            {results._status === "partial" || results._warnings?.length ? (
              <section className="message warning">
                <strong>Some answers were hard to read.</strong> Review the
                answer grid before trusting the score.
                {results._warnings?.length ? (
                  <ul className="scan-warning-list">
                    {results._warnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {resultReadSummary.hasManyBlanks && !resultReadSummary.isLowConfidence ? (
              <section className="message warning">
                A lot of blanks were detected. If that does not match your
                sheet, try another photo before relying on the score.
              </section>
            ) : null}

            {resultReadSummary.isLowConfidence ? (
              <section className="low-confidence-card">
                <strong>We could not read enough of this sheet to score it confidently.</strong>
                <span>
                  Try a clearer photo with the full page visible, then scan it
                  again. You can still review the answers we found below.
                </span>
              </section>
            ) : null}

            <section ref={answersRef} className="results-grid">
              {practiceTest1ScoringState.error ? (
                <div className="message error results-banner">
                  {practiceTest1ScoringState.error}
                </div>
              ) : null}

              {SECTION_CONFIG.map(({ key, title, total }) => {
                const answers = Array.isArray(results[key]) ? results[key] : [];
                const counts = countAnswers(answers);
                const sectionScore = practiceTest1ScoringState.scores?.[key] || null;
                const categoryScores = getDisplayedCategoryScores(key, sectionScore);
                const sectionStatus = getSectionScanStatus(counts, total);

                return (
                  <article key={key} className="result-card">
                    <div className="result-head">
                      <div>
                        <h3 className="result-title">{title}</h3>
                        <div className="result-meta">
                          {counts.answered} answered / {counts.blank} blank
                        </div>
                      </div>
                      <span className={`section-status ${sectionStatus.className}`}>
                        {sectionStatus.label}
                      </span>
                    </div>

                    {sectionScore && !resultReadSummary.isLowConfidence ? (
                      <div className="score-summary">
                        <div className="score-overview">
                          <div className="score-pill">
                            <div className="score-label">Questions correct</div>
                            <div className="score-value">
                              {sectionScore.rawScore} / {sectionScore.totalPossible}
                            </div>
                          </div>

                          <div className="score-pill">
                            <div className="score-label">ACT score</div>
                            <div className="score-value">{sectionScore.scaleScore}</div>
                          </div>
                        </div>

                        <div className="score-category-grid">
                          {categoryScores.map((categoryScore) => (
                            <div
                              key={`${key}-${categoryScore.code}`}
                              className="score-category-card"
                            >
                              <div className="score-category-name">
                                {categoryScore.label}
                              </div>
                              <div className="score-category-value">
                                {categoryScore.correct} / {categoryScore.total}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <details
                      className="answer-review"
                      open={isAnswerReviewOpen}
                      onToggle={(event) =>
                        setIsAnswerReviewOpen(event.currentTarget.open)
                      }
                    >
                      <summary>Review answers we found</summary>
                      <p className="helper-text">
                        A dash means we could not detect a clear mark for that
                        question.
                      </p>
                      <div className="answers-grid">
                        {answers.map((value, index) => {
                          const questionNumber = index + 1;
                          const mappedAnswer = mapAnswer(value, questionNumber);
                          const isBlank = mappedAnswer === "-";
                          const sectionScoringConfig =
                            practiceTest1ScoringState.isPracticeTest1
                              ? PRACTICE_TEST_1_SCORING[key] || null
                              : null;
                          const expectedNumeric =
                            sectionScoringConfig?.answerKey?.[questionNumber] ??
                            null;
                          const isScored =
                            expectedNumeric != null &&
                            !(sectionScoringConfig?.notScored?.has(
                              questionNumber
                            ));
                          let correctnessClass = "";
                          if (isScored && !isBlank && value != null) {
                            correctnessClass =
                              Number(value) === expectedNumeric
                                ? "correct"
                                : "incorrect";
                          }
                          const flagKey = `${key}-${questionNumber}`;
                          const isFlagged = flaggedAnswers.has(flagKey);
                          const canFlag = resultsSource === "scan" && !isBlank;
                          const isEditing =
                            editingCell?.section === key &&
                            editingCell?.questionNumber === questionNumber;
                          const isEdited = editedCells.has(flagKey);

                          return (
                            <div
                              key={`${key}-${questionNumber}`}
                              className={`answer-card ${
                                isBlank ? "blank" : "filled"
                              } ${correctnessClass} ${
                                isFlagged ? "flagged" : ""
                              } ${isEdited ? "edited" : ""} ${
                                isEditing ? "editing" : ""
                              }`.trim()}
                              style={{ cursor: isEditing ? "text" : "pointer" }}
                              onClick={() => {
                                if (!isEditing)
                                  setEditingCell({ section: key, questionNumber });
                              }}
                              title={isEditing ? undefined : "Click to edit this answer"}
                            >
                              <div className="answer-question">
                                Q{questionNumber}
                                {isEdited ? <span className="answer-edited-dot" title="Manually edited" /> : null}
                              </div>
                              <div className="answer-card-body">
                                {isEditing ? (
                                  <input
                                    className="answer-edit-input"
                                    type="text"
                                    maxLength={1}
                                    defaultValue={isBlank ? "" : mappedAnswer}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === "Tab") {
                                        e.preventDefault();
                                        handleEditCommit(key, questionNumber, e.target.value);
                                      }
                                      if (e.key === "Escape") setEditingCell(null);
                                    }}
                                    onBlur={(e) =>
                                      handleEditCommit(key, questionNumber, e.target.value)
                                    }
                                  />
                                ) : (
                                  <div className="answer-value">{mappedAnswer}</div>
                                )}
                                {canFlag && !isEditing ? (
                                  <button
                                    type="button"
                                    className={`answer-flag-btn ${
                                      isFlagged ? "is-flagged" : ""
                                    }`}
                                    aria-pressed={isFlagged}
                                    aria-label={
                                      isFlagged
                                        ? `Undo misread report for question ${questionNumber}`
                                        : `Report question ${questionNumber} as misread`
                                    }
                                    title={
                                      isFlagged
                                        ? "Reported as misread"
                                        : "Report this letter as misread"
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleFlag(key, questionNumber, value, mappedAnswer);
                                    }}
                                  >
                                    {"👎"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </article>
                );
              })}
            </section>

            {studyRecommendations ? (
              <section className="study-plan-shell">
                <div className="panel-card">
                  <div className="study-plan-header">
                    <h2 className="panel-title">Recommended Study Plan</h2>
                    <p className="study-plan-copy">
                      {resultReadSummary.isLowConfidence
                        ? "This scan was hard to read, so review the detected answers before relying on these recommendations."
                        : "Based on your category breakdown, these Prepmedians modules start with the areas that can move your score the most."}
                    </p>
                  </div>
                </div>

                <div className="study-plan-grid">
                  {SECTION_CONFIG.map(({ key, title }) => {
                    const sectionPlan = studyRecommendations[key];
                    if (!sectionPlan) {
                      return null;
                    }

                    return (
                      <article key={`study-${key}`} className="result-card study-plan-card">
                        <div className="result-head">
                          <div>
                            <h3 className="result-title">{title}</h3>
                            <div className="result-meta">
                              Your recommended modules
                            </div>
                          </div>
                        </div>

                        <div className="study-category-list">
                          {sectionPlan.categories.map((category) => (
                            <div
                              key={`${key}-${category.code}-recommendation`}
                              className="study-category-card"
                            >
                              <div className="study-category-head">
                                <div>
                                  <h4 className="study-category-title">
                                    {category.label}
                                  </h4>
                                  <div className="study-category-score">
                                    {category.score.correct} / {category.score.total}
                                  </div>
                                </div>

                                {category.isFocusArea ? (
                                  <span className="study-priority high">
                                    Focus Area
                                  </span>
                                ) : (
                                  <span className={`study-priority ${category.priority}`}>
                                    {category.priority} priority
                                  </span>
                                )}
                              </div>

                              <p className="study-category-reason">{category.reason}</p>

                              <div className="study-module-list">
                                {category.recommendations.map((item) => (
                                  <div key={item.id} className="study-module-card">
                                    <div className="study-module-head">
                                      <div>
                                        <h5 className="study-module-title">
                                          {item.title}
                                        </h5>
                                        {item.subtitle ? (
                                          <div className="study-module-subtitle">
                                            {item.subtitle}
                                          </div>
                                        ) : null}
                                      </div>
                                      <span
                                        className={`study-priority ${item.priority}`}
                                      >
                                        {item.priority}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="study-strategy-list">
                          <div className="score-category-name">Section strategy</div>
                          {sectionPlan.strategy.map((item) => (
                            <div key={item.id} className="study-strategy-card">
                              <h4 className="study-strategy-title">{item.title}</h4>
                              {item.subtitle ? (
                                <div className="study-module-subtitle">
                                  {item.subtitle}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {currentUser?.role === "student" && (myResults?.length > 0 || myResultsLoading) ? (
          <section className="panel-card stack">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">My Results</h2>
                <p className="panel-subtitle">Your past test attempts</p>
              </div>
              <button type="button" className="quiet-button" onClick={loadMyResults}>Refresh</button>
            </div>
            {myResultsLoading ? (
              <p className="helper-text">Loading…</p>
            ) : (
              <div className="history-panel">
                {(myResults || []).map((r) => (
                  <div key={r.id} className="history-row">
                    <div className="history-meta">
                      <div className="history-test">{r.testName || "Unknown test"}</div>
                      <div className="history-date">{new Date(r.createdAt).toLocaleString()}</div>
                    </div>
                    <span className="history-source">{r.source}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {!results ? (
          <section className="panel-card">
            <div className="empty-state">
              Upload your answer sheet to get your score report and study plan.
            </div>
          </section>
        ) : null}

        {currentUser?.role === "educator" ? (
          <section className="panel-card admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2 className="admin-panel-title">Admin Panel</h2>
                <p className="admin-panel-subtitle">Manage tests, students, and results</p>
              </div>
              <button type="button" className="quiet-button" onClick={loadEducatorData}>Refresh</button>
            </div>

            <div className="admin-tabs">
              <button className={`admin-tab ${educatorTab === "overview" ? "active" : ""}`} onClick={() => setEducatorTab("overview")}>Overview</button>
              <button className={`admin-tab ${educatorTab === "tests" ? "active" : ""}`} onClick={() => setEducatorTab("tests")}>Test Setup</button>
              <button className={`admin-tab ${educatorTab === "students" ? "active" : ""}`} onClick={() => setEducatorTab("students")}>Students</button>
              <button className={`admin-tab ${educatorTab === "results" ? "active" : ""}`} onClick={() => setEducatorTab("results")}>Results</button>
            </div>

            {educatorLoading ? (
              <p className="helper-text">Loading data...</p>

            ) : educatorTab === "overview" ? (
              /* ─── Overview Tab ────────────────────────────── */
              <>
                <div className="admin-kpi-grid">
                  <div className="admin-kpi-card">
                    <div className="admin-kpi-value">{educatorAnalytics?.totalStudents ?? "—"}</div>
                    <div className="admin-kpi-label">Students</div>
                  </div>
                  <div className="admin-kpi-card">
                    <div className="admin-kpi-value">{educatorAnalytics?.totalScans ?? "—"}</div>
                    <div className="admin-kpi-label">Total Scans</div>
                  </div>
                  <div className="admin-kpi-card">
                    <div className="admin-kpi-value">{savedTests.length || availableTests.length}</div>
                    <div className="admin-kpi-label">Tests</div>
                  </div>
                  <div className="admin-kpi-card">
                    <div className="admin-kpi-value">
                      {educatorAnalytics?.avgScores
                        ? (() => {
                            const vals = Object.values(educatorAnalytics.avgScores).filter(Boolean);
                            return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : "—";
                          })()
                        : "—"}
                    </div>
                    <div className="admin-kpi-label">Avg Score</div>
                  </div>
                </div>

                {educatorAnalytics?.avgScores && Object.values(educatorAnalytics.avgScores).some(Boolean) ? (
                  <>
                    <p className="admin-section-title">Average Scaled Scores</p>
                    <div className="admin-scores-grid">
                      {[["english","English"],["math","Math"],["reading","Reading"],["science","Science"]].map(([key, label]) => (
                        <div key={key} className="admin-score-card">
                          <div className="admin-score-section">{label}</div>
                          <div className="admin-score-value">{educatorAnalytics.avgScores[key] ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="helper-text">No scored results yet. Scores appear once students submit tests.</p>
                )}

                {educatorAnalytics?.scansPerWeek?.length > 0 ? (
                  <>
                    <p className="admin-section-title">Scans per Week</p>
                    {(() => {
                      const maxCount = Math.max(...educatorAnalytics.scansPerWeek.map((w) => w.count), 1);
                      return educatorAnalytics.scansPerWeek.map((w) => (
                        <div key={w.week} className="admin-week-row">
                          <span style={{ minWidth: 90, color: "var(--muted)", fontSize: "0.82rem" }}>{w.week}</span>
                          <div className="admin-week-bar" style={{ width: `${(w.count / maxCount) * 100}%` }} />
                          <strong style={{ minWidth: 30, textAlign: "right" }}>{w.count}</strong>
                        </div>
                      ));
                    })()}
                  </>
                ) : null}
              </>

            ) : educatorTab === "tests" ? (
              /* ─── Test Setup Tab ──────────────────────────── */
              <>
                {!isAdminAuthenticated ? (
                  <form className="stack" onSubmit={handleAdminLogin} style={{ maxWidth: 400 }}>
                    <p className="helper-text">Sign in with admin credentials to manage tests.</p>
                    <div className="field">
                      <label htmlFor="admin-username">Username</label>
                      <input id="admin-username" name="username" className="text-input" type="text" value={adminCredentials.username} onChange={handleAdminCredentialChange} placeholder="Username" />
                    </div>
                    <div className="field">
                      <label htmlFor="admin-password">Password</label>
                      <input id="admin-password" name="password" className="text-input" type="password" value={adminCredentials.password} onChange={handleAdminCredentialChange} placeholder="Password" />
                    </div>
                    {adminError ? <div className="message error">{adminError}</div> : null}
                    <div className="button-row">
                      <button type="submit" className="primary-button">Sign In</button>
                    </div>
                  </form>
                ) : (
                  <div className="admin-setup-grid">
                    <div className="stack">
                      <p className="admin-section-title">Add New Test</p>
                      <form className="stack" onSubmit={handleSaveTest}>
                        <div className="field">
                          <label htmlFor="test-name">Test name</label>
                          <input id="test-name" className="text-input" type="text" value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="ACT Practice Test 01" />
                        </div>
                        <div className="field">
                          <label htmlFor="scoring-rubric-upload">Scoring guide PDF</label>
                          <input key={`scoring-rubric-${adminUploadResetKey}`} id="scoring-rubric-upload" className="file-input" type="file" accept=".pdf,application/pdf" onChange={(e) => setScoringRubricFile(e.target.files?.[0] || null)} />
                          <div className="file-name">{scoringRubricFile ? scoringRubricFile.name : "No scoring guide selected"}</div>
                        </div>
                        <div className="field">
                          <label>Study-material PDFs</label>
                          <div className="stack">
                            {SECTION_CONFIG.map(({ key, title }) => (
                              <div key={`rec-${key}`} className="field">
                                <label htmlFor={`${key}-rec-upload`}>{title}</label>
                                <input key={`${key}-rec-${adminUploadResetKey}`} id={`${key}-rec-upload`} className="file-input" type="file" accept=".pdf,application/pdf" onChange={(e) => handleRecommendationFileChange(key, e.target.files?.[0] || null)} />
                                <div className="file-name">{recommendationFiles[key] ? recommendationFiles[key].name : `No ${title.toLowerCase()} PDF`}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        {adminError ? <div className="message error">{adminError}</div> : null}
                        {adminSuccess ? <div className="message success">{adminSuccess}</div> : null}
                        <div className="button-row">
                          <button type="submit" className="primary-button" disabled={isSavingTest}>{isSavingTest ? "Saving..." : "Save Test"}</button>
                        </div>
                      </form>
                    </div>

                    <div className="stack">
                      <p className="admin-section-title">Test Library ({savedTests.length || availableTests.length} tests)</p>
                      {(savedTests.length ? savedTests : availableTests).length ? (
                        <div className="admin-list">
                          {(savedTests.length ? savedTests : availableTests).map((test) => (
                            <div key={test.id} className="admin-test-library-item">
                              <h3 className="admin-test-library-name">{test.name}</h3>
                              <div className="admin-test-library-meta">
                                {formatSavedDate(test.createdAt)}
                                {test.sourceFilename ? ` \u00b7 ${test.sourceFilename}` : ""}
                              </div>
                              <div className="admin-test-library-pills">
                                {SECTION_CONFIG.map(({ key, title }) => {
                                  const counts = test.sectionCounts?.[key];
                                  return (
                                    <span key={`${test.id}-${key}`} className="admin-test-library-pill">
                                      {title}: {counts?.total || 0}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state">No tests yet. Upload a scoring guide to create one.</div>
                      )}
                    </div>
                  </div>
                )}
              </>

            ) : educatorTab === "students" ? (
              /* ─── Students Tab ────────────────────────────── */
              <>
                {(educatorUsers || []).length ? (
                  <div className="admin-list">
                    {educatorUsers.map((u) => (
                      <div key={u.id} className="admin-list-item">
                        <div className="admin-list-avatar">
                          {u.username.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="admin-list-info">
                          <div className="admin-list-name">{u.username}</div>
                          <div className="admin-list-meta">
                            {u.email}
                            {u.lastScan ? ` \u00b7 Last scan: ${new Date(u.lastScan).toLocaleDateString()}` : ""}
                          </div>
                        </div>
                        <div className="admin-list-stat">
                          <div className="admin-list-stat-value">{u.scanCount}</div>
                          <div className="admin-list-stat-label">scans</div>
                        </div>
                        <select className="role-select" value={u.role} onChange={(e) => handleSetUserRole(u.id, e.target.value)}>
                          <option value="student">student</option>
                          <option value="educator">educator</option>
                        </select>
                        <span className={`admin-list-badge ${u.role}`}>{u.role}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No students have signed up yet.</div>
                )}
              </>

            ) : educatorTab === "results" ? (
              /* ─── Results Tab ─────────────────────────────── */
              <>
                {(educatorResults || []).length ? (
                  <div className="admin-list">
                    {educatorResults.map((r) => {
                      let scores = null;
                      try { scores = r.scoresJson ? JSON.parse(r.scoresJson) : null; } catch { /* ignore */ }
                      return (
                        <div key={r.id} className="admin-result-card">
                          <div className="admin-result-header">
                            <div>
                              <div className="admin-result-student">{r.username}</div>
                              <div className="admin-result-test">{r.testName || "Unknown test"}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div className="admin-result-date">{new Date(r.createdAt).toLocaleDateString()}</div>
                              <span className="admin-result-source">{r.source}</span>
                            </div>
                          </div>
                          {scores ? (
                            <div className="admin-result-scores">
                              {[["english","ENG"],["math","MATH"],["reading","READ"],["science","SCI"]].map(([key, label]) => {
                                const s = scores[key];
                                return s?.scaled != null ? (
                                  <span key={key} className="admin-result-score-pill">
                                    <span className="section-label">{label}</span>
                                    <span className="section-value">{s.scaled}</span>
                                  </span>
                                ) : null;
                              })}
                              {scores.composite != null ? (
                                <span className="admin-result-score-pill" style={{ background: "var(--accent)", color: "#fff" }}>
                                  <span className="section-label" style={{ color: "rgba(255,255,255,0.7)" }}>COMP</span>
                                  <span className="section-value" style={{ color: "#fff" }}>{scores.composite}</span>
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <div className="admin-list-meta">No score data available</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state">No results yet. Students will appear here after submitting tests.</div>
                )}
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
