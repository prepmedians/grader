import base64
import io
import itertools
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import cv2
import httpx
import numpy as np
from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Query, Request, Response as FResponse, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.orm import Session

from auth_utils import (
    COOKIE_NAME,
    create_jwt,
    get_current_user,
    hash_password,
    require_educator,
    require_user,
    verify_password,
)
from database import Base, engine, get_db
from models import InviteCode, ScanResult, User
from PIL import Image, ImageOps, UnidentifiedImageError

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:
    pass


SECTION_LAYOUT = {
    "english": [10, 10, 10, 10, 10],
    "math": [10, 10, 10, 10, 5],
    "reading": [8, 8, 8, 8, 4],
    "science": [8, 8, 8, 8, 8],
}
SECTION_CONFIG = {name: sum(cols) for name, cols in SECTION_LAYOUT.items()}
BUBBLE_LEFT_SKIP_RATIO = 0.15
BUBBLE_VERTICAL_MARGIN_RATIO = 0.10
BUBBLE_HORIZONTAL_MARGIN_RATIO = 0.20
BUBBLE_MIN_ABS_DARKNESS = 25.0
BUBBLE_MIN_MARGIN_RATIO = 0.20
ANSWER_VALUE_MAP = {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "A": 1,
    "B": 2,
    "C": 3,
    "D": 4,
    "F": 1,
    "G": 2,
    "H": 3,
    "J": 4,
}
NULL_MARKERS = {"", "-", "NULL", "NONE", "BLANK", "N/A", "NA"}
DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "tests.sqlite3"
FEEDBACK_LOG_PATH = DATA_DIR / "answer_feedback.jsonl"
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "omr123")
SIGNUP_INVITE_CODE = os.getenv("SIGNUP_INVITE_CODE", "")
ANTHROPIC_MODEL = os.getenv(
    "ANSWER_KEY_EXTRACTION_MODEL", "claude-sonnet-4-20250514"
)
PARSE_WEBHOOK_URL = os.getenv(
    "PARSE_WEBHOOK_URL", "https://rmrs.app.n8n.cloud/webhook/omr-upload"
)
MAX_PROCESSING_DIMENSION = int(os.getenv("MAX_PROCESSING_DIMENSION", "2200"))
RECTIFIED_WIDTH = 1700
RECTIFIED_HEIGHT = 2200
PIPELINE_MODES = {"legacy", "rectified", "projection"}

app = FastAPI(title="OMR Pipeline")
security = HTTPBasic()


def build_allowed_origins():
    configured = os.getenv("CORS_ALLOW_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]

    return [
        "https://grader.prepmedians.com",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]


app.add_middleware(
    CORSMiddleware,
    allow_origins=build_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def ensure_data_store():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                answer_keys_json TEXT NOT NULL,
                source_filename TEXT,
                extraction_summary TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        existing_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(tests)").fetchall()
        }
        required_columns = {
            "scoring_config_json": "TEXT",
            "recommendation_config_json": "TEXT",
            "recommendation_filenames_json": "TEXT",
            "config_status": "TEXT",
        }

        for column_name, column_type in required_columns.items():
            if column_name not in existing_columns:
                connection.execute(
                    f"ALTER TABLE tests ADD COLUMN {column_name} {column_type}"
                )
        connection.commit()


ensure_data_store()
Base.metadata.create_all(bind=engine)

# Add scores_json column if upgrading from Phase 2
with engine.connect() as _conn:
    from sqlalchemy import inspect as _inspect, text as _text
    _cols = {c["name"] for c in _inspect(_conn).get_columns("scan_results")}
    if "scores_json" not in _cols:
        _conn.execute(_text("ALTER TABLE scan_results ADD COLUMN scores_json TEXT"))
        _conn.commit()


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def read_image_from_upload(upload: UploadFile) -> np.ndarray:
    data = upload.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

    if img is None:
        img = decode_with_pillow(data)

    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image")

    return img


def decode_with_pillow(data: bytes):
    try:
        with Image.open(io.BytesIO(data)) as pil_img:
            pil_img = ImageOps.exif_transpose(pil_img)
            if pil_img.mode != "RGB":
                pil_img = pil_img.convert("RGB")
            rgb = np.array(pil_img)
    except (UnidentifiedImageError, OSError, ValueError):
        return None

    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def order_quad_corners(quad: np.ndarray) -> np.ndarray:
    summed = quad.sum(axis=1)
    diffed = np.diff(quad, axis=1).ravel()
    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = quad[np.argmin(summed)]
    ordered[2] = quad[np.argmax(summed)]
    ordered[1] = quad[np.argmin(diffed)]
    ordered[3] = quad[np.argmax(diffed)]
    return ordered


def _largest_quad_contour(mask: np.ndarray, width: int, height: int):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    image_area = float(width * height)
    for contour in contours:
        if cv2.contourArea(contour) < 0.3 * image_area:
            return None
        perimeter = cv2.arcLength(contour, True)
        for epsilon in (0.02, 0.03, 0.04):
            approx = cv2.approxPolyDP(contour, epsilon * perimeter, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                return approx.reshape(4, 2).astype(np.float32)
    return None


def find_sheet_quad(img: np.ndarray):
    height, width = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img

    blurred_big = cv2.GaussianBlur(gray, (15, 15), 0)
    _, paper_mask = cv2.threshold(blurred_big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (51, 51))
    paper_mask = cv2.morphologyEx(paper_mask, cv2.MORPH_CLOSE, close_kernel)
    quad = _largest_quad_contour(paper_mask, width, height)
    if quad is not None:
        return quad

    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 30, 120)
    dilate_kernel = np.ones((5, 5), np.uint8)
    edges = cv2.dilate(edges, dilate_kernel, iterations=2)
    quad = _largest_quad_contour(edges, width, height)
    if quad is not None:
        return quad

    edges_soft = cv2.Canny(blurred, 10, 40)
    edges_soft = cv2.dilate(edges_soft, dilate_kernel, iterations=3)
    return _largest_quad_contour(edges_soft, width, height)


def rectify_sheet(img: np.ndarray) -> np.ndarray:
    quad = find_sheet_quad(img)
    if quad is None:
        return img

    ordered = order_quad_corners(quad)
    target = np.array(
        [
            [0, 0],
            [RECTIFIED_WIDTH, 0],
            [RECTIFIED_WIDTH, RECTIFIED_HEIGHT],
            [0, RECTIFIED_HEIGHT],
        ],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(ordered, target)
    return cv2.warpPerspective(img, transform, (RECTIFIED_WIDTH, RECTIFIED_HEIGHT))


def preprocess_for_ai(img: np.ndarray, mode: str = "legacy") -> np.ndarray:
    if img.shape[1] > img.shape[0]:
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)

    if mode in ("rectified", "projection"):
        img = rectify_sheet(img)

    height, width = img.shape[:2]
    largest_dimension = max(height, width)
    if largest_dimension > MAX_PROCESSING_DIMENSION:
        scale = MAX_PROCESSING_DIMENSION / largest_dimension
        img = cv2.resize(
            img,
            (int(width * scale), int(height * scale)),
            interpolation=cv2.INTER_AREA,
        )

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    if mode == "projection":
        return high_contrast_sheet(gray)

    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)

    clahe = cv2.createCLAHE(2.0, (8, 8))
    gray = clahe.apply(gray)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    sharpen = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    gray = cv2.filter2D(gray, -1, sharpen)

    return gray


def high_contrast_sheet(gray: np.ndarray) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (100, 1))
    black_hat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    _, binary = cv2.threshold(black_hat, 30, 255, cv2.THRESH_BINARY)
    return cv2.bitwise_not(binary)


def resolve_mode(mode: str) -> str:
    if mode not in PIPELINE_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown mode '{mode}'. Allowed: {sorted(PIPELINE_MODES)}",
        )
    return mode


def encode_crop_base64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    if not ok:
        raise HTTPException(status_code=500, detail="Encode failed")
    return base64.b64encode(buf).decode()


def detect_horizontal_rules(gray: np.ndarray):
    _, w = gray.shape
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    kernel_strong = cv2.getStructuringElement(cv2.MORPH_RECT, (w // 12, 2))
    kernel_weak = cv2.getStructuringElement(cv2.MORPH_RECT, (w // 16, 1))

    strong = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel_strong)
    weak = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel_weak)
    combined = cv2.bitwise_or(strong, weak)

    contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    lines = []
    for contour in contours:
        x, y, contour_width, contour_height = cv2.boundingRect(contour)
        if contour_width > w * 0.22 and contour_height < 28:
            lines.append(
                {
                    "x1": int(x),
                    "x2": int(x + contour_width),
                    "y": int(y + contour_height // 2),
                    "width": int(contour_width),
                    "height": int(contour_height),
                    "is_major": contour_width > w * 0.60,
                }
            )

    return sorted(lines, key=lambda line: line["y"])


def choose_best_divider_chain(y_lines, length=4):
    best = None
    best_var = None

    for index in range(len(y_lines) - length + 1):
        chain = y_lines[index : index + length]
        diffs = [chain[i + 1] - chain[i] for i in range(len(chain) - 1)]

        if min(diffs) <= 0:
            continue

        mean = sum(diffs) / len(diffs)
        variance = sum((diff - mean) ** 2 for diff in diffs) / len(diffs)

        if best_var is None or variance < best_var:
            best_var = variance
            best = chain

    if best is None:
        raise HTTPException(status_code=500, detail="No divider chain")

    return best


def get_divider_lines(lines, y_tol=18):
    major = sorted(
        [line for line in lines if line.get("is_major", False)],
        key=lambda line: line["y"],
    )

    if not major:
        raise HTTPException(status_code=500, detail="No major lines found")

    groups = [[major[0]]]
    for line in major[1:]:
        if abs(line["y"] - groups[-1][-1]["y"]) <= y_tol:
            groups[-1].append(line)
        else:
            groups.append([line])

    collapsed = []
    for group in groups:
        collapsed.append(
            {
                "y": int(round(sum(line["y"] for line in group) / len(group))),
                "x1": int(min(line["x1"] for line in group)),
                "x2": int(max(line["x2"] for line in group)),
                "width": int(max(line["width"] for line in group)),
                "height": int(max(line["height"] for line in group)),
                "is_major": True,
            }
        )

    if len(collapsed) < 4:
        raise HTTPException(
            status_code=500,
            detail=f"Not enough major lines after collapsing: {[line['y'] for line in collapsed]}",
        )

    chosen_y_values = choose_best_divider_chain([line["y"] for line in collapsed], length=4)
    return [next(line for line in collapsed if line["y"] == y_value) for y_value in chosen_y_values]


def infer_bottom_boundary(dividers):
    y_values = [divider["y"] for divider in dividers]
    diffs = [y_values[index + 1] - y_values[index] for index in range(len(y_values) - 1)]
    spacing = int(round(np.median(diffs)))
    last = dividers[-1]

    return {
        "y": int(last["y"] + spacing),
        "x1": int(last["x1"]),
        "x2": int(last["x2"]),
        "width": int(last["width"]),
        "height": int(last["height"]),
        "is_major": True,
        "is_inferred": True,
    }


def build_section_bands(lines, pad_y=15):
    dividers = get_divider_lines(lines)
    bottom = infer_bottom_boundary(dividers)
    boundaries = dividers + [bottom]
    bands = {}

    for index, name in enumerate(SECTION_CONFIG):
        top = boundaries[index]
        bottom_bound = boundaries[index + 1]
        bands[name] = {
            "y1": int(top["y"] + pad_y),
            "y2": int(bottom_bound["y"] - pad_y),
            "x1": int(min(top["x1"], bottom_bound["x1"])),
            "x2": int(max(top["x2"], bottom_bound["x2"])),
        }

    return bands, dividers, bottom


def _split_run_recursively(run, row_smooth, min_segment_height=150, min_drop_ratio=0.4):
    start, end = run
    if end - start < 2 * min_segment_height:
        return [run]

    interior = row_smooth[start : end + 1]
    max_value = float(interior.max())
    if max_value <= 0:
        return [run]

    margin = min_segment_height
    if margin >= len(interior) - margin:
        return [run]

    central = interior[margin : len(interior) - margin]
    if len(central) == 0:
        return [run]

    min_index_in_central = int(np.argmin(central))
    min_value = float(central[min_index_in_central])

    if min_value > max_value * (1.0 - min_drop_ratio):
        return [run]

    split_y = start + margin + min_index_in_central
    left = (start, split_y)
    right = (split_y + 1, end)
    return _split_run_recursively(
        left, row_smooth, min_segment_height, min_drop_ratio
    ) + _split_run_recursively(
        right, row_smooth, min_segment_height, min_drop_ratio
    )


def detect_section_bands_via_projection(gray, pad_y=12):
    height, width = gray.shape
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    row_density = mask.sum(axis=1).astype(np.float32) / 255.0
    smoothing_kernel = np.ones(31, dtype=np.float32) / 31.0
    row_smooth = np.convolve(row_density, smoothing_kernel, mode="same")
    content_threshold = row_smooth.max() * 0.15
    content_rows = row_smooth > content_threshold

    raw_runs = []
    in_run = False
    run_start = 0
    for y, is_content in enumerate(content_rows):
        if is_content and not in_run:
            run_start = y
            in_run = True
        elif not is_content and in_run:
            raw_runs.append((run_start, y - 1))
            in_run = False
    if in_run:
        raw_runs.append((run_start, len(content_rows) - 1))

    runs = []
    for run in raw_runs:
        runs.extend(_split_run_recursively(run, row_smooth))

    min_run_height = int(height * 0.04)
    runs = [run for run in runs if run[1] - run[0] >= min_run_height]

    target_count = len(SECTION_CONFIG)
    if len(runs) < target_count:
        raise HTTPException(
            status_code=500,
            detail=f"Projection found {len(runs)} content runs, need {target_count}",
        )

    run_content = {
        run: float(row_smooth[run[0] : run[1] + 1].sum()) for run in runs
    }

    def column_peak_count(run, min_distance=120, threshold_ratio=0.3):
        start, end = run
        sub = mask[start : end + 1, :]
        row_density_local = sub.sum(axis=1).astype(np.float32) / 255.0
        if row_density_local.size == 0 or row_density_local.max() <= 0:
            return 0
        dense = row_density_local > row_density_local.max() * 0.7
        if not dense.any():
            return 0
        dense_rows = sub[dense]
        col = dense_rows.sum(axis=0).astype(np.float32) / 255.0
        col_smooth_local = np.convolve(col, np.ones(11, dtype=np.float32) / 11.0, mode="same")
        col_max = float(col_smooth_local.max())
        if col_max <= 0:
            return 0
        candidates_local = []
        for x in range(1, len(col_smooth_local) - 1):
            if (
                col_smooth_local[x] > col_smooth_local[x - 1]
                and col_smooth_local[x] >= col_smooth_local[x + 1]
                and col_smooth_local[x] > col_max * threshold_ratio
            ):
                candidates_local.append((x, float(col_smooth_local[x])))
        candidates_local.sort(key=lambda c: c[1], reverse=True)
        selected_local = []
        for x, value in candidates_local:
            if all(abs(x - other_x) >= min_distance for other_x, _ in selected_local):
                selected_local.append((x, value))
        return len(selected_local)

    run_peaks = {run: column_peak_count(run) for run in runs}
    test_section_runs = [run for run in runs if run_peaks[run] == 5]
    if len(test_section_runs) >= target_count:
        runs = test_section_runs

    def tighten_to_dense_core(run, threshold_ratio=0.8):
        start, end = run
        if end <= start:
            return run
        interior = row_smooth[start : end + 1]
        if interior.size == 0:
            return run
        local_max = float(interior.max())
        if local_max <= 0:
            return run
        above = interior > local_max * threshold_ratio
        if not above.any():
            return run
        first = int(np.argmax(above))
        last = len(above) - 1 - int(np.argmax(above[::-1]))
        return (start + first, start + last)

    runs_by_y = sorted(runs, key=lambda run: run[0])
    if len(runs_by_y) == target_count:
        chosen = runs_by_y
    else:
        best_chain = None
        best_score = None
        for chain in itertools.combinations(runs_by_y, target_count):
            centers = [(run[0] + run[1]) / 2.0 for run in chain]
            spacings = [
                centers[index + 1] - centers[index] for index in range(target_count - 1)
            ]
            if min(spacings) <= 0:
                continue

            mean_spacing = sum(spacings) / len(spacings)
            spacing_var = sum((s - mean_spacing) ** 2 for s in spacings) / len(spacings)
            spacing_cv = (spacing_var ** 0.5) / mean_spacing

            contents = [run_content[run] for run in chain]
            mean_content = sum(contents) / len(contents)
            if mean_content <= 0:
                continue
            content_var = sum((c - mean_content) ** 2 for c in contents) / len(contents)
            content_cv = (content_var ** 0.5) / mean_content

            score = spacing_cv + content_cv
            if best_score is None or score < best_score:
                best_score = score
                best_chain = chain
        if best_chain is None:
            raise HTTPException(
                status_code=500,
                detail="Projection could not find a uniformly-spaced chain of section runs",
            )
        chosen = list(best_chain)

    test_top = min(run[0] for run in chosen)
    test_bottom = max(run[1] for run in chosen)
    test_mask = mask[test_top : test_bottom + 1, :]

    test_row_density = test_mask.sum(axis=1).astype(np.float32) / 255.0
    test_row_max = float(test_row_density.max())
    if test_row_max > 0:
        dense_row_mask = test_row_density > test_row_max * 0.7
        if dense_row_mask.any():
            dense_rows = test_mask[dense_row_mask]
            test_col_density = dense_rows.sum(axis=0).astype(np.float32) / 255.0
        else:
            test_col_density = test_mask.sum(axis=0).astype(np.float32) / 255.0
    else:
        test_col_density = test_mask.sum(axis=0).astype(np.float32) / 255.0

    test_col_smooth = np.convolve(test_col_density, smoothing_kernel, mode="same")
    test_col_max = float(test_col_smooth.max())
    if test_col_max > 0:
        test_col_threshold = test_col_max * 0.65
        test_content_cols = test_col_smooth > test_col_threshold
        if test_content_cols.any():
            x_shared_1 = int(np.argmax(test_content_cols))
            x_shared_2 = int(
                len(test_content_cols) - 1 - np.argmax(test_content_cols[::-1])
            )
        else:
            x_shared_1 = int(width * 0.08)
            x_shared_2 = int(width * 0.92)
    else:
        x_shared_1 = int(width * 0.08)
        x_shared_2 = int(width * 0.92)

    bands = {}
    for index, name in enumerate(SECTION_CONFIG):
        y_start, y_end = chosen[index]
        bands[name] = {
            "y1": int(y_start + pad_y),
            "y2": int(y_end - pad_y),
            "x1": x_shared_1,
            "x2": x_shared_2,
        }

    return bands, {
        "row_density": row_smooth,
        "runs": runs,
        "chosen_runs": chosen,
        "content_threshold": float(content_threshold),
        "col_bounds": (x_shared_1, x_shared_2),
    }


COLUMN_PEAK_EDGE_RATIO = 0.25
COLUMN_CROP_CLEARANCE = 20
COLUMN_PEAK_MIN_DISTANCE = 180


def find_column_peak_bounds(gray, y_top, y_bottom, expected=5):
    if y_bottom <= y_top:
        return None
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    sub_mask = mask[y_top : y_bottom + 1, :]
    col_density = sub_mask.sum(axis=0).astype(np.float32) / 255.0
    kernel = np.ones(11, dtype=np.float32) / 11.0
    smooth = np.convolve(col_density, kernel, mode="same")

    candidates = []
    for x in range(1, len(smooth) - 1):
        if smooth[x] > smooth[x - 1] and smooth[x] >= smooth[x + 1]:
            candidates.append((x, float(smooth[x])))

    candidates.sort(key=lambda c: c[1], reverse=True)

    selected = []
    for x, value in candidates:
        if all(abs(x - other_x) >= COLUMN_PEAK_MIN_DISTANCE for other_x, _ in selected):
            selected.append((x, value))
        if len(selected) >= expected:
            break

    if len(selected) < expected:
        return None

    selected.sort(key=lambda p: p[0])

    bounds = []
    for x, peak_value in selected:
        edge = peak_value * COLUMN_PEAK_EDGE_RATIO
        left = x
        while left > 0 and smooth[left - 1] > edge:
            left -= 1
        right = x
        while right < len(smooth) - 1 and smooth[right + 1] > edge:
            right += 1
        bounds.append((int(left), int(right)))

    return bounds


def split_omr(gray, mode="legacy"):
    column_bounds = None
    if mode == "projection":
        bands, projection_info = detect_section_bands_via_projection(gray)
        lines = []
        dividers = []
        bottom = None
        if bands:
            test_top = min(b["y1"] for b in bands.values())
            test_bottom = max(b["y2"] for b in bands.values())
            column_bounds = find_column_peak_bounds(gray, test_top, test_bottom)
    else:
        lines = detect_horizontal_rules(gray)
        bands, dividers, bottom = build_section_bands(lines, pad_y=15)
        projection_info = None

    results = []
    debug_blocks = []

    image_h, image_w = gray.shape[:2]

    for name, band in bands.items():
        y1 = band["y1"]
        y2 = band["y2"]
        x1 = band["x1"]
        x2 = band["x2"]

        if y2 <= y1 or x2 <= x1:
            continue

        if column_bounds is not None:
            crop_y1 = max(0, y1 - COLUMN_CROP_CLEARANCE)
            crop_y2 = min(image_h, y2 + COLUMN_CROP_CLEARANCE)
            for column_index, (col_left, col_right) in enumerate(column_bounds):
                crop_x1 = max(0, col_left - COLUMN_CROP_CLEARANCE)
                crop_x2 = min(image_w, col_right + COLUMN_CROP_CLEARANCE)
                crop = gray[crop_y1:crop_y2, crop_x1:crop_x2]
                results.append(
                    {
                        "section": name,
                        "column": column_index + 1,
                        "image": encode_crop_base64(crop),
                    }
                )
                debug_blocks.append(
                    {
                        "section": name,
                        "column": column_index,
                        "coords": (crop_x1, crop_y1, crop_x2, crop_y2),
                    }
                )
        else:
            section = gray[y1:y2, x1:x2]
            _, section_width = section.shape
            column_width = section_width / 5.0
            for column_index in range(5):
                crop_x1 = int(round(column_index * column_width))
                crop_x2 = int(round((column_index + 1) * column_width))
                crop = section[:, crop_x1:crop_x2]
                results.append(
                    {
                        "section": name,
                        "column": column_index + 1,
                        "image": encode_crop_base64(crop),
                    }
                )
                debug_blocks.append(
                    {
                        "section": name,
                        "column": column_index,
                        "coords": (x1 + crop_x1, y1, x1 + crop_x2, y2),
                    }
                )

    return results, {
        "lines": lines,
        "dividers": dividers,
        "bottom": bottom,
        "bands": bands,
        "debug_blocks": debug_blocks,
        "projection": projection_info,
        "column_bounds": column_bounds,
    }


def _bubble_darkness(roi: np.ndarray) -> float:
    if roi.size == 0:
        return 0.0
    return 255.0 - float(roi.mean())


def _score_bubble_row(row_gray: np.ndarray, num_bubbles: int = 4):
    height, width = row_gray.shape[:2]
    if height < 5 or width < 5:
        return None, 0.0

    skip = int(width * BUBBLE_LEFT_SKIP_RATIO)
    if skip >= width - 5:
        return None, 0.0
    bubble_zone = row_gray[:, skip:]
    zone_height, zone_width = bubble_zone.shape[:2]

    v_margin = max(1, int(zone_height * BUBBLE_VERTICAL_MARGIN_RATIO))
    if zone_height - 2 * v_margin < 5:
        return None, 0.0
    bubble_zone = bubble_zone[v_margin : zone_height - v_margin]

    bubble_width = zone_width / num_bubbles
    darknesses = []
    for index in range(num_bubbles):
        bx1 = int(index * bubble_width)
        bx2 = int((index + 1) * bubble_width)
        bubble = bubble_zone[:, bx1:bx2]
        bw = bubble.shape[1]
        h_margin = int(bw * BUBBLE_HORIZONTAL_MARGIN_RATIO)
        if bw - 2 * h_margin > 5:
            bubble = bubble[:, h_margin : bw - h_margin]
        darknesses.append(_bubble_darkness(bubble))

    sorted_indices = sorted(range(num_bubbles), key=lambda i: darknesses[i], reverse=True)
    darkest = darknesses[sorted_indices[0]]
    second = darknesses[sorted_indices[1]]

    if darkest < BUBBLE_MIN_ABS_DARKNESS:
        return None, 0.0

    margin_ratio = (darkest - second) / darkest if darkest > 0 else 0.0
    if margin_ratio < BUBBLE_MIN_MARGIN_RATIO:
        return None, round(margin_ratio, 3)

    return sorted_indices[0] + 1, round(margin_ratio, 3)


def score_omr(gray: np.ndarray, bands: dict):
    answers = {}
    confidences = {}
    bubble_grid = {}

    for section_name, total in SECTION_CONFIG.items():
        if section_name not in bands or section_name not in SECTION_LAYOUT:
            answers[section_name] = [None] * total
            confidences[section_name] = [0.0] * total
            continue

        band = bands[section_name]
        y1, y2 = band["y1"], band["y2"]
        x1, x2 = band["x1"], band["x2"]
        section = gray[y1:y2, x1:x2]
        if section.size == 0 or y2 <= y1 or x2 <= x1:
            answers[section_name] = [None] * total
            confidences[section_name] = [0.0] * total
            continue

        section_height, section_width = section.shape
        column_width = section_width / 5.0
        layout = SECTION_LAYOUT[section_name]
        section_answers = []
        section_conf = []
        section_grid = []

        for column_index in range(5):
            cx1 = int(column_index * column_width)
            cx2 = int((column_index + 1) * column_width)
            column = section[:, cx1:cx2]
            column_height = column.shape[0]
            expected_rows = layout[column_index]
            row_height = column_height / expected_rows

            for row_index in range(expected_rows):
                ry1 = int(row_index * row_height)
                ry2 = int((row_index + 1) * row_height)
                row = column[ry1:ry2]
                answer, confidence = _score_bubble_row(row)
                section_answers.append(answer)
                section_conf.append(confidence)
                section_grid.append(
                    {
                        "column": column_index + 1,
                        "row": row_index + 1,
                        "answer": answer,
                        "confidence": confidence,
                        "x1": x1 + cx1,
                        "x2": x1 + cx2,
                        "y1": y1 + ry1,
                        "y2": y1 + ry2,
                    }
                )

        answers[section_name] = section_answers
        confidences[section_name] = section_conf
        bubble_grid[section_name] = section_grid

    return answers, confidences, bubble_grid


def _draw_projection_curve(vis, projection_info):
    row_density = projection_info["row_density"]
    threshold = projection_info["content_threshold"]
    runs = projection_info.get("runs", [])
    chosen = projection_info.get("chosen_runs", [])
    height, width = vis.shape[:2]

    plot_width = max(60, width // 12)
    plot_x = width - plot_width - 8
    max_density = max(float(row_density.max()), 1.0)

    cv2.rectangle(vis, (plot_x - 2, 0), (width - 6, height - 1), (40, 40, 40), 1)

    previous_x = plot_x
    previous_y = 0
    for y in range(height):
        value = float(row_density[y]) if y < len(row_density) else 0.0
        x = plot_x + int((value / max_density) * (plot_width - 2))
        if y > 0:
            cv2.line(vis, (previous_x, previous_y), (x, y), (255, 255, 0), 1)
        previous_x = x
        previous_y = y

    threshold_x = plot_x + int((threshold / max_density) * (plot_width - 2))
    cv2.line(vis, (threshold_x, 0), (threshold_x, height - 1), (0, 200, 200), 1)

    for run_start, run_end in runs:
        cv2.rectangle(
            vis,
            (plot_x - 2, run_start),
            (width - 6, run_end),
            (80, 80, 80),
            1,
        )

    for run_start, run_end in chosen:
        cv2.rectangle(
            vis,
            (plot_x - 2, run_start),
            (width - 6, run_end),
            (0, 255, 0),
            2,
        )


def draw_debug(gray, debug_info):
    vis = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    for line in debug_info["lines"]:
        color = (0, 0, 255) if line["is_major"] else (0, 255, 0)
        cv2.line(vis, (line["x1"], line["y"]), (line["x2"], line["y"]), color, 2)

    for divider in debug_info["dividers"]:
        cv2.line(
            vis,
            (divider["x1"], divider["y"]),
            (divider["x2"], divider["y"]),
            (255, 0, 255),
            2,
        )

    bottom = debug_info.get("bottom")
    if bottom is not None:
        cv2.line(vis, (bottom["x1"], bottom["y"]), (bottom["x2"], bottom["y"]), (255, 255, 0), 2)

    for name, band in debug_info["bands"].items():
        x1, x2 = band["x1"], band["x2"]
        y1, y2 = band["y1"], band["y2"]
        cv2.rectangle(vis, (x1, y1), (x2, y2), (255, 0, 0), 2)
        cv2.putText(vis, name, (x1 + 6, y1 + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 0), 2)

    for block in debug_info["debug_blocks"]:
        x1, y1, x2, y2 = block["coords"]
        cv2.rectangle(vis, (x1, y1), (x2, y2), (0, 165, 255), 2)

    return vis


def normalize_answer(raw_value):
    if raw_value is None:
        return None

    if isinstance(raw_value, bool):
        raise ValueError("Boolean values are not valid answer choices")

    if isinstance(raw_value, int):
        if raw_value in {1, 2, 3, 4}:
            return raw_value
        raise ValueError(f"Unsupported numeric answer: {raw_value}")

    if isinstance(raw_value, float) and raw_value.is_integer():
        return normalize_answer(int(raw_value))

    if isinstance(raw_value, str):
        cleaned = raw_value.strip().upper()
        if cleaned in NULL_MARKERS:
            return None
        if cleaned in ANSWER_VALUE_MAP:
            return ANSWER_VALUE_MAP[cleaned]

    raise ValueError(f"Unsupported answer value: {raw_value}")


def normalize_answer_keys(payload):
    if not isinstance(payload, dict):
        raise ValueError("Answer keys must be an object keyed by section")

    normalized = {}
    for section_name, expected_count in SECTION_CONFIG.items():
        raw_answers = payload.get(section_name)
        if not isinstance(raw_answers, list):
            raise ValueError(f"Section '{section_name}' must be a list")
        if len(raw_answers) != expected_count:
            raise ValueError(
                f"Section '{section_name}' must contain {expected_count} answers, received {len(raw_answers)}"
            )

        normalized[section_name] = [normalize_answer(value) for value in raw_answers]

    return normalized


def build_module_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "title": {"type": "string"},
            "subtitle": {"type": "string"},
            "topic": {"type": "string"},
            "reason": {"type": "string"},
            "priority": {"type": "string"},
        },
        "required": ["id", "title"],
    }


def build_scoring_schema():
    def section_schema():
        return {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "title": {"type": "string"},
                "totalQuestions": {"type": "integer"},
                "totalPossible": {"type": "integer"},
                "notScored": {"type": "array", "items": {"type": "integer"}},
                "answerKey": {"type": "array", "items": {"type": "string"}},
                "categoryByQuestion": {"type": "array", "items": {"type": "string"}},
                "categoryDisplayNames": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "code": {"type": "string"},
                            "label": {"type": "string"},
                        },
                        "required": ["code", "label"],
                    },
                },
                "categoryOrder": {"type": "array", "items": {"type": "string"}},
                "groupedCategories": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "code": {"type": "string"},
                            "label": {"type": "string"},
                            "members": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["code", "members"],
                    },
                },
                "rawToScale": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "raw": {"type": "integer"},
                            "scale": {"type": "integer"},
                        },
                        "required": ["raw", "scale"],
                    },
                },
            },
            "required": [
                "title",
                "totalQuestions",
                "totalPossible",
                "notScored",
                "answerKey",
                "categoryByQuestion",
                "categoryDisplayNames",
                "categoryOrder",
                "groupedCategories",
                "rawToScale",
            ],
        }

    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "profileId": {"type": "string"},
            "summary": {"type": "string"},
            "sections": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "english": section_schema(),
                    "math": section_schema(),
                    "reading": section_schema(),
                    "science": section_schema(),
                },
                "required": ["english", "math", "reading", "science"],
            },
        },
        "required": ["profileId", "summary", "sections"],
    }


def build_recommendation_section_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "section": {"type": "string"},
            "summary": {"type": "string"},
            "strategy": {"type": "array", "items": build_module_schema()},
            "categories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "code": {"type": "string"},
                        "label": {"type": "string"},
                        "bands": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "minScore": {"type": "integer"},
                                    "maxScore": {"type": "integer"},
                                    "priority": {"type": "string"},
                                    "reason": {"type": "string"},
                                    "items": {"type": "array", "items": build_module_schema()},
                                },
                                "required": ["items"],
                            },
                        },
                    },
                    "required": ["code", "label", "bands"],
                },
            },
        },
        "required": ["section", "summary", "strategy", "categories"],
    }


def get_anthropic_client():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not configured for PDF extraction.",
        )

    try:
        import anthropic
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="The anthropic package is required for PDF extraction.",
        ) from exc

    return anthropic.Anthropic(api_key=api_key)


def extract_pdf_tool_payload(pdf_bytes, prompt, tool_name, input_schema):
    client = get_anthropic_client()
    pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")

    try:
        response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=4096,
            tools=[
                {
                    "name": tool_name,
                    "description": "Return the extracted structured data for the uploaded PDF.",
                    "input_schema": input_schema,
                }
            ],
            tool_choice={"type": "tool", "name": tool_name},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": pdf_base64,
                            },
                        },
                        {
                            "type": "text",
                            "text": prompt,
                        },
                    ],
                }
            ],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Claude extraction request failed: {exc}",
        ) from exc

    tool_block = next(
        (block for block in response.content if getattr(block, "type", None) == "tool_use"),
        None,
    )
    if tool_block is None:
        raise HTTPException(
            status_code=502,
            detail="Claude did not return the expected tool payload.",
        )

    return dict(tool_block.input)


def normalize_scoring_section(section_name, raw_section):
    if not isinstance(raw_section, dict):
        raise ValueError(f"Section '{section_name}' must be an object")

    expected_total_questions = SECTION_CONFIG[section_name]
    total_questions = int(raw_section.get("totalQuestions") or expected_total_questions)
    if total_questions != expected_total_questions:
        raise ValueError(
            f"Section '{section_name}' must contain {expected_total_questions} questions"
        )

    raw_answer_key = raw_section.get("answerKey")
    if not isinstance(raw_answer_key, list) or len(raw_answer_key) != total_questions:
        raise ValueError(
            f"Section '{section_name}' answerKey must contain {total_questions} entries"
        )

    raw_category_by_question = raw_section.get("categoryByQuestion")
    if (
        not isinstance(raw_category_by_question, list)
        or len(raw_category_by_question) != total_questions
    ):
        raise ValueError(
            f"Section '{section_name}' categoryByQuestion must contain {total_questions} entries"
        )

    not_scored = sorted({int(value) for value in raw_section.get("notScored", [])})
    category_display_names = {
        str(item["code"]).strip(): str(item["label"]).strip()
        for item in raw_section.get("categoryDisplayNames", [])
        if isinstance(item, dict) and str(item.get("code", "")).strip()
    }
    grouped_categories = {
        str(item["code"]).strip(): [
            str(member).strip()
            for member in item.get("members", [])
            if str(member).strip()
        ]
        for item in raw_section.get("groupedCategories", [])
        if isinstance(item, dict) and str(item.get("code", "")).strip()
    }
    raw_to_scale = {
        int(item["raw"]): int(item["scale"])
        for item in raw_section.get("rawToScale", [])
        if isinstance(item, dict)
        and item.get("raw") is not None
        and item.get("scale") is not None
    }
    category_order = [
        str(code).strip()
        for code in raw_section.get("categoryOrder", [])
        if str(code).strip()
    ]

    answer_key = [normalize_answer(value) for value in raw_answer_key]
    category_by_question = []
    for raw_category in raw_category_by_question:
        cleaned = str(raw_category).strip().upper() if raw_category is not None else ""
        if cleaned in {"", "NULL", "NONE", "-", "N/A", "NA"}:
            category_by_question.append(None)
        else:
            category_by_question.append(cleaned)

    return {
        "title": str(raw_section.get("title") or section_name.title()),
        "totalQuestions": total_questions,
        "totalPossible": int(raw_section.get("totalPossible") or 0),
        "notScored": not_scored,
        "answerKey": answer_key,
        "categoryByQuestion": category_by_question,
        "categoryDisplayNames": category_display_names,
        "categoryOrder": category_order,
        "groupedCategories": grouped_categories,
        "rawToScale": raw_to_scale,
    }


def normalize_scoring_config(payload):
    if not isinstance(payload, dict):
        raise ValueError("Scoring config must be an object")

    sections = payload.get("sections")
    if not isinstance(sections, dict):
        raise ValueError("Scoring config sections are required")

    normalized_sections = {
        section_name: normalize_scoring_section(section_name, sections.get(section_name))
        for section_name in SECTION_CONFIG
    }
    answer_keys = {
        section_name: normalized_sections[section_name]["answerKey"]
        for section_name in SECTION_CONFIG
    }
    normalize_answer_keys(answer_keys)

    return {
        "profileId": str(payload.get("profileId") or "").strip() or "custom",
        "summary": str(payload.get("summary") or "").strip(),
        "sections": normalized_sections,
    }


def normalize_module(raw_item, fallback_prefix, index):
    if not isinstance(raw_item, dict):
        raise ValueError("Recommendation module must be an object")

    title = str(raw_item.get("title") or "").strip()
    if not title:
        raise ValueError("Recommendation module title is required")

    normalized = {
        "id": str(raw_item.get("id") or f"{fallback_prefix}-{index}").strip(),
        "title": title,
    }

    for field_name in ("subtitle", "topic", "reason", "priority"):
        value = raw_item.get(field_name)
        if value is not None and str(value).strip():
            normalized[field_name] = str(value).strip()

    return normalized


def normalize_recommendation_section(section_name, payload):
    if not isinstance(payload, dict):
        raise ValueError(f"Recommendation section '{section_name}' must be an object")

    strategy = [
        normalize_module(item, f"{section_name}-strategy", index)
        for index, item in enumerate(payload.get("strategy", []), start=1)
    ]
    categories = {}

    for raw_category in payload.get("categories", []):
        if not isinstance(raw_category, dict):
            raise ValueError("Recommendation category must be an object")

        code = str(raw_category.get("code") or "").strip().upper()
        label = str(raw_category.get("label") or code).strip()
        if not code:
            raise ValueError("Recommendation category code is required")

        bands = []
        for band_index, raw_band in enumerate(raw_category.get("bands", []), start=1):
            if not isinstance(raw_band, dict):
                raise ValueError("Recommendation band must be an object")

            items = [
                normalize_module(item, f"{section_name}-{code}", item_index)
                for item_index, item in enumerate(raw_band.get("items", []), start=1)
            ]
            if not items:
                continue

            normalized_band = {"items": items}
            for source_name, target_name in (("minScore", "min"), ("maxScore", "max")):
                value = raw_band.get(source_name)
                if value is not None and str(value).strip() != "":
                    normalized_band[target_name] = int(value)

            for field_name in ("priority", "reason"):
                value = raw_band.get(field_name)
                if value is not None and str(value).strip():
                    normalized_band[field_name] = str(value).strip()

            bands.append(normalized_band)

        categories[code] = {
            "label": label,
            "bands": bands,
        }

    return {
        "section": section_name,
        "summary": str(payload.get("summary") or "").strip(),
        "strategy": strategy,
        "categories": categories,
    }


def extract_scoring_config_from_pdf(pdf_bytes, filename):
    extracted = extract_pdf_tool_payload(
        pdf_bytes,
        (
            "You are extracting a complete ACT scoring rubric from the uploaded PDF. "
            "Return a scoring config for the sections english (50), math (45), reading (36), and science (40). "
            "For answerKey, output one entry per question using A/B/C/D/F/G/H/J or 'null'. "
            "For categoryByQuestion, output one entry per question using the category code or 'null'. "
            "Include totalQuestions, totalPossible, notScored question numbers, categoryDisplayNames, "
            "categoryOrder, groupedCategories such as PHM where present, and the rawToScale table. "
            "Use profileId 'act-p1' only if the rubric clearly identifies ACT Practice Test 1; otherwise use a stable custom id. "
            "Also provide a short summary of what was extracted and any ambiguity. You must call the tool."
        ),
        "submit_scoring_config",
        build_scoring_schema(),
    )
    normalized = normalize_scoring_config(extracted)
    return normalized, normalized["summary"]


def extract_recommendation_section_from_pdf(section_name, pdf_bytes, filename):
    extracted = extract_pdf_tool_payload(
        pdf_bytes,
        (
            f"You are extracting ACT {section_name} study recommendation rules from the uploaded PDF. "
            "Return strategy modules plus category-based recommendation bands. "
            "Keep the modules in the order shown in the PDF. "
            "If a category always recommends the same materials, include one band with only items. "
            "If a score range is specified, put it in minScore and maxScore. "
            "Also provide a short summary and call the tool."
        ),
        f"submit_{section_name}_recommendations",
        build_recommendation_section_schema(),
    )
    normalized = normalize_recommendation_section(section_name, extracted)
    return normalized, normalized["summary"]


def build_test_package_from_uploads(scoring_pdf_bytes, scoring_filename, recommendation_pdfs):
    scoring_config, scoring_summary = extract_scoring_config_from_pdf(
        scoring_pdf_bytes, scoring_filename
    )
    recommendation_sections = {}
    recommendation_summaries = []

    for section_name, upload_payload in recommendation_pdfs.items():
        section_config, section_summary = extract_recommendation_section_from_pdf(
            section_name,
            upload_payload["bytes"],
            upload_payload["filename"],
        )
        recommendation_sections[section_name] = section_config
        if section_summary:
            recommendation_summaries.append(f"{section_name.title()}: {section_summary}")

    recommendation_config = {
        "summary": " | ".join(recommendation_summaries),
        "sections": recommendation_sections,
    }
    extraction_summary = " | ".join(
        part for part in [scoring_summary, recommendation_config["summary"]] if part
    )
    return scoring_config, recommendation_config, extraction_summary


def section_counts(answer_keys):
    return {
        section_name: {
            "total": len(answers),
            "answered": sum(value is not None for value in answers),
            "blank": sum(value is None for value in answers),
        }
        for section_name, answers in answer_keys.items()
    }


def serialize_test(row, include_answer_keys=False):
    answer_keys = json.loads(row["answer_keys_json"])
    payload = {
        "id": row["id"],
        "name": row["name"],
        "sourceFilename": row["source_filename"],
        "extractionSummary": row["extraction_summary"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "sectionCounts": section_counts(answer_keys),
        "configStatus": row["config_status"] or "legacy",
        "recommendationFilenames": (
            json.loads(row["recommendation_filenames_json"])
            if row["recommendation_filenames_json"]
            else {}
        ),
    }

    if include_answer_keys:
        payload["answerKeys"] = answer_keys
        payload["scoringConfig"] = (
            json.loads(row["scoring_config_json"]) if row["scoring_config_json"] else None
        )
        payload["recommendationConfig"] = (
            json.loads(row["recommendation_config_json"])
            if row["recommendation_config_json"]
            else None
        )

    return payload


def list_tests(include_answer_keys=False):
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, name, answer_keys_json, source_filename, extraction_summary, created_at, updated_at,
                   scoring_config_json, recommendation_config_json, recommendation_filenames_json, config_status
            FROM tests
            ORDER BY datetime(created_at) DESC, id DESC
            """
        ).fetchall()

    return [serialize_test(row, include_answer_keys=include_answer_keys) for row in rows]


def save_test(
    name,
    answer_keys,
    source_filename=None,
    extraction_summary=None,
    scoring_config=None,
    recommendation_config=None,
    recommendation_filenames=None,
    config_status=None,
):
    created_at = utc_now_iso()
    answer_keys_json = json.dumps(answer_keys)
    scoring_config_json = json.dumps(scoring_config) if scoring_config else None
    recommendation_config_json = (
        json.dumps(recommendation_config) if recommendation_config else None
    )
    recommendation_filenames_json = (
        json.dumps(recommendation_filenames) if recommendation_filenames else None
    )

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO tests (
                name,
                answer_keys_json,
                source_filename,
                extraction_summary,
                created_at,
                updated_at,
                scoring_config_json,
                recommendation_config_json,
                recommendation_filenames_json,
                config_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                answer_keys_json,
                source_filename,
                extraction_summary,
                created_at,
                created_at,
                scoring_config_json,
                recommendation_config_json,
                recommendation_filenames_json,
                config_status,
            ),
        )
        connection.commit()
        test_id = cursor.lastrowid
        row = connection.execute(
            """
            SELECT id, name, answer_keys_json, source_filename, extraction_summary, created_at, updated_at,
                   scoring_config_json, recommendation_config_json, recommendation_filenames_json, config_status
            FROM tests
            WHERE id = ?
            """,
            (test_id,),
        ).fetchone()

    return serialize_test(row, include_answer_keys=True)


def require_admin(credentials: HTTPBasicCredentials = Depends(security)):
    is_valid = secrets.compare_digest(credentials.username, ADMIN_USERNAME) and secrets.compare_digest(
        credentials.password, ADMIN_PASSWORD
    )
    if not is_valid:
        raise HTTPException(
            status_code=401,
            detail="Invalid admin credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


@app.get("/health")
def health():
    return {"status": "ok", "tests": len(list_tests(include_answer_keys=False))}


@app.post("/me/results")
def save_result(
    body: dict = Body(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    results = body.get("results")
    if not results:
        raise HTTPException(status_code=400, detail="results required")
    scores = body.get("scores")
    scan = ScanResult(
        user_id=user.id,
        test_id=str(body["testId"]) if body.get("testId") else None,
        test_name=body.get("testName"),
        results_json=json.dumps(results),
        scores_json=json.dumps(scores) if scores else None,
        source=body.get("source", "manual"),
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return {"id": scan.id, "createdAt": scan.created_at.isoformat()}


@app.post("/feedback")
def submit_feedback(payload: dict = Body(...)):
    allowed_keys = {
        "testId",
        "testName",
        "section",
        "questionNumber",
        "detectedNumeric",
        "detectedLetter",
        "expectedNumeric",
        "source",
        "timestamp",
    }
    cleaned = {k: payload.get(k) for k in allowed_keys if k in payload}
    cleaned["receivedAt"] = utc_now_iso()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with FEEDBACK_LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(cleaned, ensure_ascii=False) + "\n")

    return {"ok": True}


@app.post("/auth/register")
def auth_register(body: dict = Body(...), db: Session = Depends(get_db)):
    invite_code = (body.get("invite_code") or "").strip()
    # Check invite code: accept env var OR any active code in the database
    env_ok = SIGNUP_INVITE_CODE and invite_code == SIGNUP_INVITE_CODE
    db_ok = db.query(InviteCode).filter(InviteCode.code == invite_code, InviteCode.active == True).first() is not None  # noqa: E712
    has_any_code = SIGNUP_INVITE_CODE or db.query(InviteCode).filter(InviteCode.active == True).first() is not None  # noqa: E712
    if has_any_code and not env_ok and not db_ok:
        raise HTTPException(status_code=403, detail="Invalid invite code. Ask your instructor for the correct code.")

    username = (body.get("username") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not username or not email or not password:
        raise HTTPException(status_code=400, detail="username, email, and password are required")
    if len(username) < 2 or len(username) > 50:
        raise HTTPException(status_code=400, detail="Username must be 2–50 characters")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=409, detail="Username already taken")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(username=username, email=email, hashed_password=hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_jwt(user.id, user.username, user.role)
    response = FResponse(content=json.dumps({"id": user.id, "username": user.username, "email": user.email, "role": user.role}), media_type="application/json", status_code=201)
    response.set_cookie(COOKIE_NAME, token, httponly=True, samesite="none", max_age=60 * 60 * 24 * 30, secure=True)
    return response


@app.post("/auth/login")
def auth_login(body: dict = Body(...), db: Session = Depends(get_db)):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_jwt(user.id, user.username, user.role)
    response = FResponse(content=json.dumps({"id": user.id, "username": user.username, "email": user.email, "role": user.role}), media_type="application/json")
    response.set_cookie(COOKIE_NAME, token, httponly=True, samesite="none", max_age=60 * 60 * 24 * 30, secure=True)
    return response


@app.post("/auth/logout")
def auth_logout():
    response = FResponse(content=json.dumps({"ok": True}), media_type="application/json")
    response.delete_cookie(COOKIE_NAME)
    return response


@app.get("/auth/me")
def auth_me(user: User | None = Depends(get_current_user)):
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"id": user.id, "username": user.username, "email": user.email, "role": user.role}


@app.get("/me/results")
def my_results(user: User = Depends(require_user), db: Session = Depends(get_db)):
    rows = (
        db.query(ScanResult)
        .filter(ScanResult.user_id == user.id)
        .order_by(ScanResult.created_at.desc())
        .limit(50)
        .all()
    )
    return {
        "results": [
            {
                "id": r.id,
                "testId": r.test_id,
                "testName": r.test_name,
                "results": json.loads(r.results_json),
                "scores": json.loads(r.scores_json) if r.scores_json else None,
                "source": r.source,
                "createdAt": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


@app.post("/me/email-results")
async def email_results(
    body: dict = Body(...),
    user: User = Depends(require_user),
):
    import os
    from pdf_report import build_pdf

    test_name = body.get("testName") or "ACT Practice Test"
    answers = body.get("answers") or {}
    scores = body.get("scores")
    created_at = body.get("createdAt") or utc_now_iso()[:10]

    pdf_bytes = build_pdf(
        username=user.username,
        email=user.email,
        test_name=test_name,
        answers=answers,
        scores=scores,
        created_at=created_at,
    )

    subject = f"Your Prepmedians Score Report — {test_name}"
    html_body = f"""
    <p>Hi {user.username},</p>
    <p>Your score report for <strong>{test_name}</strong> is attached as a PDF.</p>
    <p>Log back in anytime at <a href="https://grader.prepmedians.com">grader.prepmedians.com</a> to see your full history and study plan.</p>
    <p>— The Prepmedians Team</p>
    """

    api_key = os.getenv("RESEND_API_KEY", "")
    if api_key:
        try:
            import resend as resend_sdk
            resend_sdk.api_key = api_key
            import base64 as _b64
            resend_sdk.Emails.send({
                "from": "Prepmedians <noreply@prepmedians.com>",
                "to": [user.email],
                "subject": subject,
                "html": html_body,
                "attachments": [
                    {
                        "filename": f"score-report-{created_at}.pdf",
                        "content": list(_b64.b64encode(pdf_bytes)),
                    }
                ],
            })
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Email send failed: {exc}") from exc
    else:
        print(f"[email-results] RESEND_API_KEY not set — would email {user.email}: {subject}")

    return {"ok": True, "emailedTo": user.email}


@app.get("/admin/analytics")
def admin_analytics(_: User = Depends(require_educator), db: Session = Depends(get_db)):
    from sqlalchemy import func

    total_students = db.query(func.count(User.id)).scalar()
    total_scans = db.query(func.count(ScanResult.id)).scalar()

    # Average scaled scores across all results that have scores_json
    scored_rows = db.query(ScanResult.scores_json).filter(ScanResult.scores_json.isnot(None)).all()
    section_totals: dict[str, list[int]] = {k: [] for k in ("english", "math", "reading", "science")}
    for (scores_json_str,) in scored_rows:
        try:
            s = json.loads(scores_json_str)
            for key in section_totals:
                val = s.get(key, {})
                scale = val.get("scaleScore") if isinstance(val, dict) else None
                if isinstance(scale, (int, float)):
                    section_totals[key].append(int(scale))
        except Exception:
            continue

    avg_scores = {
        k: round(sum(v) / len(v), 1) if v else None
        for k, v in section_totals.items()
    }

    # Scans per week for the last 8 weeks (using created_at)
    from sqlalchemy import text as _text2
    weekly = db.execute(
        _text2(
            "SELECT strftime('%Y-W%W', created_at) as week, COUNT(*) as cnt "
            "FROM scan_results GROUP BY week ORDER BY week DESC LIMIT 8"
        )
    ).fetchall()

    return {
        "totalStudents": total_students,
        "totalScans": total_scans,
        "avgScores": avg_scores,
        "scansPerWeek": [{"week": r[0], "count": r[1]} for r in reversed(weekly)],
    }


@app.get("/admin/users")
def admin_users(_: User = Depends(require_educator), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    result = []
    for u in users:
        latest = (
            db.query(ScanResult)
            .filter(ScanResult.user_id == u.id)
            .order_by(ScanResult.created_at.desc())
            .first()
        )
        result.append({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "role": u.role,
            "createdAt": u.created_at.isoformat(),
            "lastScan": latest.created_at.isoformat() if latest else None,
            "scanCount": db.query(ScanResult).filter(ScanResult.user_id == u.id).count(),
        })
    return {"users": result}


@app.get("/admin/results")
def admin_results(_: User = Depends(require_educator), db: Session = Depends(get_db)):
    rows = (
        db.query(ScanResult, User.username, User.email)
        .join(User, ScanResult.user_id == User.id)
        .order_by(ScanResult.created_at.desc())
        .limit(200)
        .all()
    )
    return {
        "results": [
            {
                "id": r.id,
                "username": username,
                "email": email,
                "testId": r.test_id,
                "testName": r.test_name,
                "results": json.loads(r.results_json),
                "source": r.source,
                "createdAt": r.created_at.isoformat(),
            }
            for r, username, email in rows
        ]
    }


@app.post("/admin/users/{user_id}/role")
def set_user_role(
    user_id: int,
    body: dict = Body(...),
    _: User = Depends(require_educator),
    db: Session = Depends(get_db),
):
    role = body.get("role")
    if role not in ("student", "educator"):
        raise HTTPException(status_code=400, detail="role must be 'student' or 'educator'")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = role
    db.commit()
    return {"id": user.id, "username": user.username, "role": user.role}


# ── Invite codes ──────────────────────────────────────────────


@app.get("/admin/invite-codes")
def list_invite_codes(_: User = Depends(require_educator), db: Session = Depends(get_db)):
    codes = db.query(InviteCode).order_by(InviteCode.created_at.desc()).all()
    return {
        "codes": [
            {"id": c.id, "code": c.code, "active": c.active, "createdAt": c.created_at.isoformat()}
            for c in codes
        ]
    }


@app.post("/admin/invite-codes")
def create_invite_code(body: dict = Body(...), _: User = Depends(require_educator), db: Session = Depends(get_db)):
    code = (body.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Invite code cannot be empty")
    if len(code) < 3 or len(code) > 100:
        raise HTTPException(status_code=400, detail="Invite code must be 3–100 characters")
    if db.query(InviteCode).filter(InviteCode.code == code).first():
        raise HTTPException(status_code=409, detail="This invite code already exists")
    invite = InviteCode(code=code)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return {"id": invite.id, "code": invite.code, "active": invite.active, "createdAt": invite.created_at.isoformat()}


@app.delete("/admin/invite-codes/{code_id}")
def delete_invite_code(code_id: int, _: User = Depends(require_educator), db: Session = Depends(get_db)):
    invite = db.get(InviteCode, code_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite code not found")
    db.delete(invite)
    db.commit()
    return {"ok": True}


@app.patch("/admin/invite-codes/{code_id}")
def toggle_invite_code(code_id: int, body: dict = Body(...), _: User = Depends(require_educator), db: Session = Depends(get_db)):
    invite = db.get(InviteCode, code_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite code not found")
    active = body.get("active")
    if active is None:
        raise HTTPException(status_code=400, detail="'active' field is required")
    invite.active = bool(active)
    db.commit()
    return {"id": invite.id, "code": invite.code, "active": invite.active, "createdAt": invite.created_at.isoformat()}


@app.get("/tests")
def public_tests():
    return {"tests": list_tests(include_answer_keys=False)}


@app.get("/admin/tests")
def admin_tests(_: str = Depends(require_admin)):
    return {"tests": list_tests(include_answer_keys=True)}


@app.post("/admin/tests/import-pdf")
async def import_test_from_pdf(
    name: str = Form(...),
    file: UploadFile | None = File(default=None),
    scoringRubricFile: UploadFile | None = File(default=None),
    englishRecommendationFile: UploadFile | None = File(default=None),
    mathRecommendationFile: UploadFile | None = File(default=None),
    readingRecommendationFile: UploadFile | None = File(default=None),
    scienceRecommendationFile: UploadFile | None = File(default=None),
    _: str = Depends(require_admin),
):
    cleaned_name = name.strip()
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Test name is required.")

    new_workflow_uploads = [
        scoringRubricFile,
        englishRecommendationFile,
        mathRecommendationFile,
        readingRecommendationFile,
        scienceRecommendationFile,
    ]
    is_new_workflow = any(upload is not None for upload in new_workflow_uploads)

    if is_new_workflow:
        required_uploads = {
            "scoring rubric": scoringRubricFile,
            "english recommendations": englishRecommendationFile,
            "math recommendations": mathRecommendationFile,
            "reading recommendations": readingRecommendationFile,
            "science recommendations": scienceRecommendationFile,
        }
        missing_uploads = [
            label for label, upload in required_uploads.items() if upload is None
        ]
        if missing_uploads:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required PDFs: {', '.join(missing_uploads)}.",
            )

        recommendation_pdfs = {}
        recommendation_filenames = {}
        for section_name, upload in (
            ("english", englishRecommendationFile),
            ("math", mathRecommendationFile),
            ("reading", readingRecommendationFile),
            ("science", scienceRecommendationFile),
        ):
            filename = upload.filename or f"{section_name}-recommendations.pdf"
            if not filename.lower().endswith(".pdf"):
                raise HTTPException(
                    status_code=400,
                    detail=f"{section_name.title()} recommendations must be uploaded as a PDF.",
                )

            pdf_bytes = await upload.read()
            if not pdf_bytes:
                raise HTTPException(
                    status_code=400,
                    detail=f"{section_name.title()} recommendations PDF is empty.",
                )

            recommendation_pdfs[section_name] = {
                "bytes": pdf_bytes,
                "filename": filename,
            }
            recommendation_filenames[section_name] = filename

        scoring_filename = scoringRubricFile.filename or "scoring-rubric.pdf"
        if not scoring_filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail="Please upload the scoring rubric as a PDF.",
            )

        scoring_pdf_bytes = await scoringRubricFile.read()
        if not scoring_pdf_bytes:
            raise HTTPException(status_code=400, detail="Uploaded scoring rubric PDF is empty.")

        scoring_config, recommendation_config, extraction_summary = (
            build_test_package_from_uploads(
                scoring_pdf_bytes,
                scoring_filename,
                recommendation_pdfs,
            )
        )
        answer_keys = {
            section_name: scoring_config["sections"][section_name]["answerKey"]
            for section_name in SECTION_CONFIG
        }
        created_test = save_test(
            name=cleaned_name,
            answer_keys=answer_keys,
            source_filename=scoring_filename,
            extraction_summary=extraction_summary,
            scoring_config=scoring_config,
            recommendation_config=recommendation_config,
            recommendation_filenames=recommendation_filenames,
            config_status="configured",
        )
        return {"test": created_test}

    if file is None:
        raise HTTPException(
            status_code=400,
            detail="Upload either a legacy answer-key PDF or the full test package PDFs.",
        )

    filename = file.filename or "answer-key.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF answer key.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")

    extracted = extract_pdf_tool_payload(
        pdf_bytes,
        (
            "You are extracting answer keys from an uploaded test-answer-key PDF. "
            "Return only the official answer key values for the sections english (50), math (45), "
            "reading (36), and science (40). Convert A or F to 1, B or G to 2, C or H to 3, "
            "D or J to 4. If a question has no answer or is unreadable, return the string 'null'. "
            "Do not skip questions. Keep the answers in order. Also provide a short summary of what "
            "you extracted or any ambiguity you noticed. You must call the provided tool."
        ),
        "submit_answer_key",
        {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "english": {"type": "array", "items": {"type": "string"}},
                "math": {"type": "array", "items": {"type": "string"}},
                "reading": {"type": "array", "items": {"type": "string"}},
                "science": {"type": "array", "items": {"type": "string"}},
                "summary": {"type": "string"},
            },
            "required": ["english", "math", "reading", "science", "summary"],
        },
    )
    answer_keys = normalize_answer_keys(extracted)
    created_test = save_test(
        name=cleaned_name,
        answer_keys=answer_keys,
        source_filename=filename,
        extraction_summary=extracted.get("summary", ""),
        config_status="legacy",
    )
    return {"test": created_test}


@app.post("/parse-omr")
async def parse_omr_route(
    file: UploadFile = File(...),
    testId: str | None = Form(default=None),
    testName: str | None = Form(default=None),
):
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded OMR image is empty.")

    form_data = {}
    if testId:
        form_data["testId"] = testId
    if testName:
        form_data["testName"] = testName

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                PARSE_WEBHOOK_URL,
                data=form_data,
                files={
                    "file": (
                        file.filename or "omr-upload.jpg",
                        file_bytes,
                        file.content_type or "application/octet-stream",
                    )
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach the parse webhook: {exc}",
        ) from exc

    content_type = response.headers.get("content-type", "")
    if not response.is_success:
        detail = f"Parse webhook failed with status {response.status_code}"
        if "application/json" in content_type:
            try:
                payload = response.json()
                detail = payload.get("detail") or payload.get("error") or detail
            except ValueError:
                pass
        raise HTTPException(status_code=502, detail=detail)

    if "application/json" in content_type:
        try:
            payload = response.json()
        except ValueError as exc:
            body_preview = response.text[:300].strip()
            raise HTTPException(
                status_code=502,
                detail=(
                    "Parse webhook returned an invalid JSON response."
                    + (f" Preview: {body_preview}" if body_preview else "")
                ),
            ) from exc

        return payload

    raise HTTPException(
        status_code=502,
        detail="Parse webhook returned a non-JSON response.",
    )


@app.post("/split-omr")
async def split_route(
    file: UploadFile = File(...),
    mode: str = Query(default="legacy"),
):
    mode = resolve_mode(mode)
    try:
        img = read_image_from_upload(file)
        gray = preprocess_for_ai(img, mode=mode)
        blocks, debug_info = split_omr(gray, mode=mode)
    except HTTPException as exc:
        if exc.status_code < 500:
            raise

        return {
            "count": 0,
            "dividers": [],
            "inferred_bottom": None,
            "bands": {},
            "blocks": [],
            "_status": "partial",
            "_warnings": [
                f"We could not confidently find all answer columns on this sheet: {exc.detail}"
            ],
        }
    except Exception as exc:
        return {
            "count": 0,
            "dividers": [],
            "inferred_bottom": None,
            "bands": {},
            "blocks": [],
            "_status": "partial",
            "_warnings": [
                f"We could not confidently split this answer sheet: {exc}"
            ],
        }

    return {
        "count": len(blocks),
        "dividers": [divider["y"] for divider in debug_info["dividers"]],
        "inferred_bottom": debug_info["bottom"]["y"] if debug_info.get("bottom") else None,
        "bands": debug_info["bands"],
        "blocks": blocks,
        "_status": "ok" if len(blocks) >= 20 else "partial",
        "_warnings": []
        if len(blocks) >= 20
        else [f"Expected 20 answer columns but found {len(blocks)}."],
    }


@app.post("/debug-boxes")
async def debug_route(
    file: UploadFile = File(...),
    mode: str = Query(default="legacy"),
):
    mode = resolve_mode(mode)
    img = read_image_from_upload(file)
    gray = preprocess_for_ai(img, mode=mode)

    rectify_status = None
    if mode in ("rectified", "projection"):
        gray_height, gray_width = gray.shape[:2]
        rectified_ok = gray_width == RECTIFIED_WIDTH and gray_height == RECTIFIED_HEIGHT
        rectify_status = (
            f"{mode} ok ({gray_width}x{gray_height})"
            if rectified_ok
            else f"{mode} FAILED to warp (kept {gray_width}x{gray_height}) - quad not found"
        )

    debug_info = {
        "lines": [],
        "dividers": [],
        "bottom": None,
        "bands": {},
        "debug_blocks": [],
    }
    warning = None

    column_bounds = None
    if mode == "projection":
        try:
            bands, projection_info = detect_section_bands_via_projection(gray)
            debug_info["bands"] = bands
            debug_info["projection"] = projection_info
            if bands:
                test_top = min(b["y1"] for b in bands.values())
                test_bottom = max(b["y2"] for b in bands.values())
                column_bounds = find_column_peak_bounds(gray, test_top, test_bottom)
        except HTTPException as exc:
            warning = exc.detail
    else:
        lines = detect_horizontal_rules(gray)
        debug_info["lines"] = lines
        try:
            bands, dividers, bottom = build_section_bands(lines, pad_y=15)
            debug_info["dividers"] = dividers
            debug_info["bottom"] = bottom
            debug_info["bands"] = bands
        except HTTPException as exc:
            warning = exc.detail

    vis = draw_debug(gray, debug_info)

    if mode == "projection" and "projection" in debug_info and debug_info["projection"] is not None:
        _draw_projection_curve(vis, debug_info["projection"])

    if column_bounds is not None and debug_info["bands"]:
        image_h, image_w = vis.shape[:2]
        for band in debug_info["bands"].values():
            crop_y1 = max(0, band["y1"] - COLUMN_CROP_CLEARANCE)
            crop_y2 = min(image_h, band["y2"] + COLUMN_CROP_CLEARANCE)
            for col_left, col_right in column_bounds:
                crop_x1 = max(0, col_left - COLUMN_CROP_CLEARANCE)
                crop_x2 = min(image_w, col_right + COLUMN_CROP_CLEARANCE)
                cv2.rectangle(
                    vis,
                    (crop_x1, crop_y1),
                    (crop_x2, crop_y2),
                    (0, 165, 255),
                    2,
                )
    overlay_y = 36
    if rectify_status:
        cv2.putText(
            vis,
            rectify_status,
            (12, overlay_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 0, 255),
            2,
        )
        overlay_y += 34
    if warning:
        cv2.putText(
            vis,
            warning,
            (12, overlay_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 0, 255),
            2,
        )
        overlay_y += 34
        cv2.putText(
            vis,
            f"horizontal rules found: {len(debug_info['lines'])}",
            (12, overlay_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 0, 255),
            2,
        )

    ok, buf = cv2.imencode(".jpg", vis, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode debug image")

    return Response(buf.tobytes(), media_type="image/jpeg")


def _bands_for_mode(gray: np.ndarray, mode: str):
    if mode == "projection":
        bands, _ = detect_section_bands_via_projection(gray)
        return bands
    lines = detect_horizontal_rules(gray)
    bands, _, _ = build_section_bands(lines)
    return bands


@app.post("/score-omr")
async def score_route(
    file: UploadFile = File(...),
    mode: str = Query(default="projection"),
):
    mode = resolve_mode(mode)
    try:
        img = read_image_from_upload(file)
        gray = preprocess_for_ai(img, mode=mode)
        bands = _bands_for_mode(gray, mode)
        answers, confidences, _ = score_omr(gray, bands)
    except HTTPException as exc:
        if exc.status_code < 500:
            raise
        return {
            "english": [None] * SECTION_CONFIG["english"],
            "math": [None] * SECTION_CONFIG["math"],
            "reading": [None] * SECTION_CONFIG["reading"],
            "science": [None] * SECTION_CONFIG["science"],
            "_confidences": {name: [0.0] * total for name, total in SECTION_CONFIG.items()},
            "_status": "partial",
            "_warnings": [
                f"Could not score this sheet: {exc.detail}",
            ],
        }

    return {
        **answers,
        "_confidences": confidences,
        "_status": "ok",
        "_warnings": [],
    }


@app.post("/score-debug")
async def score_debug_route(
    file: UploadFile = File(...),
    mode: str = Query(default="projection"),
):
    mode = resolve_mode(mode)
    img = read_image_from_upload(file)
    gray = preprocess_for_ai(img, mode=mode)
    bands = _bands_for_mode(gray, mode)
    _, _, bubble_grid = score_omr(gray, bands)

    vis = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    for section_name, band in bands.items():
        if section_name not in SECTION_LAYOUT:
            continue
        x1, x2 = band["x1"], band["x2"]
        y1, y2 = band["y1"], band["y2"]
        cv2.rectangle(vis, (x1, y1), (x2, y2), (255, 0, 0), 2)
        cv2.putText(
            vis,
            section_name,
            (x1 + 6, y1 + 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 0, 0),
            2,
        )

    for section_name, cells in bubble_grid.items():
        for cell in cells:
            cx1, cy1 = cell["x1"], cell["y1"]
            cx2, cy2 = cell["x2"], cell["y2"]
            cell_w = cx2 - cx1
            skip = int(cell_w * BUBBLE_LEFT_SKIP_RATIO)
            bz_x1 = cx1 + skip
            bz_w = (cx2 - bz_x1) / 4.0

            for bubble_index in range(4):
                bx1 = int(bz_x1 + bubble_index * bz_w)
                bx2 = int(bz_x1 + (bubble_index + 1) * bz_w)
                is_pick = cell["answer"] == bubble_index + 1
                if is_pick:
                    high_conf = cell["confidence"] >= 0.3
                    color = (0, 220, 0) if high_conf else (0, 165, 255)
                    thickness = 2
                else:
                    color = (120, 120, 120)
                    thickness = 1
                cv2.rectangle(vis, (bx1, cy1), (bx2, cy2), color, thickness)

    ok, buf = cv2.imencode(".jpg", vis, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode debug image")
    return Response(buf.tobytes(), media_type="image/jpeg")


@app.post("/preprocess-omr")
async def preprocess_route(
    file: UploadFile = File(...),
    mode: str = Query(default="legacy"),
):
    mode = resolve_mode(mode)
    img = read_image_from_upload(file)
    gray = preprocess_for_ai(img, mode=mode)

    ok, buf = cv2.imencode(".jpg", gray, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode preprocessed image")

    return Response(buf.tobytes(), media_type="image/jpeg")
