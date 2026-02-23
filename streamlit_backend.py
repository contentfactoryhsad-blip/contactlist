from __future__ import annotations

import hashlib
import html
import io
import os
import random
import re
import smtplib
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Callable

import pandas as pd
import requests
from dotenv import dotenv_values, load_dotenv

DOTENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=DOTENV_PATH)


WRITE_FIELD_ALIASES: dict[str, str] = {
    "RR": "R&R",
    "RequestType": "Request Type",
    "RequesterEmail": "Requester Email",
    "AirtableAccess": "Airtable Access",
    "CurrentAccess": "Current Access",
    "RequestedAccess": "Requested Access",
    "ChangeReason": "Change Reason",
    "AdminComment": "Admin Comment",
    "CreatedAt": "Created At",
    "UpdatedAt": "Updated At",
    "SourceRequestId": "Source Request ID",
    "ActivatedAt": "Activated At",
    "CentralAdminEmail": "Central Admin Email",
    "AdminNotifyRecipients": "Admin Notify Recipients",
    "IsActive": "Is Active",
    "LastSentAt": "Last Sent At",
    "UserAgent": "User Agent",
    "AcceptLanguage": "Accept Language",
}

QUOTA_LIMITS: dict[str, int] = {
    "Viewer": 3,
    "Editor": 2,
}


@dataclass
class AirtableTables:
    requests: str
    active_access: str
    reference: str
    admins: str
    settings: str
    deleted_requests: str
    deleted_active_access: str
    access_otp: str
    login_audit: str


@dataclass
class AppConfig:
    airtable_base_id: str
    airtable_api_key: str
    tables: AirtableTables
    smtp_host: str
    smtp_port: int
    smtp_secure: bool
    smtp_user: str
    smtp_pass: str
    smtp_from: str
    admin_password: str
    site_password: str

    @staticmethod
    def from_env() -> "AppConfig":
        file_env = {
            key: str(value).strip()
            for key, value in dotenv_values(DOTENV_PATH).items()
            if value is not None
        }

        def read(name: str, default: str = "") -> str:
            local = file_env.get(name, "")
            if local:
                return local
            return (os.getenv(name) or default).strip()

        site_password = read("SITE_PASSWORD") or read("ADMIN_PASSWORD")
        return AppConfig(
            airtable_base_id=read("AIRTABLE_BASE_ID"),
            airtable_api_key=read("AIRTABLE_API_KEY"),
            tables=AirtableTables(
                requests=read("AIRTABLE_TABLE_REQUESTS", "Requests"),
                active_access=read("AIRTABLE_TABLE_ACTIVE_ACCESS", "ActiveAccess"),
                reference=read("AIRTABLE_TABLE_REFERENCE", "ReferenceHierarchy"),
                admins=read("AIRTABLE_TABLE_ADMINS", "AdminUsers"),
                settings=read("AIRTABLE_TABLE_SETTINGS", "AdminSettings"),
                deleted_requests=read("AIRTABLE_TABLE_DELETED_REQUESTS", "DeletedRequests"),
                deleted_active_access=read("AIRTABLE_TABLE_DELETED_ACTIVE_ACCESS", "DeletedActiveAccess"),
                access_otp=read("AIRTABLE_TABLE_ACCESS_OTP", "AccessOtp"),
                login_audit=read("AIRTABLE_TABLE_LOGIN_AUDIT", "LoginAudit"),
            ),
            smtp_host=read("SMTP_HOST"),
            smtp_port=int(read("SMTP_PORT", "587")),
            smtp_secure=read("SMTP_SECURE", "false").lower() == "true",
            smtp_user=read("SMTP_USER"),
            smtp_pass=read("SMTP_PASS"),
            smtp_from=read("SMTP_FROM"),
            admin_password=read("ADMIN_PASSWORD"),
            site_password=site_password,
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(x) for x in value)
    return str(value)


def _read_field(fields: dict[str, Any], name: str) -> str:
    value = fields.get(name)
    if value not in (None, ""):
        return _as_text(value)

    alias = WRITE_FIELD_ALIASES.get(name)
    if alias:
        alias_value = fields.get(alias)
        if alias_value not in (None, ""):
            return _as_text(alias_value)

    return ""


def _read_bool_field(fields: dict[str, Any], name: str, default: bool = False) -> bool:
    value = fields.get(name)
    if value is None:
        alias = WRITE_FIELD_ALIASES.get(name)
        value = fields.get(alias) if alias else None

    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized == "true":
            return True
        if normalized == "false":
            return False
    return default


def _with_legacy_field_names(fields: dict[str, Any]) -> dict[str, Any]:
    mapped: dict[str, Any] = {}
    for key, value in fields.items():
        mapped[WRITE_FIELD_ALIASES.get(key, key)] = value
    return mapped


def _is_unknown_field_error(message: str) -> bool:
    lower = message.lower()
    return "unknown_field_name" in lower or "unknown field" in lower


def _extract_unknown_fields(message: str) -> set[str]:
    unknowns: set[str] = set()
    pattern = r'Unknown field name:\s*\\?"([^"\\]+)\\?"'
    for match in re.findall(pattern, message, flags=re.IGNORECASE):
        unknowns.add(match.strip())
    return unknowns


def _drop_unknown_fields(fields: dict[str, Any], unknowns: set[str]) -> dict[str, Any]:
    if not unknowns:
        return fields

    alias_to_key = {alias: key for key, alias in WRITE_FIELD_ALIASES.items()}
    dropped_keys = set(unknowns)

    for unknown in unknowns:
        canonical_key = alias_to_key.get(unknown)
        if canonical_key:
            dropped_keys.add(canonical_key)
        alias = WRITE_FIELD_ALIASES.get(unknown)
        if alias:
            dropped_keys.add(alias)

    return {key: value for key, value in fields.items() if key not in dropped_keys}


def _escape_formula(value: str) -> str:
    return value.replace("'", "\\'")


class AirtableClient:
    def __init__(self, config: AppConfig) -> None:
        self.config = config

    @property
    def _base_url(self) -> str:
        return f"https://api.airtable.com/v0/{self.config.airtable_base_id}"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.airtable_api_key}",
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self._base_url}/{path}"
        res = requests.request(
            method=method,
            url=url,
            headers=self._headers(),
            params=params,
            json=payload,
            timeout=30,
        )

        if not res.ok:
            text = res.text
            raise RuntimeError(f"Airtable error {res.status_code}: {text}")

        if not res.text:
            return {}
        return res.json()

    def list_all_records(
        self,
        table: str,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        offset: str | None = None

        while True:
            query = dict(params or {})
            if offset:
                query["offset"] = offset

            data = self._request("GET", table, params=query)
            records.extend(data.get("records", []))
            offset = data.get("offset")
            if not offset:
                break

        return records

    def get_record(self, table: str, record_id: str) -> dict[str, Any]:
        return self._request("GET", f"{table}/{record_id}")

    def _write_with_unknown_field_fallback(
        self,
        method: str,
        path: str,
        fields: dict[str, Any],
        as_record_list: bool,
    ) -> dict[str, Any]:
        variants = [dict(fields), _with_legacy_field_names(fields)]
        seen_variants: set[tuple[str, ...]] = set()
        last_error: RuntimeError | None = None

        for variant in variants:
            current = dict(variant)
            signature = tuple(sorted(current.keys()))
            if signature in seen_variants:
                continue
            seen_variants.add(signature)

            for _ in range(len(current) + 1):
                try:
                    payload = {"records": [{"fields": current}]} if as_record_list else {"fields": current}
                    data = self._request(method, path, payload=payload)
                    if as_record_list:
                        return (data.get("records") or [{}])[0]
                    return data
                except RuntimeError as err:
                    if not _is_unknown_field_error(str(err)):
                        raise
                    unknowns = _extract_unknown_fields(str(err))
                    reduced = _drop_unknown_fields(current, unknowns)
                    if reduced == current:
                        last_error = err
                        break
                    current = reduced
                    last_error = err

        if last_error is not None:
            raise last_error
        fallback_payload = {"records": [{"fields": fields}]} if as_record_list else {"fields": fields}
        fallback_data = self._request(method, path, payload=fallback_payload)
        if as_record_list:
            return (fallback_data.get("records") or [{}])[0]
        return fallback_data

    def create_record(self, table: str, fields: dict[str, Any]) -> dict[str, Any]:
        return self._write_with_unknown_field_fallback("POST", table, fields, as_record_list=True)

    def create_records(self, table: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        created: list[dict[str, Any]] = []
        for start in range(0, len(records), 10):
            chunk = records[start : start + 10]
            payload = {"records": [{"fields": row} for row in chunk]}
            try:
                data = self._request("POST", table, payload=payload)
            except RuntimeError as err:
                if not _is_unknown_field_error(str(err)):
                    raise
                legacy_chunk = [_with_legacy_field_names(row) for row in chunk]
                data = self._request(
                    "POST",
                    table,
                    payload={"records": [{"fields": row} for row in legacy_chunk]},
                )
            created.extend(data.get("records", []))
        return created

    def update_record(self, table: str, record_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        return self._write_with_unknown_field_fallback(
            "PATCH",
            f"{table}/{record_id}",
            fields,
            as_record_list=False,
        )

    def delete_record(self, table: str, record_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"{table}/{record_id}")


class AccessStore:
    def __init__(self, config: AppConfig | None = None) -> None:
        self.config = config or AppConfig.from_env()
        if not self.config.airtable_base_id or not self.config.airtable_api_key:
            raise RuntimeError("AIRTABLE_BASE_ID or AIRTABLE_API_KEY is missing.")
        self.client = AirtableClient(self.config)

    @staticmethod
    def _normalize_request_fields(fields: dict[str, Any]) -> dict[str, str]:
        return {
            "RequestId": _read_field(fields, "RequestId"),
            "RequestType": _read_field(fields, "RequestType") or "New Access",
            "Region": _read_field(fields, "Region"),
            "Subsidiary": _read_field(fields, "Subsidiary"),
            "Branch": _read_field(fields, "Branch"),
            "Name": _read_field(fields, "Name"),
            "Position": _read_field(fields, "Position"),
            "RR": _read_field(fields, "RR"),
            "RequesterEmail": _read_field(fields, "RequesterEmail"),
            "AirtableAccess": _read_field(fields, "AirtableAccess"),
            "CurrentAccess": _read_field(fields, "CurrentAccess"),
            "RequestedAccess": _read_field(fields, "RequestedAccess"),
            "ChangeReason": _read_field(fields, "ChangeReason"),
            "Status": _read_field(fields, "Status"),
            "AdminComment": _read_field(fields, "AdminComment"),
            "CreatedAt": _read_field(fields, "CreatedAt"),
            "UpdatedAt": _read_field(fields, "UpdatedAt"),
        }

    @staticmethod
    def _normalize_active_fields(fields: dict[str, Any]) -> dict[str, str]:
        return {
            "Region": _read_field(fields, "Region"),
            "Subsidiary": _read_field(fields, "Subsidiary"),
            "Branch": _read_field(fields, "Branch"),
            "Name": _read_field(fields, "Name"),
            "Email": _read_field(fields, "Email"),
            "Position": _read_field(fields, "Position"),
            "RR": _read_field(fields, "RR"),
            "AirtableAccess": _read_field(fields, "AirtableAccess"),
            "SourceRequestId": _read_field(fields, "SourceRequestId"),
            "ActivatedAt": _read_field(fields, "ActivatedAt"),
        }

    @staticmethod
    def _normalize_otp_fields(fields: dict[str, Any]) -> dict[str, str]:
        return {
            "RecordId": _read_field(fields, "RecordId"),
            "Email": _read_field(fields, "Email"),
            "CodeHash": _read_field(fields, "CodeHash"),
            "ExpiresAt": _read_field(fields, "ExpiresAt"),
            "CreatedAt": _read_field(fields, "CreatedAt"),
            "Attempts": _read_field(fields, "Attempts") or "0",
            "UsedAt": _read_field(fields, "UsedAt"),
            "LastSentAt": _read_field(fields, "LastSentAt"),
        }

    def _resolve_record_id(self, table: str, row_id: str, lookup_field: str | None = None) -> str:
        try:
            direct = self.client.get_record(table, row_id)
            return str(direct["id"])
        except Exception:
            if not lookup_field:
                raise RuntimeError("Record not found.")

        records = self.client.list_all_records(table)
        for record in records:
            fields = record.get("fields", {})
            if _read_field(fields, lookup_field) == row_id:
                return str(record["id"])

        raise RuntimeError("Record not found.")

    def get_admin_settings(self) -> dict[str, Any]:
        records = self.client.list_all_records(self.config.tables.settings)
        record = records[0] if records else None
        fields = record.get("fields", {}) if record else {}
        return {
            "id": record.get("id") if record else None,
            "centralAdminEmail": _read_field(fields, "CentralAdminEmail"),
            "adminNotifyRecipients": _read_field(fields, "AdminNotifyRecipients"),
        }

    def upsert_admin_settings(self, central_admin_email: str, admin_notify_recipients: str) -> dict[str, Any]:
        existing = self.get_admin_settings()
        fields = {
            "CentralAdminEmail": central_admin_email.strip(),
            "AdminNotifyRecipients": admin_notify_recipients.strip(),
        }
        if existing.get("id"):
            self.client.update_record(self.config.tables.settings, existing["id"], fields)
            return {"id": existing["id"], **fields}
        created = self.client.create_record(self.config.tables.settings, fields)
        return {"id": created.get("id"), **fields}

    def list_admin_users(self) -> list[dict[str, Any]]:
        records = self.client.list_all_records(self.config.tables.admins)
        normalized: list[dict[str, Any]] = []
        for record in records:
            fields = record.get("fields", {})
            normalized.append(
                {
                    "id": record.get("id"),
                    "fields": {
                        "Email": _read_field(fields, "Email"),
                        "Role": _read_field(fields, "Role"),
                    },
                }
            )
        return normalized

    def is_admin_email(self, email: str) -> bool:
        target = _normalize_email(email)
        return any(_normalize_email(row["fields"]["Email"]) == target for row in self.list_admin_users())

    def get_hierarchy_rows(self) -> list[dict[str, str]]:
        records = self.client.list_all_records(self.config.tables.reference)
        rows: list[dict[str, str]] = []
        for record in records:
            fields = record.get("fields", {})
            if not _read_bool_field(fields, "IsActive", True):
                continue
            region = _read_field(fields, "Region")
            subsidiary = _read_field(fields, "Subsidiary")
            branch = _read_field(fields, "Branch")
            if not region or not subsidiary or not branch:
                continue
            rows.append({"Region": region, "Subsidiary": subsidiary, "Branch": branch})
        return rows

    def list_all_requests(self) -> list[dict[str, Any]]:
        records = self.client.list_all_records(self.config.tables.requests)
        normalized: list[dict[str, Any]] = []
        for record in records:
            fields = self._normalize_request_fields(record.get("fields", {}))
            normalized.append(
                {
                    "id": record.get("id"),
                    "createdDateTime": fields.get("CreatedAt") or record.get("createdTime", ""),
                    "fields": fields,
                }
            )
        normalized.sort(key=lambda row: row["fields"].get("CreatedAt", ""), reverse=True)
        return normalized

    def list_requests_by_email(self, email: str) -> list[dict[str, Any]]:
        target = _normalize_email(email)
        return [
            row
            for row in self.list_all_requests()
            if _normalize_email(row["fields"].get("RequesterEmail", "")) == target
        ]

    def list_active_access(self) -> list[dict[str, Any]]:
        records = self.client.list_all_records(self.config.tables.active_access)
        normalized: list[dict[str, Any]] = []
        for record in records:
            fields = self._normalize_active_fields(record.get("fields", {}))
            normalized.append(
                {
                    "id": record.get("id"),
                    "createdDateTime": fields.get("ActivatedAt") or record.get("createdTime", ""),
                    "fields": fields,
                }
            )
        normalized.sort(key=lambda row: row["fields"].get("ActivatedAt", ""), reverse=True)
        return normalized

    def search_active_access(self, query: str) -> list[dict[str, Any]]:
        target = query.strip().lower()
        if not target:
            return []

        matches: list[dict[str, Any]] = []
        for row in self.list_active_access():
            name = (row["fields"].get("Name") or "").lower()
            email = (row["fields"].get("Email") or "").lower()
            if target in name or target in email:
                matches.append(row)
            if len(matches) >= 50:
                break

        return matches

    def get_request_record(self, row_id: str) -> dict[str, Any]:
        record_id = self._resolve_record_id(self.config.tables.requests, row_id, "RequestId")
        record = self.client.get_record(self.config.tables.requests, record_id)
        fields = self._normalize_request_fields(record.get("fields", {}))
        return {
            "id": record.get("id"),
            "createdDateTime": fields.get("CreatedAt") or record.get("createdTime", ""),
            "fields": fields,
        }

    def get_active_access_record(self, row_id: str) -> dict[str, Any]:
        record_id = self._resolve_record_id(
            self.config.tables.active_access,
            row_id,
            "SourceRequestId",
        )
        record = self.client.get_record(self.config.tables.active_access, record_id)
        fields = self._normalize_active_fields(record.get("fields", {}))
        return {
            "id": record.get("id"),
            "createdDateTime": fields.get("ActivatedAt") or record.get("createdTime", ""),
            "fields": fields,
        }

    def create_request_record(self, fields: dict[str, str]) -> dict[str, str]:
        now = _now_iso()
        request_id = str(uuid.uuid4())
        payload = {
            "RequestId": request_id,
            "RequestType": fields.get("RequestType") or "New Access",
            "Region": fields.get("Region", ""),
            "Subsidiary": fields.get("Subsidiary", ""),
            "Branch": fields.get("Branch", ""),
            "Name": fields.get("Name", ""),
            "Position": fields.get("Position", ""),
            "RR": fields.get("RR", ""),
            "RequesterEmail": _normalize_email(fields.get("RequesterEmail", "")),
            "AirtableAccess": fields.get("AirtableAccess", ""),
            "CurrentAccess": fields.get("CurrentAccess", ""),
            "RequestedAccess": fields.get("RequestedAccess", ""),
            "ChangeReason": fields.get("ChangeReason", ""),
            "Status": fields.get("Status", "Request Submitted"),
            "AdminComment": "",
            "CreatedAt": now,
            "UpdatedAt": now,
        }
        created = self.client.create_record(self.config.tables.requests, payload)
        return {"id": str(created.get("id", "")), "requestId": request_id}

    def update_request_record(self, row_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        record = self.get_request_record(row_id)
        previous = dict(record["fields"])
        merged: dict[str, Any] = dict(previous)
        for key, value in updates.items():
            merged[key] = "" if value is None else str(value)

        if merged.get("RR") and not merged.get("R&R"):
            merged["R&R"] = merged["RR"]
        if merged.get("R&R") and not merged.get("RR"):
            merged["RR"] = merged["R&R"]

        merged["UpdatedAt"] = _now_iso()

        self.client.update_record(self.config.tables.requests, record["id"], merged)
        return {"id": record["id"], "fields": merged, "previous": previous}

    def delete_request_record(self, row_id: str) -> dict[str, Any]:
        record = self.get_request_record(row_id)
        self.client.delete_record(self.config.tables.requests, record["id"])
        return {"id": record["id"], "fields": record["fields"]}

    def log_deleted_request(self, fields: dict[str, str], reason: str, request_id: str = "") -> None:
        payload = {
            "RequestId": request_id or fields.get("RequestId", ""),
            "RequestType": fields.get("RequestType", "New Access"),
            "Region": fields.get("Region", ""),
            "Subsidiary": fields.get("Subsidiary", ""),
            "Branch": fields.get("Branch", ""),
            "Name": fields.get("Name", ""),
            "Position": fields.get("Position", ""),
            "RR": fields.get("RR", ""),
            "RequesterEmail": fields.get("RequesterEmail", ""),
            "AirtableAccess": fields.get("AirtableAccess", ""),
            "CurrentAccess": fields.get("CurrentAccess", ""),
            "RequestedAccess": fields.get("RequestedAccess", ""),
            "ChangeReason": fields.get("ChangeReason", ""),
            "Status": fields.get("Status", ""),
            "AdminComment": fields.get("AdminComment", ""),
            "CreatedAt": fields.get("CreatedAt", ""),
            "UpdatedAt": fields.get("UpdatedAt", ""),
            "DeletedAt": _now_iso(),
            "DeletedReason": reason.strip(),
        }
        self.client.create_record(self.config.tables.deleted_requests, payload)

    def add_active_access(self, fields: dict[str, str]) -> dict[str, str]:
        payload = {
            "Region": fields.get("Region", ""),
            "Subsidiary": fields.get("Subsidiary", ""),
            "Branch": fields.get("Branch", ""),
            "Name": fields.get("Name", ""),
            "Email": _normalize_email(fields.get("Email", "")),
            "Position": fields.get("Position", ""),
            "RR": fields.get("RR", ""),
            "AirtableAccess": fields.get("AirtableAccess", ""),
            "SourceRequestId": fields.get("SourceRequestId", ""),
            "ActivatedAt": fields.get("ActivatedAt") or _now_iso(),
        }
        created = self.client.create_record(self.config.tables.active_access, payload)
        return {"id": str(created.get("id", ""))}

    def update_active_access_record(self, row_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        record = self.get_active_access_record(row_id)
        merged: dict[str, Any] = dict(record["fields"])
        for key, value in updates.items():
            merged[key] = "" if value is None else str(value)

        if merged.get("RR") and not merged.get("R&R"):
            merged["R&R"] = merged["RR"]
        if merged.get("R&R") and not merged.get("RR"):
            merged["RR"] = merged["R&R"]

        self.client.update_record(self.config.tables.active_access, record["id"], merged)
        return {"id": record["id"], "fields": merged}

    def delete_active_access_record(self, row_id: str) -> dict[str, Any]:
        record = self.get_active_access_record(row_id)
        self.client.delete_record(self.config.tables.active_access, record["id"])
        return {"id": record["id"], "fields": record["fields"]}

    def log_deleted_active_access(self, fields: dict[str, str], reason: str) -> None:
        payload = {
            "Region": fields.get("Region", ""),
            "Subsidiary": fields.get("Subsidiary", ""),
            "Branch": fields.get("Branch", ""),
            "Name": fields.get("Name", ""),
            "Email": fields.get("Email", ""),
            "Position": fields.get("Position", ""),
            "RR": fields.get("RR", ""),
            "AirtableAccess": fields.get("AirtableAccess", ""),
            "SourceRequestId": fields.get("SourceRequestId", ""),
            "ActivatedAt": fields.get("ActivatedAt", ""),
            "DeletedAt": _now_iso(),
            "DeletedReason": reason.strip(),
        }
        self.client.create_record(self.config.tables.deleted_active_access, payload)

    def count_active_access(self, branch: str, access: str) -> int:
        rows = self.list_active_access()
        return sum(
            1
            for row in rows
            if row["fields"].get("Branch") == branch and row["fields"].get("AirtableAccess") == access
        )

    def count_pending_requests(self, branch: str, access: str) -> int:
        rows = self.list_all_requests()
        return sum(
            1
            for row in rows
            if row["fields"].get("Branch") == branch
            and row["fields"].get("AirtableAccess") == access
            and row["fields"].get("Status") in ("Request Submitted", "Pending")
            and row["fields"].get("RequestType", "New Access") != "Access Update"
        )

    def is_quota_exceeded(self, branch: str, access: str) -> dict[str, Any]:
        active = self.count_active_access(branch, access)
        pending = self.count_pending_requests(branch, access)
        limit = QUOTA_LIMITS.get(access, 0)
        return {
            "active": active,
            "pending": pending,
            "total": active + pending,
            "limit": limit,
            "exceeded": (active + pending) >= limit if limit > 0 else False,
        }

    def has_duplicate_request(self, email: str, branch: str, access: str) -> bool:
        normalized = _normalize_email(email)
        if self.has_active_access(normalized, branch, access):
            return True

        for row in self.list_all_requests():
            fields = row["fields"]
            if (
                _normalize_email(fields.get("RequesterEmail", "")) == normalized
                and fields.get("Branch") == branch
                and fields.get("AirtableAccess") == access
                and fields.get("Status") in ("Request Submitted", "Pending")
                and fields.get("RequestType", "New Access") != "Access Update"
            ):
                return True

        return False

    def has_duplicate_access_update(self, email: str, branch: str, requested_access: str) -> bool:
        normalized = _normalize_email(email)
        for row in self.list_all_requests():
            fields = row["fields"]
            if (
                _normalize_email(fields.get("RequesterEmail", "")) == normalized
                and fields.get("Branch") == branch
                and fields.get("RequestType") == "Access Update"
                and fields.get("RequestedAccess") == requested_access
                and fields.get("Status") in ("Request Submitted", "Pending")
            ):
                return True
        return False

    def has_active_access(self, email: str, branch: str, access: str) -> bool:
        normalized = _normalize_email(email)
        for row in self.list_active_access():
            fields = row["fields"]
            if (
                _normalize_email(fields.get("Email", "")) == normalized
                and fields.get("Branch") == branch
                and fields.get("AirtableAccess") == access
            ):
                return True
        return False

    def log_login_attempt(
        self,
        result: str,
        ip: str = "",
        user_agent: str = "",
        path: str = "",
        referer: str = "",
        accept_language: str = "",
    ) -> None:
        payload = {
            "Timestamp": _now_iso(),
            "Result": result,
            "IP": ip,
            "UserAgent": user_agent,
            "Path": path,
            "Referer": referer,
            "AcceptLanguage": accept_language,
        }
        self.client.create_record(self.config.tables.login_audit, payload)

    @staticmethod
    def _hash_otp(code: str) -> str:
        return hashlib.sha256(code.encode("utf-8")).hexdigest()

    @staticmethod
    def _generate_otp() -> str:
        return f"{random.randint(100000, 999999)}"

    def create_access_otp(self, record_id: str, email: str) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=150)
        code = self._generate_otp()
        payload = {
            "RecordId": record_id,
            "Email": _normalize_email(email),
            "CodeHash": self._hash_otp(code),
            "ExpiresAt": expires_at.isoformat(),
            "CreatedAt": now.isoformat(),
            "Attempts": "0",
            "UsedAt": "",
            "LastSentAt": now.isoformat(),
        }
        self.client.create_record(self.config.tables.access_otp, payload)
        return {"code": code, "expiresAt": expires_at.isoformat(), "ttlSeconds": 150}

    def verify_access_otp(self, record_id: str, email: str, code: str) -> dict[str, Any]:
        rows = self.client.list_all_records(self.config.tables.access_otp)
        target_email = _normalize_email(email)

        candidates: list[dict[str, Any]] = []
        for row in rows:
            fields = self._normalize_otp_fields(row.get("fields", {}))
            if (
                fields.get("RecordId") == record_id
                and _normalize_email(fields.get("Email", "")) == target_email
                and not fields.get("UsedAt")
            ):
                candidates.append({"id": row.get("id"), "fields": fields})

        candidates.sort(key=lambda row: row["fields"].get("CreatedAt", ""), reverse=True)
        latest = candidates[0] if candidates else None
        if not latest:
            return {"ok": False, "reason": "missing"}

        expires_at = latest["fields"].get("ExpiresAt") or ""
        if expires_at:
            if datetime.now(timezone.utc) > datetime.fromisoformat(expires_at.replace("Z", "+00:00")):
                return {"ok": False, "reason": "expired"}

        attempts = int(latest["fields"].get("Attempts", "0") or "0")
        if self._hash_otp(code.strip()) != latest["fields"].get("CodeHash"):
            next_attempts = attempts + 1
            self.client.update_record(
                self.config.tables.access_otp,
                latest["id"],
                {"Attempts": str(next_attempts)},
            )
            return {
                "ok": False,
                "reason": "invalid",
                "attemptsLeft": max(0, 5 - next_attempts),
            }

        self.client.update_record(
            self.config.tables.access_otp,
            latest["id"],
            {"UsedAt": _now_iso()},
        )
        return {"ok": True}

    @staticmethod
    def map_request_for_export(fields: dict[str, str]) -> dict[str, str]:
        return {
            "Request Type": fields.get("RequestType", "New Access"),
            "Region": fields.get("Region", ""),
            "Subsidiary": fields.get("Subsidiary", ""),
            "Branch": fields.get("Branch", ""),
            "Name": fields.get("Name", ""),
            "Position": fields.get("Position", ""),
            "R&R": fields.get("RR", ""),
            "Requester Email": fields.get("RequesterEmail", ""),
            "Airtable Access": fields.get("AirtableAccess", ""),
            "Current Access": fields.get("CurrentAccess", ""),
            "Requested Access": fields.get("RequestedAccess", ""),
            "Change Reason": fields.get("ChangeReason", ""),
            "Status": fields.get("Status", ""),
            "Admin Comment": fields.get("AdminComment", ""),
            "Created": fields.get("CreatedAt", ""),
        }

    @staticmethod
    def map_active_for_export(fields: dict[str, str]) -> dict[str, str]:
        return {
            "Region": fields.get("Region", ""),
            "Subsidiary": fields.get("Subsidiary", ""),
            "Branch": fields.get("Branch", ""),
            "Name": fields.get("Name", ""),
            "Email": fields.get("Email", ""),
            "Position": fields.get("Position", ""),
            "R&R": fields.get("RR", ""),
            "Airtable Access": fields.get("AirtableAccess", ""),
            "Source Request ID": fields.get("SourceRequestId", ""),
            "Activated At": fields.get("ActivatedAt", ""),
        }


class Mailer:
    def __init__(self, store: AccessStore) -> None:
        self.store = store
        self.config = store.config

    def _sender_email(self, settings: dict[str, Any]) -> tuple[str, str]:
        central = (settings.get("centralAdminEmail") or "").strip()
        sender = self.config.smtp_from or central
        if not sender:
            raise RuntimeError("Central Admin Email or SMTP_FROM is not configured.")
        return sender, central or sender

    @staticmethod
    def _parse_recipients(value: str) -> list[str]:
        return [line.strip() for line in value.splitlines() if line.strip()]

    def _send_mail(
        self,
        to: list[str] | str,
        subject: str,
        body: str,
        reply_to: str = "",
        html_body: str = "",
    ) -> None:
        if not self.config.smtp_host or not self.config.smtp_user or not self.config.smtp_pass:
            raise RuntimeError("SMTP configuration is incomplete.")

        to_list = [to] if isinstance(to, str) else to
        if not to_list:
            return

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = self.config.smtp_from or self.config.smtp_user
        msg["To"] = ", ".join(to_list)
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.set_content(body)
        if html_body:
            msg.add_alternative(html_body, subtype="html")

        if self.config.smtp_secure:
            with smtplib.SMTP_SSL(self.config.smtp_host, self.config.smtp_port, timeout=30) as server:
                server.login(self.config.smtp_user, self.config.smtp_pass)
                server.send_message(msg)
            return

        with smtplib.SMTP(self.config.smtp_host, self.config.smtp_port, timeout=30) as server:
            server.starttls()
            server.login(self.config.smtp_user, self.config.smtp_pass)
            server.send_message(msg)

    @staticmethod
    def _render_rows(rows: list[tuple[str, str]]) -> str:
        return "\n".join([f"{label}: {value or '-'}" for label, value in rows])

    @staticmethod
    def _escape_html(value: str) -> str:
        return html.escape(value or "", quote=True)

    def _logo_url(self) -> str:
        base_url = (os.getenv("PUBLIC_BASE_URL") or "https://lgecreativehub.vercel.app").rstrip("/")
        return f"{base_url}/email-logo.png"

    def _render_rows_html(self, rows: list[tuple[str, str]]) -> str:
        chunks: list[str] = []
        for label, value in rows:
            safe_label = self._escape_html(label)
            safe_value = self._escape_html(value or "-")
            chunks.append(
                "<tr>"
                f"<td style=\"padding:10px 0; color:#716F6A; font-size:12px; text-transform:uppercase; "
                f"letter-spacing:0.04em; border-bottom:1px solid #E6E1D6; width:180px;\">{safe_label}</td>"
                f"<td style=\"padding:10px 0; color:#262626; font-weight:600; border-bottom:1px solid #E6E1D6;\">{safe_value}</td>"
                "</tr>"
            )
        return "".join(chunks)

    def _render_email_html(
        self,
        title: str,
        intro: str,
        rows: list[tuple[str, str]],
        admin_contact: str,
        highlight_label: str = "",
        highlight_value: str = "",
    ) -> str:
        rows_html = self._render_rows_html(rows)
        highlight_html = ""
        if highlight_label:
            highlight_html = (
                "<div style=\"margin-top:16px; padding:14px; background:#F6F5EB; border:1px solid #E6E1D6; border-radius:12px;\">"
                f"<div style=\"font-weight:600; color:#A50034; margin-bottom:6px;\">{self._escape_html(highlight_label)}</div>"
                f"<div style=\"color:#262626;\">{self._escape_html(highlight_value or '-')}</div>"
                "</div>"
            )

        return f"""<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background:#F6F5EB;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td align="center" style="padding:24px;">
          <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px; width:100%; background:#ffffff; border-radius:18px; overflow:hidden; border:1px solid #E6E1D6;">
            <tr>
              <td style="height:6px; background:#A50034;"></td>
            </tr>
            <tr>
              <td style="padding:20px 24px 0 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                  <tr>
                    <td style="width:88px;">
                      <img src="{self._logo_url()}" alt="LG" width="73" height="40" style="display:block; width:73px; height:40px;" />
                    </td>
                    <td style="padding-left:12px;">
                      <div style="font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:#A50034;">Creative Hub</div>
                      <div style="font-size:16px; font-weight:600; color:#262626; margin-top:4px;">Airtable Access Request</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px 24px 24px;">
                <h2 style="margin:0 0 10px 0; font-size:22px; color:#262626;">{self._escape_html(title)}</h2>
                <p style="margin:0 0 18px 0; color:#4A4946; line-height:1.6;">{self._escape_html(intro)}</p>
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;">
                  {rows_html}
                </table>
                {highlight_html}
                <div style="margin-top:16px; padding:14px; background:#F6F5EB; border-radius:12px;">
                  <div style="font-weight:600; color:#A50034; margin-bottom:6px;">Admin Contact</div>
                  <div style="color:#262626;">{self._escape_html(admin_contact)}</div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px; background:#F6F5EB; color:#4A4946; font-size:12px;">
                You are receiving this update from Creative Hub.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""

    def _render_email_text(
        self,
        intro: str,
        rows: list[tuple[str, str]],
        admin_contact: str,
        highlight_label: str = "",
        highlight_value: str = "",
    ) -> str:
        text = f"{intro}\n\n{self._render_rows(rows)}"
        if highlight_label:
            text += f"\n\n{highlight_label}: {highlight_value or '-'}"
        text += f"\n\nAdmin Contact: {admin_contact}"
        return text

    def send_access_verification_email(
        self,
        requester_email: str,
        name: str,
        branch: str,
        access: str,
        code: str,
        expires_in_label: str,
    ) -> None:
        settings = self.store.get_admin_settings()
        sender, admin_contact = self._sender_email(settings)
        intro = f"Use the verification code below to update your access. This code expires in {expires_in_label}."
        rows = [
            ("Name", name),
            ("Branch", branch),
            ("Current Access", access),
        ]
        rows = [row for row in rows if row[1]]
        text_body = self._render_email_text(
            intro=intro,
            rows=rows,
            admin_contact=admin_contact,
            highlight_label="Verification Code",
            highlight_value=code,
        )
        html_body = self._render_email_html(
            title="Verify Your Access Update",
            intro=intro,
            rows=rows,
            admin_contact=admin_contact,
            highlight_label="Verification Code",
            highlight_value=code,
        )
        self._send_mail(
            requester_email,
            "Creative Hub | Verification Code",
            text_body,
            reply_to=admin_contact if admin_contact != sender else "",
            html_body=html_body,
        )

    def send_submission_emails(self, payload: dict[str, str]) -> None:
        settings = self.store.get_admin_settings()
        sender, admin_contact = self._sender_email(settings)
        recipients = self._parse_recipients(settings.get("adminNotifyRecipients", ""))

        rows: list[tuple[str, str]] = [
            ("Request Type", payload.get("requestType", "New Access")),
            ("Region", payload.get("region", "")),
            ("Subsidiary", payload.get("subsidiary", "")),
            ("Branch", payload.get("branch", "")),
            ("Name", payload.get("name", "")),
            ("Position", payload.get("position", "")),
            ("R&R", payload.get("rr", "")),
            ("Requester Email", payload.get("requesterEmail", "")),
            ("Airtable Access", payload.get("access", "")),
            ("Current Access", payload.get("currentAccess", "")),
            ("Requested Access", payload.get("requestedAccess", "")),
            ("Change Reason", payload.get("changeReason", "")),
            ("Status", payload.get("status", "")),
        ]
        rows = [row for row in rows if row[1]]

        request_type = payload.get("requestType", "New Access")
        subject = (
            "Creative Hub | Access Update Received"
            if request_type == "Access Update"
            else "Creative Hub | Request Received"
        )

        requester_text = self._render_email_text("Your access request has been received.", rows, admin_contact)
        requester_html = self._render_email_html(
            "Thanks — Update Request Received" if request_type == "Access Update" else "Thanks — Request Received",
            "Your access request is in. We will notify you as it moves through review.",
            rows,
            admin_contact,
        )
        admin_intro = "New access update request received." if request_type == "Access Update" else "New access request received."
        admin_text = self._render_email_text(admin_intro, rows, admin_contact)
        admin_html = self._render_email_html(
            "New Update Request Received" if request_type == "Access Update" else "New Request Received",
            "A new access update request has been submitted."
            if request_type == "Access Update"
            else "A new access request has been submitted.",
            rows,
            admin_contact,
        )

        self._send_mail(
            payload.get("requesterEmail", ""),
            subject,
            requester_text,
            reply_to=admin_contact if admin_contact != sender else "",
            html_body=requester_html,
        )

        if recipients:
            self._send_mail(
                recipients,
                subject,
                admin_text,
                reply_to=admin_contact if admin_contact != sender else "",
                html_body=admin_html,
            )

    def send_deletion_emails(self, payload: dict[str, str]) -> None:
        settings = self.store.get_admin_settings()
        sender, admin_contact = self._sender_email(settings)
        recipients = self._parse_recipients(settings.get("adminNotifyRecipients", ""))

        rows: list[tuple[str, str]] = [
            ("Request Type", payload.get("requestType", "New Access")),
            ("Region", payload.get("region", "")),
            ("Subsidiary", payload.get("subsidiary", "")),
            ("Branch", payload.get("branch", "")),
            ("Name", payload.get("name", "")),
            ("Position", payload.get("position", "")),
            ("R&R", payload.get("rr", "")),
            ("Requester Email", payload.get("requesterEmail", "")),
            ("Airtable Access", payload.get("access", "")),
            ("Current Access", payload.get("currentAccess", "")),
            ("Requested Access", payload.get("requestedAccess", "")),
            ("Change Reason", payload.get("changeReason", "")),
            ("Status", payload.get("status", "")),
        ]
        rows = [row for row in rows if row[1]]

        subject = "Creative Hub | Request Closed"
        requester_text = self._render_email_text(
            "Your access request was deleted.",
            rows,
            admin_contact,
            highlight_label="Delete Reason",
            highlight_value=payload.get("reason", ""),
        )
        requester_html = self._render_email_html(
            "Request Closed",
            "Your access request was closed by the admin team.",
            rows,
            admin_contact,
            highlight_label="Delete Reason",
            highlight_value=payload.get("reason", ""),
        )
        admin_text = self._render_email_text(
            "An access request was deleted.",
            rows,
            admin_contact,
            highlight_label="Delete Reason",
            highlight_value=payload.get("reason", ""),
        )
        admin_html = self._render_email_html(
            "Request Deleted",
            "An access request was deleted.",
            rows,
            admin_contact,
            highlight_label="Delete Reason",
            highlight_value=payload.get("reason", ""),
        )

        requester_email = payload.get("requesterEmail", "")
        if requester_email:
            self._send_mail(
                requester_email,
                subject,
                requester_text,
                reply_to=admin_contact if admin_contact != sender else "",
                html_body=requester_html,
            )

        if recipients:
            self._send_mail(
                recipients,
                subject,
                admin_text,
                reply_to=admin_contact if admin_contact != sender else "",
                html_body=admin_html,
            )

    def send_completion_emails(self, payload: dict[str, str]) -> None:
        settings = self.store.get_admin_settings()
        sender, admin_contact = self._sender_email(settings)
        recipients = self._parse_recipients(settings.get("adminNotifyRecipients", ""))

        rows: list[tuple[str, str]] = [
            ("Request Type", payload.get("requestType", "New Access")),
            ("Region", payload.get("region", "")),
            ("Subsidiary", payload.get("subsidiary", "")),
            ("Branch", payload.get("branch", "")),
            ("Name", payload.get("name", "")),
            ("Position", payload.get("position", "")),
            ("R&R", payload.get("rr", "")),
            ("Requester Email", payload.get("requesterEmail", "")),
            ("Airtable Access", payload.get("access", "")),
            ("Current Access", payload.get("currentAccess", "")),
            ("Requested Access", payload.get("requestedAccess", "")),
            ("Change Reason", payload.get("changeReason", "")),
            ("Status", payload.get("status", "")),
        ]
        rows = [row for row in rows if row[1]]

        subject = "Creative Hub | Access Ready"
        requester_text = self._render_email_text(
            "Your access request has been completed.",
            rows,
            admin_contact,
            highlight_label="Admin Comment",
            highlight_value=payload.get("adminComment", "-") or "-",
        )
        requester_html = self._render_email_html(
            "Access Ready",
            "Your access request has been completed.",
            rows,
            admin_contact,
            highlight_label="Admin Comment",
            highlight_value=payload.get("adminComment", "-") or "-",
        )
        admin_text = self._render_email_text(
            "Access request completed.",
            rows,
            admin_contact,
            highlight_label="Admin Comment",
            highlight_value=payload.get("adminComment", "-") or "-",
        )
        admin_html = self._render_email_html(
            "Request Completed",
            "Access request completed.",
            rows,
            admin_contact,
            highlight_label="Admin Comment",
            highlight_value=payload.get("adminComment", "-") or "-",
        )

        requester_email = payload.get("requesterEmail", "")
        if requester_email:
            self._send_mail(
                requester_email,
                subject,
                requester_text,
                reply_to=admin_contact if admin_contact != sender else "",
                html_body=requester_html,
            )

        if recipients:
            self._send_mail(
                recipients,
                subject,
                admin_text,
                reply_to=admin_contact if admin_contact != sender else "",
                html_body=admin_html,
            )

    def send_status_update_email(self, payload: dict[str, str]) -> None:
        settings = self.store.get_admin_settings()
        sender, admin_contact = self._sender_email(settings)

        rows: list[tuple[str, str]] = [
            ("Request Type", payload.get("requestType", "New Access")),
            ("Region", payload.get("region", "")),
            ("Subsidiary", payload.get("subsidiary", "")),
            ("Branch", payload.get("branch", "")),
            ("Name", payload.get("name", "")),
            ("Position", payload.get("position", "")),
            ("R&R", payload.get("rr", "")),
            ("Requester Email", payload.get("requesterEmail", "")),
            ("Airtable Access", payload.get("access", "")),
            ("Current Access", payload.get("currentAccess", "")),
            ("Requested Access", payload.get("requestedAccess", "")),
            ("Change Reason", payload.get("changeReason", "")),
            ("Status", payload.get("status", "")),
        ]
        rows = [row for row in rows if row[1]]

        text_body = self._render_email_text(
            "Your access request has an update.",
            rows,
            admin_contact,
            highlight_label="Admin Comment",
            highlight_value=payload.get("adminComment", "-") or "-",
        )
        html_body = self._render_email_html(
            "Status Update",
            "There is a new update on your access request.",
            rows,
            admin_contact,
            highlight_label="Admin Comment",
            highlight_value=payload.get("adminComment", "-") or "-",
        )
        self._send_mail(
            payload.get("requesterEmail", ""),
            "Creative Hub | Status Update",
            text_body,
            reply_to=admin_contact if admin_contact != sender else "",
            html_body=html_body,
        )


def build_excel_bytes(records: list[dict[str, Any]], mapper: Callable[[dict[str, str]], dict[str, str]]) -> bytes:
    rows = [mapper(record.get("fields", {})) for record in records]
    df = pd.DataFrame(rows)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False)
    output.seek(0)
    return output.read()


def get_store() -> AccessStore:
    return AccessStore(AppConfig.from_env())


def get_mailer(store: AccessStore | None = None) -> Mailer:
    actual_store = store or get_store()
    return Mailer(actual_store)


def is_admin_password_valid(password: str) -> bool:
    expected = AppConfig.from_env().admin_password
    return bool(expected) and password == expected


def get_site_password() -> str:
    return AppConfig.from_env().site_password


def is_site_password_valid(password: str) -> bool:
    expected = get_site_password()
    return bool(expected) and password == expected
