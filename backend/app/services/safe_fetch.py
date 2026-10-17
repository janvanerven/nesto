"""SSRF-safe fetching of user-supplied web pages.

Every hop is resolved and validated before connecting: only http/https on ports
80/443, and only when every resolved address is globally routable. The request
is sent to the validated IP (not the hostname) so DNS cannot be re-bound between
the check and the connection; Host header and TLS SNI/cert verification still
use the original hostname.
"""

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from urllib.parse import urljoin, urlsplit

import httpx

MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 10
MAX_BYTES = 2_000_000
_ALLOWED_PORTS = {80, 443}
_DEFAULT_PORTS = {"http": 80, "https": 443}
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}

# IPv6 ranges that embed or translate to IPv4 (or are deprecated local scopes);
# Python reports some of these as is_global, so reject them outright.
_BLOCKED_V6 = tuple(
    ipaddress.ip_network(n)
    for n in (
        "::/96",  # IPv4-compatible
        "::ffff:0:0:0/96",  # SIIT
        "64:ff9b::/96",  # NAT64
        "64:ff9b:1::/48",  # local-use NAT64
        "2001::/32",  # Teredo
        "2002::/16",  # 6to4
        "fec0::/10",  # deprecated site-local
    )
)

Resolver = Callable[[str, int], Awaitable[list[str]]]


class FetchError(Exception):
    """Fetch failed; the message is safe to show to users."""


async def _default_resolver(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(info[4][0] for info in infos))


def _is_allowed_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped:
            addr = addr.ipv4_mapped
        elif any(addr in net for net in _BLOCKED_V6):
            return False
    return addr.is_global and not addr.is_multicast


def _parse(url: str) -> tuple[str, str, int, str]:
    """Return (scheme, ascii_host, port, path_and_query) or raise FetchError."""
    url = url.strip()
    if any(c.isspace() or not c.isprintable() for c in url):
        raise FetchError("That address isn't allowed")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise FetchError("That address isn't allowed")
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS:
        raise FetchError("That link doesn't point to a web page")
    if "@" in parts.netloc or not parts.hostname:
        raise FetchError("That address isn't allowed")
    port = port if port is not None else _DEFAULT_PORTS[scheme]
    if port not in _ALLOWED_PORTS:
        raise FetchError("That address isn't allowed")
    try:
        host = parts.hostname.encode("idna").decode("ascii")
    except UnicodeError:
        raise FetchError("That address isn't allowed")
    target = parts.path or "/"
    if parts.query:
        target += "?" + parts.query
    return scheme, host, port, target


async def _resolve_checked(host: str, port: int, resolver: Resolver) -> str:
    try:
        ips = await resolver(host, port)
    except (OSError, UnicodeError):
        raise FetchError("Couldn't reach that address")
    if not ips:
        raise FetchError("Couldn't reach that address")
    if not all(_is_allowed_ip(ip) for ip in ips):
        raise FetchError("That address isn't allowed")
    return ips[0]


async def _fetch(url: str, resolver: Resolver, client: httpx.AsyncClient) -> tuple[str, str]:
    for _hop in range(MAX_REDIRECTS + 1):
        scheme, host, port, target = _parse(url)
        ip = await _resolve_checked(host, port, resolver)
        ip_literal = f"[{ip}]" if ":" in ip else ip
        host_header = host if port == _DEFAULT_PORTS[scheme] else f"{host}:{port}"
        request = client.build_request(
            "GET",
            f"{scheme}://{ip_literal}:{port}{target}",
            headers={"Host": host_header},
            extensions={"sni_hostname": host},
        )
        response = await client.send(request, stream=True, follow_redirects=False)
        try:
            if response.status_code in _REDIRECT_STATUSES:
                location = response.headers.get("location")
                if not location:
                    raise FetchError("Couldn't load that page")
                url = urljoin(url, location)
                continue
            if not response.is_success:
                raise FetchError("Couldn't load that page")
            content_type = response.headers.get("content-type", "").lower()
            if not content_type.startswith("text/html"):
                raise FetchError("That link doesn't point to a web page")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    raise FetchError("That page is too large")
            charset = response.charset_encoding or "utf-8"
            try:
                text = body.decode(charset, errors="replace")
            except (LookupError, UnicodeError):
                text = body.decode("utf-8", errors="replace")
            return url, text
        finally:
            await response.aclose()
    raise FetchError("Too many redirects")


async def safe_fetch_html(
    url: str,
    *,
    resolver: Resolver | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[str, str]:
    """Fetch an HTML page from a public address. Returns (final_url, html_text)."""
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS):
            async with httpx.AsyncClient(
                transport=transport,
                timeout=TIMEOUT_SECONDS,
                follow_redirects=False,
                trust_env=False,
                verify=True,
            ) as client:
                return await _fetch(url, resolver or _default_resolver, client)
    except (TimeoutError, httpx.TimeoutException):
        raise FetchError("That page took too long to load")
    except (httpx.HTTPError, httpx.InvalidURL):
        raise FetchError("Couldn't reach that address")
