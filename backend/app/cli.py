"""Command-line tools for the server.

    python -m app.cli create-admin --email admin@nm7.si --name "Naresh" --role owner
    python -m app.cli reset-admin-password --email admin@nm7.si
    python -m app.cli reset-admin-2fa --email admin@nm7.si
    python -m app.cli expire-orders        # unpaid orders older than 24 h → expired (run hourly as a cron job)

Passwords are asked for on the terminal (or read from NM7_ADMIN_PASSWORD for scripts).
"""

import argparse
import asyncio
import getpass
import os
import sys

from app.audit import audit
from app.auth.admin_service import create_admin, provisioning_uri, set_up_two_step
from app.auth.service import find_user
from app.auth.sessions import revoke_all
from app.core.db import USERS, close_client, ensure_indexes, get_database, transaction
from app.core.security import hash_password, password_issue
from app.core.time import now
from app.orders.service import expire_unpaid


def _password() -> str:
    if pw := os.environ.get("NM7_ADMIN_PASSWORD"):
        return pw
    first = getpass.getpass("Password: ")
    if first != getpass.getpass("Type it again: "):
        sys.exit("The two passwords don't match.")
    return first


def _print_two_step(user, secret: str, codes: list[str]) -> None:
    print("\nAdd this to the authenticator app (Google Authenticator, Authy, 1Password…):")
    print(f"  Link (or turn into a QR code): {provisioning_uri(user, secret)}")
    print(f"  Or type the key by hand:       {secret}")
    print("\nRecovery codes — each works once if the phone is lost. Store them somewhere safe:")
    for c in codes:
        print(f"  {c}")


async def _admin(db, email: str):
    user = await find_user(db, email)
    if not user or user.role != "admin":
        sys.exit(f"No admin account with email {email}.")
    return user


async def run(argv: list[str]) -> None:
    p = argparse.ArgumentParser(prog="python -m app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-admin", help="create an admin with two-step login")
    c.add_argument("--email", required=True)
    c.add_argument("--name", required=True)
    c.add_argument("--role", default="owner", help="owner / ops / finance / support / quality")
    for name in ("reset-admin-password", "reset-admin-2fa"):
        sub.add_parser(name).add_argument("--email", required=True)
    sub.add_parser("expire-orders", help="mark orders unpaid for 24 hours as expired")
    args = p.parse_args(argv)

    db = get_database()
    await ensure_indexes(db)
    if args.cmd == "create-admin":
        try:
            user, secret, codes = await create_admin(db, args.email, args.name, args.role, _password())
        except ValueError as e:
            sys.exit(f"Could not create the admin: {e}")
        await audit(db, None, "admin.created", target=user.id, data={"email": user.email, "role": args.role})
        print(f"Admin {user.email} ({args.role}) created.")
        _print_two_step(user, secret, codes)
    elif args.cmd == "expire-orders":
        n = await expire_unpaid(db)
        print(f"{n} unpaid order(s) marked expired.")
    elif args.cmd == "reset-admin-password":
        user = await _admin(db, args.email)
        pw = _password()
        if issue := password_issue(pw):
            sys.exit(f"Password: {issue}")
        await db[USERS].update_one(
            {"_id": user.id}, {"$set": {"password_hash": await hash_password(pw), "updated_at": now()}}
        )
        await revoke_all(db, user.id)
        await audit(db, None, "admin.password_reset", target=user.id)
        print(f"Password changed for {user.email}; they are signed out everywhere.")
    elif args.cmd == "reset-admin-2fa":
        user = await _admin(db, args.email)
        secret, codes = await transaction(lambda s: set_up_two_step(db, user, session=s))
        await audit(db, None, "admin.two_step_reset", target=user.id)
        print(f"Two-step login reset for {user.email}; old codes, devices and sessions stopped working.")
        _print_two_step(user, secret, codes)


async def main(argv: list[str]) -> None:
    try:
        await run(argv)
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
