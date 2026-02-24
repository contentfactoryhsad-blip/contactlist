from __future__ import annotations

import base64
import json
import hashlib
import html
import hmac
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import streamlit as st
import extra_streamlit_components as stx

from streamlit_backend import (
    build_excel_bytes,
    get_mailer,
    get_site_password,
    get_store,
    is_totp_valid,
    is_admin_password_valid,
    is_admin_totp_valid,
    is_site_password_valid,
)

st.set_page_config(page_title="LGE Creative Hub", page_icon="🧭", layout="wide")

SESSION_TTL_SECONDS = 60 * 60 * 10  # 10 hours

PAGE_CONFIG: dict[str, dict[str, str]] = {
    "home": {"label": "Home"},
    "request": {"label": "New Request"},
    "my-access": {"label": "Access Review"},
    "my-requests": {"label": "My Requests"},
    "admin": {"label": "Admin"},
}


def init_services():
    store = get_store()
    mailer = get_mailer(store)
    return store, mailer

cookies = stx.CookieManager()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _auth_signing_key() -> bytes:
    # Separate secret for cookie signing; fall back to site password if not set.
    raw = (os.getenv("AUTH_COOKIE_SECRET") or get_site_password() or "").encode("utf-8")
    # Even if the password is short, hashing makes key length consistent for HMAC.
    return hashlib.sha256(raw).digest()


def _make_auth_token(payload: dict[str, Any]) -> str:
    body = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    sig = hmac.new(_auth_signing_key(), body.encode("utf-8"), hashlib.sha256).digest()
    return f"{body}.{_b64url(sig)}"


def _verify_auth_token(token: str) -> dict[str, Any] | None:
    try:
        body, sig = token.split(".", 1)
        expected = hmac.new(_auth_signing_key(), body.encode("utf-8"), hashlib.sha256).digest()
        got = _b64url_decode(sig)
        if not hmac.compare_digest(expected, got):
            return None
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
        exp = int(payload.get("exp", 0) or 0)
        if exp and int(datetime.now(timezone.utc).timestamp()) > exp:
            return None
        return payload
    except Exception:
        return None


def _set_cookie(kind: str, payload: dict[str, Any]) -> None:
    token = _make_auth_token(payload)
    # exp is inside the signed token; use a long enough cookie lifespan.
    cookies.set(kind, token, expires_at=None)


def _clear_cookie(kind: str) -> None:
    cookies.delete(kind)


def apply_cookie_auth() -> None:
    # Cookie-based auth persists across refresh/new tab. Session state remains authoritative.
    now = int(datetime.now(timezone.utc).timestamp())

    if not st.session_state.get("site_authed"):
        token = str(cookies.get("site_auth") or "")
        payload = _verify_auth_token(token) if token else None
        if payload and payload.get("kind") == "site" and int(payload.get("exp", 0) or 0) > now:
            st.session_state.site_authed = True

    if not st.session_state.get("admin_authed"):
        token = str(cookies.get("admin_auth") or "")
        payload = _verify_auth_token(token) if token else None
        if payload and payload.get("kind") == "admin" and int(payload.get("exp", 0) or 0) > now:
            st.session_state.admin_authed = True
            st.session_state.admin_email = str(payload.get("email") or "")


def portal_password_enabled() -> bool:
    # Prefer Streamlit Cloud access control over shared passwords.
    return (
        bool(get_site_password())
        and (os.getenv("DISABLE_PORTAL_PASSWORD", "").strip().lower() != "true")
    )


def _mask_value(value: str, keep: int = 8) -> str:
    value = (value or "").strip()
    if not value:
        return "(empty)"
    if len(value) <= keep:
        return value
    return f"{value[:keep]}..."


def render_airtable_not_found_error(err: Exception, store: Any) -> bool:
    message = str(err)
    if "Airtable error 404" not in message or "NOT_FOUND" not in message:
        return False

    st.error("Airtable Base ID 또는 테이블명이 현재 Base와 일치하지 않아 데이터를 찾을 수 없습니다.")
    config = getattr(store, "config", None)
    if config:
        st.code(
            "\n".join(
                [
                    f"AIRTABLE_BASE_ID={config.airtable_base_id}",
                    f"AIRTABLE_API_KEY={_mask_value(config.airtable_api_key)}",
                    f"AIRTABLE_TABLE_REFERENCE={config.tables.reference}",
                    f"AIRTABLE_TABLE_REQUESTS={config.tables.requests}",
                    f"AIRTABLE_TABLE_ACTIVE_ACCESS={config.tables.active_access}",
                    f"AIRTABLE_TABLE_SETTINGS={config.tables.settings}",
                    f"AIRTABLE_TABLE_ACCESS_OTP={config.tables.access_otp}",
                ]
            )
        )
    st.info(
        "확인 순서: 1) Base ID가 app... 형식으로 정확한지 2) 테이블명이 Airtable의 실제 탭 이름과 같은지 "
        "3) PAT 권한에 해당 Base가 포함되어 있는지 4) Streamlit 서버를 완전히 재시작했는지"
    )
    return True


def check_airtable_connection(store: Any) -> tuple[bool, list[str], list[str]]:
    checks = [
        ("Requests", store.config.tables.requests),
        ("ActiveAccess", store.config.tables.active_access),
        ("ReferenceHierarchy", store.config.tables.reference),
        ("AdminUsers", store.config.tables.admins),
        ("AdminSettings", store.config.tables.settings),
        ("DeletedRequests", store.config.tables.deleted_requests),
        ("DeletedActiveAccess", store.config.tables.deleted_active_access),
        ("AccessOtp", store.config.tables.access_otp),
        ("LoginAudit", store.config.tables.login_audit),
    ]

    ok_messages: list[str] = []
    error_messages: list[str] = []
    for label, table in checks:
        try:
            store.client.list_all_records(table, params={"maxRecords": 1})
            ok_messages.append(f"{label} ({table})")
        except Exception as err:
            error_messages.append(f"{label} ({table}): {err}")

    return len(error_messages) == 0, ok_messages, error_messages


@st.dialog("Airtable Connection Check")
def show_airtable_connection_dialog(success: bool, ok_messages: list[str], error_messages: list[str]) -> None:
    if success:
        st.success("Airtable connection is healthy. No issues detected.")
    else:
        st.error("Airtable connection check found issues.")

    if ok_messages:
        st.caption("Healthy tables")
        st.code("\n".join(ok_messages))

    if error_messages:
        st.caption("Issues")
        st.code("\n".join(error_messages))


@st.dialog("New Request Status")
def show_new_request_status_dialog(level: str, message: str) -> None:
    if level == "success":
        st.success(message)
    elif level == "warning":
        st.warning(message)
    else:
        st.error(message)

    if st.button("Close", key="new_request_status_close"):
        st.session_state.new_request_popup = None
        st.rerun()


def open_new_request_popup(level: str, message: str) -> None:
    st.session_state.new_request_popup = {"level": level, "message": message}
    st.rerun()


@st.dialog("Edit Request")
def show_request_edit_dialog(store: Any, mailer: Any, hierarchy: list[dict[str, str]], request_record: dict[str, Any]) -> None:
    request_id = request_record["id"]
    fields = request_record["fields"]

    region_options = sorted({row["Region"] for row in hierarchy if row.get("Region")})
    if fields.get("Region") and fields.get("Region") not in region_options:
        region_options.append(fields.get("Region"))
    if not region_options:
        region_options = [fields.get("Region", "") or "-"]

    current_region = fields.get("Region") if fields.get("Region") in region_options else region_options[0]
    region = st.selectbox("Region", options=region_options, index=region_options.index(current_region), key=f"req_edit_region_{request_id}")

    subsidiary_options = sorted({row["Subsidiary"] for row in hierarchy if row["Region"] == region})
    if fields.get("Subsidiary") and fields.get("Subsidiary") not in subsidiary_options:
        subsidiary_options.append(fields.get("Subsidiary"))
    if not subsidiary_options:
        subsidiary_options = [fields.get("Subsidiary", "") or "-"]

    default_subsidiary = fields.get("Subsidiary") if fields.get("Subsidiary") in subsidiary_options else subsidiary_options[0]
    subsidiary = st.selectbox(
        "Subsidiary",
        options=subsidiary_options,
        index=subsidiary_options.index(default_subsidiary),
        key=f"req_edit_subsidiary_{request_id}",
    )

    branch_options = sorted(
        {
            row["Branch"]
            for row in hierarchy
            if row["Region"] == region and row["Subsidiary"] == subsidiary
        }
    )
    if fields.get("Branch") and fields.get("Branch") not in branch_options:
        branch_options.append(fields.get("Branch"))
    if not branch_options:
        branch_options = [fields.get("Branch", "") or "-"]

    with st.form(f"request_edit_dialog_form_{request_id}"):
        c1, c2, c3 = st.columns(3)
        with c1:
            request_type = st.selectbox(
                "Request Type",
                options=["New Access", "Access Update"],
                index=0 if fields.get("RequestType", "New Access") == "New Access" else 1,
            )
            branch = st.selectbox(
                "Branch",
                options=branch_options,
                index=branch_options.index(fields.get("Branch")) if fields.get("Branch") in branch_options else 0,
            )
            status = st.selectbox(
                "Status",
                options=["Request Submitted", "Pending", "On Hold", "Completed"],
                index=["Request Submitted", "Pending", "On Hold", "Completed"].index(fields.get("Status", "Request Submitted"))
                if fields.get("Status", "Request Submitted") in ["Request Submitted", "Pending", "On Hold", "Completed"]
                else 0,
            )
        with c2:
            name = st.text_input("Name", value=fields.get("Name", ""))
            position = st.text_input("Position", value=fields.get("Position", ""))
            rr = st.text_input("R&R", value=fields.get("RR", ""))
            requester_email = st.text_input("Requester Email", value=fields.get("RequesterEmail", ""))
        with c3:
            access = st.selectbox(
                "Airtable Access",
                options=["Viewer", "Editor", "Related mail recipient"],
                index=["Viewer", "Editor", "Related mail recipient"].index(fields.get("AirtableAccess", "Viewer"))
                if fields.get("AirtableAccess", "Viewer") in ["Viewer", "Editor", "Related mail recipient"]
                else 0,
            )
            current_access = st.text_input("Current Access", value=fields.get("CurrentAccess", ""))
            requested_access = st.text_input("Requested Access", value=fields.get("RequestedAccess", ""))

        admin_comment = st.text_area("Admin Comment", value=fields.get("AdminComment", ""), height=80)
        change_reason = st.text_area("Change Reason", value=fields.get("ChangeReason", ""), height=80)

        save_request = st.form_submit_button("Save Changes", type="primary")

    if not save_request:
        return

    try:
        updated = store.update_request_record(
            request_id,
            {
                "RequestType": request_type,
                "Region": region,
                "Subsidiary": subsidiary,
                "Branch": branch,
                "Name": name,
                "Position": position,
                "RR": rr,
                "RequesterEmail": requester_email,
                "AirtableAccess": access,
                "CurrentAccess": current_access,
                "RequestedAccess": requested_access,
                "Status": status,
                "AdminComment": admin_comment,
                "ChangeReason": change_reason,
            },
        )
        merged = updated["fields"]
        previous_status = updated.get("previous", {}).get("Status")
        request_type_after = merged.get("RequestType", request_type)

        if (
            merged.get("Status") == "Completed"
            and request_type_after != "Access Update"
            and merged.get("Branch")
            and merged.get("AirtableAccess")
            and merged.get("RequesterEmail")
        ):
            already_active = store.has_active_access(
                merged.get("RequesterEmail", ""),
                merged.get("Branch", ""),
                merged.get("AirtableAccess", ""),
            )
            if not already_active:
                store.add_active_access(
                    {
                        "Region": merged.get("Region", ""),
                        "Subsidiary": merged.get("Subsidiary", ""),
                        "Branch": merged.get("Branch", ""),
                        "Name": merged.get("Name", ""),
                        "Position": merged.get("Position", ""),
                        "RR": merged.get("RR", ""),
                        "Email": merged.get("RequesterEmail", ""),
                        "AirtableAccess": merged.get("AirtableAccess", ""),
                        "SourceRequestId": request_id,
                    }
                )

            if previous_status != "Completed":
                try:
                    mailer.send_completion_emails(
                        {
                            "requestId": merged.get("RequestId", request_id),
                            "requesterEmail": merged.get("RequesterEmail", ""),
                            "region": merged.get("Region", ""),
                            "subsidiary": merged.get("Subsidiary", ""),
                            "branch": merged.get("Branch", ""),
                            "name": merged.get("Name", ""),
                            "position": merged.get("Position", ""),
                            "rr": merged.get("RR", ""),
                            "access": merged.get("AirtableAccess", ""),
                            "status": merged.get("Status", ""),
                            "adminComment": merged.get("AdminComment", ""),
                            "requestType": merged.get("RequestType", "New Access"),
                            "currentAccess": merged.get("CurrentAccess", ""),
                            "requestedAccess": merged.get("RequestedAccess", ""),
                            "changeReason": merged.get("ChangeReason", ""),
                        }
                    )
                except Exception as err:
                    st.warning(f"Saved, but completion email failed: {err}")

        quota = store.is_quota_exceeded(merged.get("Branch", ""), merged.get("AirtableAccess", ""))
        if quota["exceeded"]:
            st.warning("This update reaches or exceeds the branch quota.")

        st.success("Request updated.")
        st.rerun()
    except Exception as err:
        st.error(f"Update failed: {err}")


@st.dialog("Notify Requester")
def show_request_notify_dialog(mailer: Any, request_record: dict[str, Any]) -> None:
    fields = request_record["fields"]
    st.caption(f"{fields.get('Name', '-') } | {fields.get('RequesterEmail', '-')} | {fields.get('Branch', '-')}")

    with st.form(f"request_notify_dialog_form_{request_record['id']}"):
        admin_comment = st.text_area("Admin Comment", value=fields.get("AdminComment", ""), height=90)
        send_clicked = st.form_submit_button("Send Notification", type="primary")

    if not send_clicked:
        return

    try:
        mailer.send_status_update_email(
            {
                "requesterEmail": fields.get("RequesterEmail", ""),
                "region": fields.get("Region", ""),
                "subsidiary": fields.get("Subsidiary", ""),
                "branch": fields.get("Branch", ""),
                "name": fields.get("Name", ""),
                "position": fields.get("Position", ""),
                "rr": fields.get("RR", ""),
                "access": fields.get("AirtableAccess", ""),
                "status": fields.get("Status", ""),
                "adminComment": admin_comment.strip(),
                "requestType": fields.get("RequestType", "New Access"),
                "currentAccess": fields.get("CurrentAccess", ""),
                "requestedAccess": fields.get("RequestedAccess", ""),
                "changeReason": fields.get("ChangeReason", ""),
            }
        )
        st.success("Notification sent.")
        st.rerun()
    except Exception as err:
        st.error(f"Notification failed: {err}")


@st.dialog("Delete Request")
def show_request_delete_dialog(store: Any, mailer: Any, request_record: dict[str, Any]) -> None:
    fields = request_record["fields"]
    request_id = request_record["id"]
    st.caption(f"{fields.get('Name', '-') } | {fields.get('RequesterEmail', '-')} | {fields.get('Branch', '-')}")

    with st.form(f"request_delete_dialog_form_{request_id}"):
        reason = st.text_area("Delete Reason *", height=90)
        delete_clicked = st.form_submit_button("Delete Request", type="primary")

    if not delete_clicked:
        return

    if not reason.strip():
        st.error("Delete reason is required.")
        return

    try:
        deleted = store.delete_request_record(request_id)
        deleted_fields = deleted.get("fields", {})
        deleted_request_id = deleted_fields.get("RequestId", deleted.get("id", ""))
        store.log_deleted_request(deleted_fields, reason.strip(), deleted_request_id)
        try:
            mailer.send_deletion_emails(
                {
                    "requesterEmail": deleted_fields.get("RequesterEmail", ""),
                    "requestId": deleted_request_id,
                    "region": deleted_fields.get("Region", ""),
                    "subsidiary": deleted_fields.get("Subsidiary", ""),
                    "branch": deleted_fields.get("Branch", ""),
                    "name": deleted_fields.get("Name", ""),
                    "position": deleted_fields.get("Position", ""),
                    "rr": deleted_fields.get("RR", ""),
                    "access": deleted_fields.get("AirtableAccess", ""),
                    "status": deleted_fields.get("Status", ""),
                    "reason": reason.strip(),
                    "requestType": deleted_fields.get("RequestType", "New Access"),
                    "currentAccess": deleted_fields.get("CurrentAccess", ""),
                    "requestedAccess": deleted_fields.get("RequestedAccess", ""),
                    "changeReason": deleted_fields.get("ChangeReason", ""),
                }
            )
        except Exception as err:
            st.warning(f"Deleted, but email send failed: {err}")
        st.success("Request deleted.")
        st.rerun()
    except Exception as err:
        st.error(f"Delete failed: {err}")


@st.dialog("Edit Active Access")
def show_active_edit_dialog(store: Any, record: dict[str, Any]) -> None:
    fields = record["fields"]
    st.caption(f"{fields.get('Name', '-') } | {fields.get('Email', '-')} | {fields.get('Branch', '-')}")

    with st.form(f"active_edit_dialog_{record['id']}"):
        c1, c2, c3 = st.columns(3)
        with c1:
            region = st.text_input("Region", value=fields.get("Region", ""))
            subsidiary = st.text_input("Subsidiary", value=fields.get("Subsidiary", ""))
            branch = st.text_input("Branch", value=fields.get("Branch", ""))
        with c2:
            name = st.text_input("Name", value=fields.get("Name", ""))
            email = st.text_input("Email", value=fields.get("Email", ""))
            position = st.text_input("Position", value=fields.get("Position", ""))
        with c3:
            rr = st.text_input("R&R", value=fields.get("RR", ""))
            access = st.selectbox(
                "Airtable Access",
                options=["Viewer", "Editor", "Related mail recipient"],
                index=["Viewer", "Editor", "Related mail recipient"].index(fields.get("AirtableAccess", "Viewer"))
                if fields.get("AirtableAccess", "Viewer") in ["Viewer", "Editor", "Related mail recipient"]
                else 0,
            )
            activated_at = st.text_input("Activated At", value=fields.get("ActivatedAt", ""))

        save_active = st.form_submit_button("Save Changes", type="primary")

    if not save_active:
        return

    try:
        store.update_active_access_record(
            record["id"],
            {
                "Region": region,
                "Subsidiary": subsidiary,
                "Branch": branch,
                "Name": name,
                "Email": email,
                "Position": position,
                "RR": rr,
                "AirtableAccess": access,
                "ActivatedAt": activated_at,
            },
        )
        st.success("Active access updated.")
        st.rerun()
    except Exception as err:
        st.error(f"Update failed: {err}")


@st.dialog("Notify Owner")
def show_active_notify_dialog(mailer: Any, record: dict[str, Any]) -> None:
    fields = record["fields"]
    target_email = fields.get("Email", "").strip()
    st.caption(f"Send update email to {target_email or '-'}")

    with st.form(f"active_notify_dialog_{record['id']}"):
        admin_comment = st.text_area("Admin Comment (optional)", height=90)
        send_clicked = st.form_submit_button("Send Email", type="primary")

    if not send_clicked:
        return

    if not target_email:
        st.error("Target email is empty.")
        return

    try:
        mailer.send_status_update_email(
            {
                "requestType": "Active Access",
                "requesterEmail": target_email,
                "region": fields.get("Region", ""),
                "subsidiary": fields.get("Subsidiary", ""),
                "branch": fields.get("Branch", ""),
                "name": fields.get("Name", ""),
                "position": fields.get("Position", ""),
                "rr": fields.get("RR", ""),
                "access": fields.get("AirtableAccess", ""),
                "status": "Active Access",
                "adminComment": admin_comment.strip(),
            }
        )
        st.success("Notification sent.")
        st.rerun()
    except Exception as err:
        st.error(f"Notification failed: {err}")




def _totp_provisioning_uri(secret: str, email_label: str = "Admin", issuer: str = "Creative Hub") -> str:
    try:
        import pyotp

        totp = pyotp.TOTP(secret)
        return totp.provisioning_uri(name=email_label, issuer_name=issuer)
    except Exception:
        return ""


def _totp_qr_png_bytes(uri: str) -> bytes:
    try:
        import qrcode

        img = qrcode.make(uri)
        import io

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        return b""


@st.dialog("Admin OTP Setup")
def show_admin_totp_setup_dialog(store: Any, mailer: Any) -> None:
    st.markdown("### Two-Factor Authentication (OTP)")
    st.caption("OTP secrets are stored per-admin in Airtable `AdminUsers` field `OTP Secret`.")

    email = st.text_input("Admin Email", placeholder="name@company.com")
    if not email.strip():
        st.info("Enter an admin email to continue.")
        return

    if not store.is_admin_email(email):
        st.error("This email is not listed in AdminUsers.")
        return

    current = (store.get_admin_totp_secret(email) or "").strip()

    if "pending_totp_secret" not in st.session_state:
        st.session_state.pending_totp_secret = ""

    c1, c2 = st.columns([1, 1], gap="small")
    with c1:
        if st.button("Generate New Secret", type="primary"):
            import pyotp

            st.session_state.pending_totp_secret = pyotp.random_base32()
    with c2:
        if current and st.button("Use Existing Secret"):
            st.session_state.pending_totp_secret = current

    secret = (st.session_state.pending_totp_secret or current or "").strip()
    if not secret:
        st.info("No OTP secret exists yet. Generate a new one.")
        return

    st.code(secret if not current or secret != current else (secret[:4] + "..." + secret[-4:]))

    uri = _totp_provisioning_uri(secret, email_label=email.strip(), issuer="Creative Hub")
    png = _totp_qr_png_bytes(uri)
    if png:
        st.image(png, caption="Scan this QR code in your OTP app", width=260)

    st.markdown("### Verify And Save")
    code = st.text_input("Verify OTP Code", placeholder="6-digit code", max_chars=6)
    send_email = st.checkbox("Email me this OTP secret (for confirmation)", value=True)

    if st.button("Save To Airtable", type="primary"):
        if not is_totp_valid(secret, code):
            st.error("OTP code is invalid. Check your phone time and try again.")
            return
        try:
            store.set_admin_totp_secret(email, secret)
            if send_email:
                mailer.send_admin_otp_enrollment_email(email, secret)
            st.success("Saved. OTP is now enabled for this admin.")
            st.rerun()
        except Exception as err:
            st.error(f"Failed to save: {err}")

@st.dialog("Delete Active Access")
def show_active_delete_dialog(store: Any, record: dict[str, Any]) -> None:
    fields = record["fields"]
    st.caption(f"{fields.get('Name', '-') } | {fields.get('Email', '-')} | {fields.get('Branch', '-')}")

    with st.form(f"active_delete_dialog_{record['id']}"):
        reason = st.text_area("Delete Reason *", height=90)
        delete_clicked = st.form_submit_button("Delete", type="primary")

    if not delete_clicked:
        return

    if not reason.strip():
        st.error("Delete reason is required.")
        return

    try:
        deleted = store.delete_active_access_record(record["id"])
        store.log_deleted_active_access(deleted.get("fields", {}), reason.strip())
        st.success("Active access deleted.")
        st.rerun()
    except Exception as err:
        st.error(f"Delete failed: {err}")


def format_datetime(value: str) -> str:
    if not value:
        return "-"
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%Y-%m-%d %H:%M")
    except Exception:
        return value


def ensure_session_defaults() -> None:
    defaults = {
        "site_authed": False,
        "admin_authed": False,
        "admin_password": "",
        "admin_email": "",
        "my_access_records": [],
        "my_access_selected_id": "",
        "my_access_otp_record_id": "",
        "my_access_otp_expires_at": "",
        "my_requests_email": "",
        "new_request_popup": None,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def _q_get(name: str, default: str = "") -> str:
    value = st.query_params.get(name, default)
    if isinstance(value, list):
        return str(value[0]) if value else default
    return str(value)


def _q_set(name: str, value: str | None) -> None:
    if value is None or value == "":
        if name in st.query_params:
            del st.query_params[name]
        return
    st.query_params[name] = value


def _sign_payload(payload: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session_token(kind: str, secret: str, ttl_seconds: int = SESSION_TTL_SECONDS) -> str:
    now_ts = int(datetime.now(timezone.utc).timestamp())
    exp_ts = now_ts + ttl_seconds
    payload = f"{kind}:{exp_ts}"
    sig = _sign_payload(payload, secret)
    raw = f"{payload}:{sig}"
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")
    return encoded


def verify_session_token(kind: str, token: str, secret: str) -> bool:
    if not token or not secret:
        return False
    try:
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        parts = raw.split(":")
        if len(parts) != 3:
            return False
        token_kind, exp_ts_text, sig = parts
        if token_kind != kind:
            return False
        exp_ts = int(exp_ts_text)
        payload = f"{token_kind}:{exp_ts}"
        expected_sig = _sign_payload(payload, secret)
        if not hmac.compare_digest(sig, expected_sig):
            return False
        now_ts = int(datetime.now(timezone.utc).timestamp())
        return now_ts < exp_ts
    except Exception:
        return False


def apply_persistent_auth() -> None:
    # Security: do not persist auth tokens in the URL.
    # Clear legacy query params if they exist.
    for key in ("site_session", "admin_session"):
        try:
            if key in st.query_params:
                del st.query_params[key]
        except Exception:
            pass


def build_page_url(page_key: str) -> str:
    params: dict[str, str] = {"page": page_key}
    return "?" + urlencode(params)


def inject_legacy_theme() -> None:
    st.markdown(
        """
<style>
:root {
  --bg-1: #f6f5eb;
  --bg-2: #f0ece4;
  --ink-1: #262626;
  --ink-2: #4a4946;
  --accent-1: #a50034;
  --accent-2: #fd312e;
  --panel: #ffffff;
  --border: #e6e1d6;
  --shadow: 0 18px 40px rgba(38, 38, 38, 0.12);
  --warm-3: #f6f5eb;
  --content-width: 96vw;
}

[data-testid="stHeader"],
[data-testid="stToolbar"],
[data-testid="stSidebar"],
[data-testid="collapsedControl"] {
  display: none !important;
}

html, body, [data-testid="stAppViewContainer"], .stApp {
  background: radial-gradient(circle at 10% 10%, #fdf4f3 0%, transparent 45%),
    radial-gradient(circle at 80% 20%, #f2efea 0%, transparent 48%),
    linear-gradient(180deg, var(--bg-1), var(--bg-2));
  color: var(--ink-1);
}

[data-testid="stMainBlockContainer"],
[data-testid="stAppViewContainer"] .block-container {
  width: var(--content-width) !important;
  max-width: none !important;
  padding-top: 0.75rem !important;
  padding-bottom: 3.5rem !important;
}

.page-header {
  margin: 36px 0 20px 0;
}

.page-title {
  font-size: clamp(1.8rem, 1.6rem + 1vw, 2.6rem);
  font-weight: 700;
  margin: 0 0 10px 0;
  color: var(--ink-1);
}

.page-subtitle {
  color: var(--ink-2);
  margin: 0;
  font-size: 0.98rem;
}

.login-card {
  max-width: 520px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 6px 4px 2px;
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.login-logo {
  height: 42px;
  width: auto;
  display: block;
}

.login-brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.login-brand-title {
  font-size: 0.95rem;
  font-weight: 700;
}

.login-brand-subtitle {
  font-size: 0.78rem;
  color: var(--ink-2);
}

.login-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login-title {
  font-size: 1.3rem;
  font-weight: 700;
}

.login-subtitle {
  color: var(--ink-2);
  font-size: 0.95rem;
}

div[data-testid="stForm"] {
  background: var(--panel);
  border: 1px solid rgba(230, 225, 214, 0.9);
  border-radius: 20px;
  padding: 18px;
  box-shadow: var(--shadow);
}

.card {
  background: var(--panel);
  border: 1px solid rgba(230, 225, 214, 0.9);
  border-radius: 20px;
  padding: 24px;
  box-shadow: var(--shadow);
  margin-bottom: 18px;
}

.home-card {
  min-height: 272px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 8px;
  padding: 16px !important;
}

.home-card h2 {
  margin: 0;
  font-size: 1.6rem;
  line-height: 1.06;
  min-height: 2.0em;
}

.home-card p {
  margin: 0;
  max-width: none;
  color: var(--ink-2);
  font-size: 0.83rem;
  line-height: 1.36;
  flex: 0 1 auto;
}

.home-grid {
  width: var(--content-width);
  max-width: 100%;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  align-items: stretch;
}

.home-grid .home-card {
  margin-bottom: 0;
  height: 100%;
}

.nav {
  width: var(--content-width);
  max-width: 100%;
  margin: 24px auto 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid var(--border);
  box-shadow: 0 10px 28px rgba(38, 38, 38, 0.08);
  backdrop-filter: blur(6px);
}

.nav-links {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
}

.nav-links-row a {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--ink-1);
  padding: 4px 6px;
  border-radius: 6px;
  text-decoration: none;
  transition: color 0.2s ease, background 0.2s ease;
}

.nav-links-row a:hover {
  color: var(--accent-1);
  background: rgba(165, 0, 52, 0.06);
}

.nav-links-row a.active {
  color: var(--accent-1);
  background: rgba(165, 0, 52, 0.12);
}

.nav-brand {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo-full {
  height: 40px;
  width: auto;
  display: block;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.1;
}

.brand-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ink-1);
}

.brand-subtitle {
  font-size: 0.78rem;
  color: var(--ink-2);
}

label, .stTextInput label, .stSelectbox label, .stTextArea label {
  font-size: 0.9rem !important;
  color: var(--ink-2) !important;
  font-weight: 600 !important;
}

.stTextInput input,
.stSelectbox [data-baseweb="select"] > div,
.stTextArea textarea {
  border-radius: 10px !important;
  border: 1px solid var(--border) !important;
  background: white !important;
  font-size: 0.95rem !important;
}

.stTextInput input:focus,
.stTextArea textarea:focus {
  border-color: rgba(165, 0, 52, 0.6) !important;
  box-shadow: 0 0 0 3px rgba(165, 0, 52, 0.12) !important;
}

.stButton > button, .stDownloadButton > button {
  border: none !important;
  border-radius: 999px !important;
  padding: 10px 18px !important;
  font-weight: 600 !important;
  white-space: nowrap !important;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease !important;
}

.stButton > button[kind="primary"] {
  background: linear-gradient(120deg, var(--accent-1), var(--accent-2)) !important;
  color: white !important;
  box-shadow: 0 14px 30px rgba(165, 0, 52, 0.25) !important;
}

.stButton > button[kind="secondary"], .stDownloadButton > button {
  background: #ffffff !important;
  color: var(--accent-1) !important;
  border: 1px solid rgba(165, 0, 52, 0.3) !important;
}

.stButton > button:hover:not(:disabled),
.stDownloadButton > button:hover:not(:disabled) {
  transform: translateY(-1px) !important;
  box-shadow: 0 16px 32px rgba(165, 0, 52, 0.25) !important;
}

.notice {
  padding: 14px;
  border-radius: 12px;
  background: #f6f5eb;
  color: var(--ink-2);
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent-2);
  margin: 12px 0;
}

.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.table th, .table td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.table th {
  background: var(--warm-3);
  color: var(--ink-2);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
}

.table.compact {
  table-layout: fixed;
  font-size: 0.84rem;
}

.table.compact th,
.table.compact td {
  white-space: normal;
  word-break: break-word;
  vertical-align: top;
  line-height: 1.32;
}

.table.compact th:nth-child(1),
.table.compact td:nth-child(1) {
  width: 28%;
}

.table.compact th:nth-child(2),
.table.compact td:nth-child(2) {
  width: 16%;
}

.table.compact th:nth-child(3),
.table.compact td:nth-child(3) {
  width: 20%;
}

.table.compact th:nth-child(4),
.table.compact td:nth-child(4) {
  width: 12%;
}

.table.compact th:nth-child(5),
.table.compact td:nth-child(5) {
  width: 14%;
}

.table.compact th:nth-child(6),
.table.compact td:nth-child(6) {
  width: 10%;
}

.active-cell {
  font-size: 0.84rem;
  color: var(--ink-1);
  line-height: 1.34;
  padding: 6px 0;
  word-break: break-word;
}

.active-grid-divider {
  height: 1px;
  background: var(--border);
  margin: 2px 0 4px 0;
}

.card-link {
  display: inline-block;
  border-radius: 999px;
  padding: 7px 14px;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.86rem;
  line-height: 1.1;
  text-align: center;
  margin-top: auto;
}

.card-link.primary {
  background: linear-gradient(120deg, var(--accent-1), var(--accent-2));
  color: #fff;
}

.card-link.secondary {
  background: #fff;
  color: var(--accent-1);
  border: 1px solid rgba(165, 0, 52, 0.3);
}

@media (max-width: 768px) {
  :root {
    --content-width: 96vw;
  }

  [data-testid="stMainBlockContainer"],
  [data-testid="stAppViewContainer"] .block-container {
    width: 96vw !important;
    max-width: 96vw !important;
    padding-top: 0.4rem !important;
    padding-bottom: 2.2rem !important;
  }

  .nav {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  .home-card {
    min-height: 200px;
    padding: 16px !important;
  }

  .home-card h2 {
    font-size: 1.45rem;
    min-height: 0;
  }

  .home-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
}

@media (max-width: 1200px) and (min-width: 769px) {
  .home-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
        """,
        unsafe_allow_html=True,
    )


def _logo_data_uri() -> str:
    logo_path = Path(__file__).resolve().parent / "public" / "lg-logo-full.png"
    if not logo_path.exists():
        return ""
    raw = logo_path.read_bytes()
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def render_nav(active_page: str) -> None:
    logo_uri = _logo_data_uri()
    if logo_uri:
        logo_html = f'<img class="brand-logo-full" src="{logo_uri}" alt="LG logo" />'
    else:
        logo_html = ""

    links = []
    for page_key, item in PAGE_CONFIG.items():
        active = "active" if page_key == active_page else ""
        links.append(
            f'<a class="{active}" href="{build_page_url(page_key)}" target="_self">{item["label"]}</a>'
        )

    st.markdown(
        f"""
<nav class="nav">
  <div class="nav-brand">
    {logo_html}
    <div class="brand-text">
      <div class="brand-title">Creative Hub</div>
      <div class="brand-subtitle">Airtable Access Request</div>
    </div>
  </div>
  <div class="nav-links nav-links-row">
    {"".join(links)}
  </div>
</nav>
        """,
        unsafe_allow_html=True,
    )


def render_page_header(title: str, subtitle: str) -> None:
    st.markdown(
        f"""
<div class="page-header">
  <h1 class="page-title">{html.escape(title)}</h1>
  <p class="page-subtitle">{html.escape(subtitle)}</p>
</div>
        """,
        unsafe_allow_html=True,
    )


def render_notice(text: str) -> None:
    st.markdown(f'<div class="notice">{html.escape(text)}</div>', unsafe_allow_html=True)


def render_table(rows: list[dict[str, Any]], columns: list[str], table_class: str = "table") -> None:
    if not rows:
        st.info("No records found.")
        return

    head = "".join([f"<th>{html.escape(col)}</th>" for col in columns])
    body_rows = []
    for row in rows:
        cells = "".join([f"<td>{html.escape(str(row.get(col, '')))}</td>" for col in columns])
        body_rows.append(f"<tr>{cells}</tr>")

    st.markdown(
        f"""
<div class="table-wrap">
  <table class="{table_class}">
    <thead><tr>{head}</tr></thead>
    <tbody>{''.join(body_rows)}</tbody>
  </table>
</div>
        """,
        unsafe_allow_html=True,
    )


def normalize_search(value: str) -> str:
    return value.strip().lower()


def pick_filtered_requests(
    records: list[dict[str, Any]],
    region: str,
    subsidiary: str,
    branch: str,
    access: str,
    search: str,
):
    query = normalize_search(search)
    filtered = []
    for record in records:
        fields = record["fields"]
        if region and fields.get("Region") != region:
            continue
        if subsidiary and fields.get("Subsidiary") != subsidiary:
            continue
        if branch and fields.get("Branch") != branch:
            continue
        if access and fields.get("AirtableAccess") != access:
            continue
        if query:
            haystack = " ".join(
                [
                    fields.get("Region", ""),
                    fields.get("Subsidiary", ""),
                    fields.get("Branch", ""),
                    fields.get("Name", ""),
                    fields.get("Position", ""),
                    fields.get("RR", ""),
                    fields.get("RequesterEmail", ""),
                    fields.get("AirtableAccess", ""),
                    fields.get("Status", ""),
                    fields.get("AdminComment", ""),
                ]
            ).lower()
            if query not in haystack:
                continue
        filtered.append(record)
    return filtered


def pick_filtered_active(
    records: list[dict[str, Any]],
    region: str,
    subsidiary: str,
    branch: str,
    access: str,
    search: str,
):
    query = normalize_search(search)
    filtered = []
    for record in records:
        fields = record["fields"]
        if region and fields.get("Region") != region:
            continue
        if subsidiary and fields.get("Subsidiary") != subsidiary:
            continue
        if branch and fields.get("Branch") != branch:
            continue
        if access and fields.get("AirtableAccess") != access:
            continue
        if query:
            haystack = " ".join(
                [
                    fields.get("Region", ""),
                    fields.get("Subsidiary", ""),
                    fields.get("Branch", ""),
                    fields.get("Name", ""),
                    fields.get("Email", ""),
                    fields.get("Position", ""),
                    fields.get("RR", ""),
                    fields.get("AirtableAccess", ""),
                ]
            ).lower()
            if query not in haystack:
                continue
        filtered.append(record)
    return filtered


def show_site_login(store) -> None:
    logo_uri = _logo_data_uri()
    logo_html = (
        f'<img class="login-logo" src="{logo_uri}" alt="LG logo" />' if logo_uri else ""
    )
    left, center, right = st.columns([1, 1.2, 1])
    with center:
        st.markdown(
            f"""
<div class="card login-card">
  <div class="login-brand">
    {logo_html}
    <div class="login-brand-text">
      <div class="login-brand-title">Creative Hub</div>
      <div class="login-brand-subtitle">Airtable Access Request</div>
    </div>
  </div>
  <div class="login-header">
    <div class="login-title">Portal Access</div>
    <div class="login-subtitle">Enter the portal password to continue.</div>
  </div>
</div>
            """,
            unsafe_allow_html=True,
        )

        with st.form("site_login_form"):
            password = st.text_input("Password", type="password", placeholder="Enter password")
            submitted = st.form_submit_button("Enter Portal", type="primary")

        if submitted:
            if is_site_password_valid(password):
                st.session_state.site_authed = True
                exp = int(datetime.now(timezone.utc).timestamp()) + SESSION_TTL_SECONDS
                _set_cookie("site_auth", {"kind": "site", "exp": exp})
                site_secret = get_site_password()
                if site_secret:
                    try:
                        store.log_login_attempt(result="success", path="streamlit-site-login")
                    except Exception:
                        pass
                st.rerun()
            else:
                try:
                    store.log_login_attempt(result="failed", path="streamlit-site-login")
                except Exception:
                    pass
                st.error("Incorrect password.")


def show_home() -> None:
    render_page_header(
        "LGE Creative Hub",
        "Submit and track Airtable access requests across regions, subsidiaries, and branches.",
    )

    cards = [
        {
            "title": "New Request",
            "desc": "Submit a new access request with all mandatory details.",
            "cta": "Start Request",
            "style": "primary",
            "href": build_page_url("request"),
        },
        {
            "title": "Access Review",
            "desc": "Review your access details and submit verified updates.",
            "cta": "Start Review",
            "style": "secondary",
            "href": build_page_url("my-access"),
        },
        {
            "title": "My Requests",
            "desc": "See your submitted requests, current status, and admin comments.",
            "cta": "View My Requests",
            "style": "secondary",
            "href": build_page_url("my-requests"),
        },
        {
            "title": "Admin Dashboard",
            "desc": "Review, edit, and export requests and active access lists.",
            "cta": "Open Admin",
            "style": "secondary",
            "href": build_page_url("admin"),
        },
    ]

    cards_html = "".join(
        [
            f"""
<div class="card home-card">
  <h2>{html.escape(card['title'])}</h2>
  <p>{html.escape(card['desc'])}</p>
  <a class="card-link {card['style']}" href="{card['href']}" target="_self">{html.escape(card['cta'])}</a>
</div>
            """
            for card in cards
        ]
    )
    st.markdown(f'<div class="home-grid">{cards_html}</div>', unsafe_allow_html=True)


def show_new_request(store, mailer) -> None:
    render_page_header(
        "New Access Request",
        "Complete every required field. Submission is blocked if the branch quota is exceeded or a duplicate exists. Use your email to track requests.",
    )

    popup = st.session_state.get("new_request_popup")
    if isinstance(popup, dict) and popup.get("message"):
        show_new_request_status_dialog(popup.get("level", "error"), popup.get("message", ""))

    hierarchy = store.get_hierarchy_rows()
    if not hierarchy:
        st.error("Reference hierarchy is empty. Please load Region/Subsidiary/Branch data first.")
        return

    regions = sorted({row["Region"] for row in hierarchy})
    region = st.selectbox("Region *", options=regions)

    # Subsidiary is essentially the branch code; users should select Branch (country/name),
    # then subsidiary code is auto-mapped from reference hierarchy.
    region_rows = [row for row in hierarchy if row["Region"] == region]
    branch_options = sorted({row["Branch"] for row in region_rows})
    branch = st.selectbox("Branch *", options=branch_options, disabled=not bool(region))

    branch_to_subsidiary: dict[str, str] = {}
    for row in region_rows:
        b = row.get("Branch", "")
        s = row.get("Subsidiary", "")
        if b and s and b not in branch_to_subsidiary:
            branch_to_subsidiary[b] = s
    subsidiary = branch_to_subsidiary.get(branch, "")
    st.text_input("Subsidiary (Auto)", value=subsidiary, disabled=True)

    c1, c2 = st.columns(2)
    with c1:
        name = st.text_input("Name *")
    with c2:
        position = st.text_input("Position *")

    c3, c4 = st.columns(2)
    with c3:
        rr = st.text_input("R&R *")
    with c4:
        access = st.selectbox("Airtable Access *", options=["Viewer", "Editor"])

    email = st.text_input("Requester Email *", placeholder="name@company.com")

    submitted = st.button("Submit Request", type="primary")

    if not submitted:
        return

    with st.spinner("Submitting request..."):
        if not all([region, subsidiary, branch, name.strip(), position.strip(), rr.strip(), email.strip()]):
            open_new_request_popup("error", "Please complete all required fields.")
            return

        email = email.strip().lower()

        try:
            settings = store.get_admin_settings()
            contact_email = settings.get("centralAdminEmail", "")

            duplicate = store.has_duplicate_request(email, branch, access)
            if duplicate:
                message = "A duplicate request already exists for this branch and access type."
                if contact_email:
                    message += f" Contact: {contact_email}"
                open_new_request_popup("error", message)
                return

            quota = store.is_quota_exceeded(branch, access)
            if quota["exceeded"]:
                open_new_request_popup(
                    "error",
                    f"Branch quota exceeded for {access}. Limit: {quota['limit']}."
                    + (f" Contact: {contact_email}" if contact_email else ""),
                )
                return

            created = store.create_request_record(
                {
                    "RequestType": "New Access",
                    "Region": region,
                    "Subsidiary": subsidiary,
                    "Branch": branch,
                    "Name": name.strip(),
                    "Position": position.strip(),
                    "RR": rr.strip(),
                    "RequesterEmail": email,
                    "AirtableAccess": access,
                    "RequestedAccess": access,
                    "Status": "Request Submitted",
                }
            )

            try:
                mailer.send_submission_emails(
                    {
                        "requestId": created["id"],
                        "requesterEmail": email,
                        "region": region,
                        "subsidiary": subsidiary,
                        "branch": branch,
                        "name": name.strip(),
                        "position": position.strip(),
                        "rr": rr.strip(),
                        "access": access,
                        "status": "Request Submitted",
                        "requestType": "New Access",
                        "requestedAccess": access,
                    }
                )
            except Exception as err:
                open_new_request_popup("warning", f"Request submitted, but email send failed: {err}")
                return

            open_new_request_popup("success", "Your request has been submitted.")
            return
        except Exception as err:
            open_new_request_popup("error", f"Request submission failed: {err}")
            return


def show_my_requests(store) -> None:
    render_page_header(
        "My Requests",
        "Enter your email to track submitted requests with status and admin comments.",
    )
    with st.form("my_requests_form"):
        email = st.text_input("Requester Email", value=st.session_state.my_requests_email)
        submitted = st.form_submit_button("Search", type="primary")

    if submitted:
        st.session_state.my_requests_email = email.strip().lower()

    email = st.session_state.my_requests_email
    if not email:
        st.caption("Enter your email to see your requests.")
        return

    records = store.list_requests_by_email(email)
    if not records:
        st.info("No requests found.")
        return

    rows = []
    for record in records:
        fields = record["fields"]
        rows.append(
            {
                "Type": fields.get("RequestType", "New Access"),
                "Branch": fields.get("Branch", ""),
                "Access": fields.get("AirtableAccess", ""),
                "Requested": fields.get("RequestedAccess", "-"),
                "Status": fields.get("Status", ""),
                "Admin Comment": fields.get("AdminComment", "-") or "-",
                "Created": format_datetime(record.get("createdDateTime", "")),
            }
        )

    render_table(
        rows,
        ["Type", "Branch", "Access", "Requested", "Status", "Admin Comment", "Created"],
    )


def show_my_access(store, mailer) -> None:
    render_page_header(
        "Access Review",
        "Search your name or email to review and update your access details.",
    )
    settings = store.get_admin_settings()
    contact_email = settings.get("centralAdminEmail", "")
    if contact_email:
        render_notice(
            f"If the access owner has left the company, please inform the admin team at {contact_email}."
        )

    with st.form("my_access_search"):
        query = st.text_input("Search by name or email")
        search_clicked = st.form_submit_button("Search", type="primary")

    if search_clicked:
        if not query.strip():
            st.error("Please enter a name or email address.")
        else:
            st.session_state.my_access_records = store.search_active_access(query)
            st.session_state.my_access_selected_id = ""
            st.session_state.my_access_otp_record_id = ""
            st.session_state.my_access_otp_expires_at = ""

    records = st.session_state.my_access_records
    if not records:
        st.caption("Search to load your access records.")
        return

    preview_rows = []
    for item in records:
        fields = item["fields"]
        preview_rows.append(
            {
                "ID": item["id"],
                "Region": fields.get("Region", ""),
                "Branch": fields.get("Branch", ""),
                "Name": fields.get("Name", ""),
                "Email": fields.get("Email", ""),
                "Access": fields.get("AirtableAccess", ""),
                "Position": fields.get("Position", ""),
                "R&R": fields.get("RR", ""),
            }
        )

    render_table(
        preview_rows,
        ["Region", "Branch", "Name", "Email", "Access", "Position", "R&R"],
    )

    selected_id = st.selectbox(
        "Select a record to edit",
        options=[r["id"] for r in records],
        format_func=lambda rid: next(
            (
                f"{row['fields'].get('Name','-')} | {row['fields'].get('Email','-')} | {row['fields'].get('Branch','-')}"
                for row in records
                if row["id"] == rid
            ),
            rid,
        ),
    )
    st.session_state.my_access_selected_id = selected_id
    selected = next(row for row in records if row["id"] == selected_id)

    fields = selected["fields"]
    st.subheader("Request Updates")
    st.text_input("Name", value=fields.get("Name", ""), disabled=True)
    st.text_input("Email", value=fields.get("Email", ""), disabled=True)

    c1, c2, c3 = st.columns(3)
    with c1:
        position = st.text_input("Position", value=fields.get("Position", ""), key=f"my_access_position_{selected_id}")
    with c2:
        rr = st.text_input("R&R", value=fields.get("RR", ""), key=f"my_access_rr_{selected_id}")
    with c3:
        access = st.selectbox(
            "Airtable Access",
            options=["Viewer", "Editor", "Related mail recipient"],
            index=["Viewer", "Editor", "Related mail recipient"].index(fields.get("AirtableAccess", "Viewer"))
            if fields.get("AirtableAccess", "Viewer") in ["Viewer", "Editor", "Related mail recipient"]
            else 0,
            key=f"my_access_access_{selected_id}",
        )

    c4, c5 = st.columns([1, 2])
    with c4:
        send_otp_clicked = st.button("Send Verification Code", type="primary")
    with c5:
        expires_at = st.session_state.my_access_otp_expires_at
        if st.session_state.my_access_otp_record_id == selected_id and expires_at:
            try:
                expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                left = max(0, int((expiry - datetime.now(timezone.utc)).total_seconds()))
                st.caption(f"Code expires in about {left} seconds")
            except Exception:
                st.caption("Code sent")

    if send_otp_clicked:
        try:
            otp_data = store.create_access_otp(selected_id, fields.get("Email", ""))
            mailer.send_access_verification_email(
                requester_email=fields.get("Email", ""),
                name=fields.get("Name", ""),
                branch=fields.get("Branch", ""),
                access=fields.get("AirtableAccess", ""),
                code=otp_data["code"],
                expires_in_label="2 minutes 30 seconds",
            )
            st.session_state.my_access_otp_record_id = selected_id
            st.session_state.my_access_otp_expires_at = otp_data["expiresAt"]
            st.success(f"Verification code sent to {fields.get('Email', '')}")
        except Exception as err:
            st.error(f"Failed to send verification code: {err}")

    code = st.text_input("Verification Code", max_chars=6)
    verify_clicked = st.button("Verify & Save")
    if not verify_clicked:
        return

    if st.session_state.my_access_otp_record_id != selected_id:
        st.error("Please send a verification code first.")
        return

    if len(code.strip()) != 6:
        st.error("Please enter the 6-digit verification code.")
        return

    otp_check = store.verify_access_otp(selected_id, fields.get("Email", ""), code.strip())
    if not otp_check.get("ok"):
        reason = otp_check.get("reason")
        if reason == "expired":
            st.error("Verification code expired. Please resend a new code.")
        elif reason == "invalid":
            st.error(
                f"Verification code is incorrect. Attempts left: {otp_check.get('attemptsLeft', 0)}"
            )
        else:
            st.error("Verification code not found. Please resend a new code.")
        return

    current_access = fields.get("AirtableAccess", "")
    if access in ("Viewer", "Editor") and access != current_access:
        quota = store.is_quota_exceeded(fields.get("Branch", ""), access)
        if quota["exceeded"]:
            st.error(f"Branch quota exceeded for {access}. Limit: {quota['limit']}.")
            return

    try:
        updated = store.update_active_access_record(
            selected_id,
            {
                "Position": position.strip(),
                "RR": rr.strip(),
                "AirtableAccess": access,
            },
        )
        st.success("Your access details were updated successfully.")
        st.session_state.my_access_records = [
            (updated if row["id"] == selected_id else row) for row in records
        ]
        st.session_state.my_access_otp_record_id = ""
        st.session_state.my_access_otp_expires_at = ""
    except Exception as err:
        st.error(f"Update failed: {err}")


def show_admin_dashboard(store, mailer) -> None:
    render_page_header(
        "Admin Dashboard",
        "Edit requests, manage settings, and export access lists.",
    )

    if not st.session_state.admin_authed:
        st.markdown("<h2 style='margin-top:0;'>Admin Access</h2>", unsafe_allow_html=True)
        st.caption("Enter the admin password to access the dashboard.")
        with st.form("admin_unlock_form"):
            admin_email = st.text_input("Admin Email", placeholder="name@company.com")
            password = st.text_input("Admin Password", type="password")
            otp_code = st.text_input("OTP Code", placeholder="6-digit code", max_chars=6)
            unlock = st.form_submit_button("Unlock", type="primary")

        if unlock:
            if not store.is_admin_email(admin_email or ""):
                st.error("Admin email is not authorized.")
                return

            # Prefer per-admin secret stored in Airtable; fall back to global ADMIN_TOTP_SECRET if present.
            secret = (store.get_admin_totp_secret(admin_email) or "").strip()
            otp_ok = is_totp_valid(secret, otp_code) if secret else is_admin_totp_valid(otp_code)

            if is_admin_password_valid(password) and otp_ok:
                st.session_state.admin_authed = True
                st.session_state.admin_password = password
                st.session_state.admin_email = (admin_email or "").strip()
                exp = int(datetime.now(timezone.utc).timestamp()) + SESSION_TTL_SECONDS
                _set_cookie("admin_auth", {"kind": "admin", "exp": exp, "email": st.session_state.admin_email})
                st.rerun()
            else:
                st.error("Invalid admin password or OTP code.")
        return

    left_actions, _ = st.columns([2.6, 7.4], gap="small")
    with left_actions:
        a1, a2 = st.columns([1, 1], gap="small")
        with a1:
            refresh_clicked = st.button("Refresh Data")
        with a2:
            connection_check_clicked = st.button("Check Airtable Access")

    if connection_check_clicked:
        success, ok_messages, error_messages = check_airtable_connection(store)
        show_airtable_connection_dialog(success, ok_messages, error_messages)

    if refresh_clicked:
        st.rerun()

    requests = store.list_all_requests()
    active_access = store.list_active_access()
    settings = store.get_admin_settings()
    hierarchy = store.get_hierarchy_rows()

    req_xlsx = build_excel_bytes(requests, store.map_request_for_export)
    act_xlsx = build_excel_bytes(active_access, store.map_active_for_export)

    requests_tab, active_tab, settings_tab = st.tabs(
        ["Requests", "Active Access", "Settings"]
    )

    with requests_tab:
        _, req_export_col = st.columns([8.2, 1.8], gap="small")
        with req_export_col:
            st.download_button(
                label="Export to Excel",
                data=req_xlsx,
                file_name="Requests.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                key="export_requests_xlsx",
                use_container_width=True,
            )
        f1, f2, f3, f4, f5 = st.columns(5)
        region_filter = f1.selectbox("Region", options=[""] + sorted({r["fields"].get("Region", "") for r in requests if r["fields"].get("Region")}))
        subsidiary_filter = f2.selectbox("Subsidiary", options=[""] + sorted({r["fields"].get("Subsidiary", "") for r in requests if r["fields"].get("Subsidiary")}))
        branch_filter = f3.selectbox("Branch", options=[""] + sorted({r["fields"].get("Branch", "") for r in requests if r["fields"].get("Branch")}))
        access_filter = f4.selectbox("Access", options=[""] + sorted({r["fields"].get("AirtableAccess", "") for r in requests if r["fields"].get("AirtableAccess")}))
        search_filter = f5.text_input("Search")

        filtered = pick_filtered_requests(
            requests,
            region_filter,
            subsidiary_filter,
            branch_filter,
            access_filter,
            search_filter,
        )
        st.caption(f"{len(filtered)} records")

        if filtered:
            h1, h2, h3, h4, h5, h6, h7, h8, h9 = st.columns([0.85, 0.95, 1.1, 1.0, 1.5, 0.85, 0.95, 0.95, 3.85], gap="small")
            h1.markdown("**Region**")
            h2.markdown("**Subsidiary**")
            h3.markdown("**Branch**")
            h4.markdown("**Type**")
            h5.markdown("**Requester**")
            h6.markdown("**Access**")
            h7.markdown("**Status**")
            h8.markdown("**Created**")
            h9.markdown("**Actions**")
            st.markdown("<div class='active-grid-divider'></div>", unsafe_allow_html=True)

            for item in filtered:
                fields = item["fields"]
                record_id = item["id"]
                c1, c2, c3, c4, c5, c6, c7, c8, c9 = st.columns([0.85, 0.95, 1.1, 1.0, 1.5, 0.85, 0.95, 0.95, 3.85], gap="small")
                c1.markdown(f"<div class='active-cell'>{html.escape(fields.get('Region', '-') or '-')}</div>", unsafe_allow_html=True)
                c2.markdown(f"<div class='active-cell'>{html.escape(fields.get('Subsidiary', '-') or '-')}</div>", unsafe_allow_html=True)
                c3.markdown(f"<div class='active-cell'>{html.escape(fields.get('Branch', '-') or '-')}</div>", unsafe_allow_html=True)
                c4.markdown(f"<div class='active-cell'>{html.escape(fields.get('RequestType', '-') or '-')}</div>", unsafe_allow_html=True)
                c5.markdown(f"<div class='active-cell'>{html.escape(fields.get('RequesterEmail', '-') or '-')}</div>", unsafe_allow_html=True)
                c6.markdown(f"<div class='active-cell'>{html.escape(fields.get('AirtableAccess', '-') or '-')}</div>", unsafe_allow_html=True)
                c7.markdown(f"<div class='active-cell'>{html.escape(fields.get('Status', '-') or '-')}</div>", unsafe_allow_html=True)
                c8.markdown(
                    f"<div class='active-cell'>{html.escape(format_datetime(item.get('createdDateTime', '')))}</div>",
                    unsafe_allow_html=True,
                )
                with c9:
                    a1, a2, a3 = st.columns([1.0, 1.0, 1.0], gap="small")
                    with a1:
                        if st.button("Edit", key=f"request_row_edit_{record_id}"):
                            show_request_edit_dialog(store, mailer, hierarchy, item)
                    with a2:
                        if st.button("Notify", key=f"request_row_notify_{record_id}"):
                            show_request_notify_dialog(mailer, item)
                    with a3:
                        if st.button("Delete", key=f"request_row_delete_{record_id}"):
                            show_request_delete_dialog(store, mailer, item)

                st.markdown("<div class='active-grid-divider'></div>", unsafe_allow_html=True)
        else:
            st.info("No records found.")

    with active_tab:
        _, act_export_col = st.columns([8.2, 1.8], gap="small")
        with act_export_col:
            st.download_button(
                label="Export to Excel",
                data=act_xlsx,
                file_name="ActiveAccess.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                key="export_active_access_xlsx",
                use_container_width=True,
            )

        g1, g2, g3, g4, g5 = st.columns(5)
        region_filter = g1.selectbox("Region ", options=[""] + sorted({r["fields"].get("Region", "") for r in active_access if r["fields"].get("Region")}))
        subsidiary_filter = g2.selectbox("Subsidiary ", options=[""] + sorted({r["fields"].get("Subsidiary", "") for r in active_access if r["fields"].get("Subsidiary")}))
        branch_filter = g3.selectbox("Branch ", options=[""] + sorted({r["fields"].get("Branch", "") for r in active_access if r["fields"].get("Branch")}))
        access_filter = g4.selectbox("Access ", options=[""] + sorted({r["fields"].get("AirtableAccess", "") for r in active_access if r["fields"].get("AirtableAccess")}))
        search_filter = g5.text_input("Search ")

        filtered = pick_filtered_active(
            active_access,
            region_filter,
            subsidiary_filter,
            branch_filter,
            access_filter,
            search_filter,
        )
        st.caption(f"{len(filtered)} records")

        if filtered:
            h1, h2, h3, h4, h5, h6, h7, h8 = st.columns([0.85, 0.95, 1.1, 1.05, 1.7, 0.8, 0.9, 4.1], gap="small")
            h1.markdown("**Region**")
            h2.markdown("**Subsidiary**")
            h3.markdown("**Branch**")
            h4.markdown("**Name**")
            h5.markdown("**Email**")
            h6.markdown("**Access**")
            h7.markdown("**Activated**")
            h8.markdown("**Actions**")
            st.markdown("<div class='active-grid-divider'></div>", unsafe_allow_html=True)

            for item in filtered:
                fields = item["fields"]
                record_id = item["id"]
                c1, c2, c3, c4, c5, c6, c7, c8 = st.columns([0.85, 0.95, 1.1, 1.05, 1.7, 0.8, 0.9, 4.1], gap="small")

                c1.markdown(f"<div class='active-cell'>{html.escape(fields.get('Region', '-') or '-')}</div>", unsafe_allow_html=True)
                c2.markdown(f"<div class='active-cell'>{html.escape(fields.get('Subsidiary', '-') or '-')}</div>", unsafe_allow_html=True)
                c3.markdown(f"<div class='active-cell'>{html.escape(fields.get('Branch', '-') or '-')}</div>", unsafe_allow_html=True)
                c4.markdown(f"<div class='active-cell'>{html.escape(fields.get('Name', '-') or '-')}</div>", unsafe_allow_html=True)
                c5.markdown(f"<div class='active-cell'>{html.escape(fields.get('Email', '-') or '-')}</div>", unsafe_allow_html=True)
                c6.markdown(f"<div class='active-cell'>{html.escape(fields.get('AirtableAccess', '-') or '-')}</div>", unsafe_allow_html=True)
                c7.markdown(f"<div class='active-cell'>{html.escape(format_datetime(fields.get('ActivatedAt', '')))}</div>", unsafe_allow_html=True)

                with c8:
                    a1, a2, a3 = st.columns([1.0, 1.0, 1.0], gap="small")
                    with a1:
                        if st.button("Edit", key=f"active_row_edit_{record_id}"):
                            show_active_edit_dialog(store, item)
                    with a2:
                        if st.button("Notify", key=f"active_row_notify_{record_id}"):
                            show_active_notify_dialog(mailer, item)
                    with a3:
                        if st.button("Delete", key=f"active_row_delete_{record_id}"):
                            show_active_delete_dialog(store, item)

                st.markdown("<div class='active-grid-divider'></div>", unsafe_allow_html=True)
        else:
            st.info("No records found.")

    with settings_tab:
        with st.form("admin_settings_form"):
            central_admin_email = st.text_input(
                "Central Admin Email",
                value=settings.get("centralAdminEmail", ""),
            )
            recipients = st.text_area(
                "Admin Notify Recipients (one per line)",
                value=settings.get("adminNotifyRecipients", ""),
                height=120,
            )
            save_settings = st.form_submit_button("Save Settings", type="primary")

        if save_settings:
            if not central_admin_email.strip():
                st.error("Central Admin Email is required.")
            else:
                try:
                    store.upsert_admin_settings(central_admin_email.strip(), recipients)
                    st.success("Settings saved.")
                    st.rerun()
                except Exception as err:
                    st.error(f"Failed to save settings: {err}")

        st.markdown("---")
        st.subheader("Admin OTP")
        st.caption("Enable 2FA for Admin Dashboard using a TOTP app (Google Authenticator/Authy).")
        if st.button("Open OTP Setup"):
            show_admin_totp_setup_dialog(store, mailer)



ensure_session_defaults()
inject_legacy_theme()
apply_persistent_auth()
apply_cookie_auth()

try:
    store, mailer = init_services()
except Exception as err:
    st.error(f"Failed to initialize app: {err}")
    st.stop()

page = st.query_params.get("page", "home")
if isinstance(page, list):
    page = page[0] if page else "home"
if page not in PAGE_CONFIG:
    page = "home"
    st.query_params["page"] = "home"

# Portal password should protect the main app, but Admin should be reachable directly
# (admin auth still requires its own password + OTP).
if portal_password_enabled() and not st.session_state.site_authed and page != "admin":
    show_site_login(store)
    st.stop()

render_nav(page)

try:
    if page == "home":
        show_home()
    elif page == "request":
        show_new_request(store, mailer)
    elif page == "my-access":
        show_my_access(store, mailer)
    elif page == "my-requests":
        show_my_requests(store)
    else:
        show_admin_dashboard(store, mailer)
except RuntimeError as err:
    if render_airtable_not_found_error(err, store):
        st.stop()
    raise
