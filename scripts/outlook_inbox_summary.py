#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import sys
from typing import List, Dict

import msal
import requests

GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
DEFAULT_SCOPES = ["Mail.Read", "User.Read"]

KEYWORDS = [
    "action",
    "please",
    "needed",
    "urgent",
    "asap",
    "by ",
    "review",
    "approve",
    "follow up",
]


def load_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(2)
    return value


def token_cache_path(base_dir: str) -> str:
    return os.path.join(base_dir, ".auth", "msal_cache.bin")


def acquire_token(client_id: str, tenant_id: str, scopes: List[str], cache_path: str) -> str:
    cache = msal.SerializableTokenCache()
    if os.path.exists(cache_path):
        cache.deserialize(open(cache_path, "r", encoding="utf-8").read())

    authority = f"https://login.microsoftonline.com/{tenant_id}"
    app = msal.PublicClientApplication(client_id, authority=authority, token_cache=cache)

    accounts = app.get_accounts()
    result = None
    if accounts:
        result = app.acquire_token_silent(scopes, account=accounts[0])

    if not result:
        flow = app.initiate_device_flow(scopes=scopes)
        if "user_code" not in flow:
            raise RuntimeError("Failed to create device flow. Check client ID and tenant.")
        print(flow["message"], file=sys.stderr)
        result = app.acquire_token_by_device_flow(flow)

    if "access_token" not in result:
        error = result.get("error")
        desc = result.get("error_description")
        raise RuntimeError(f"Token acquisition failed: {error} - {desc}")

    if cache.has_state_changed:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(cache.serialize())

    return result["access_token"]


def graph_get(token: str, url: str, params: Dict[str, str]) -> Dict:
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(url, headers=headers, params=params, timeout=30)
    if response.status_code >= 400:
        raise RuntimeError(f"Graph error {response.status_code}: {response.text}")
    return response.json()


def is_action_item(subject: str) -> bool:
    lower = subject.lower()
    return any(k in lower for k in KEYWORDS)


def summarize(messages: List[Dict]) -> Dict:
    unread = [m for m in messages if not m.get("isRead", False)]
    high = [m for m in messages if m.get("importance") == "high"]
    action = [m for m in messages if is_action_item(m.get("subject", ""))]

    def to_item(m: Dict) -> Dict:
        sender = m.get("sender", {}).get("emailAddress", {})
        return {
            "sender": sender.get("name") or sender.get("address") or "Unknown",
            "subject": m.get("subject", "(no subject)"),
            "received": m.get("receivedDateTime"),
            "importance": m.get("importance"),
            "isRead": m.get("isRead"),
        }

    return {
        "total": len(messages),
        "unread_count": len(unread),
        "high_importance_count": len(high),
        "action_item_count": len(action),
        "action_items": [to_item(m) for m in action[:10]],
        "top_messages": [to_item(m) for m in messages[:10]],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize Outlook inbox via Microsoft Graph.")
    parser.add_argument("--hours", type=int, default=24, help="Lookback window in hours.")
    parser.add_argument("--max", type=int, default=50, help="Max messages to fetch.")
    parser.add_argument("--json", action="store_true", help="Output JSON only.")
    args = parser.parse_args()

    client_id = load_env("MS_GRAPH_CLIENT_ID")
    tenant_id = os.getenv("MS_GRAPH_TENANT_ID", "organizations")

    cache_path = token_cache_path(os.getcwd())
    token = acquire_token(client_id, tenant_id, DEFAULT_SCOPES, cache_path)

    since = (dt.datetime.utcnow() - dt.timedelta(hours=args.hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    params = {
        "$select": "sender,subject,receivedDateTime,isRead,importance",
        "$orderby": "receivedDateTime desc",
        "$top": str(args.max),
        "$filter": f"receivedDateTime ge {since}",
    }

    data = graph_get(token, f"{GRAPH_ROOT}/me/mailFolders/Inbox/messages", params)
    messages = data.get("value", [])
    summary = summarize(messages)

    if args.json:
        print(json.dumps(summary, indent=2))
        return 0

    print("Inbox summary")
    print(f"Lookback: last {args.hours} hours")
    print(f"Total messages: {summary['total']}")
    print(f"Unread: {summary['unread_count']}")
    print(f"High importance: {summary['high_importance_count']}")
    print(f"Action items: {summary['action_item_count']}")
    print("\nTop messages:")
    for m in summary["top_messages"]:
        status = "unread" if not m["isRead"] else "read"
        print(f"- [{status}] {m['sender']}: {m['subject']}")

    if summary["action_items"]:
        print("\nAction item candidates:")
        for m in summary["action_items"]:
            print(f"- {m['sender']}: {m['subject']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
