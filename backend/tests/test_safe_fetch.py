import httpx
import pytest

from app.services.safe_fetch import FetchError, safe_fetch_html

PUBLIC_IP = "93.184.216.34"


def fixed_resolver(mapping: dict[str, list[str]]):
    async def resolve(host: str, port: int) -> list[str]:
        return mapping[host]

    return resolve


def html_response(body: str = "<html><body>Hi</body></html>", **kwargs) -> httpx.Response:
    return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=body, **kwargs)


def fail_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"unexpected request to {request.url}")

    return httpx.MockTransport(handler)


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.5",
        "192.168.1.2",
        "169.254.169.254",
        "100.100.1.1",
        "0.0.0.0",
        "::1",
        "::ffff:127.0.0.1",
        "fd00::1",
    ],
)
async def test_rejects_non_global(ip):
    with pytest.raises(FetchError):
        await safe_fetch_html(
            "http://example.com/",
            resolver=fixed_resolver({"example.com": [ip]}),
            transport=fail_transport(),
        )


async def test_rejects_if_any_resolved_ip_private():
    with pytest.raises(FetchError):
        await safe_fetch_html(
            "http://example.com/",
            resolver=fixed_resolver({"example.com": [PUBLIC_IP, "10.0.0.1"]}),
            transport=fail_transport(),
        )


@pytest.mark.parametrize(
    "url",
    [
        "ftp://x",
        "http://x:8080/",
        "file:///etc/passwd",
        "http://user:pass@example.com/",
        "http:///path",
        "not a url",
    ],
)
async def test_rejects_bad_scheme_and_port(url):
    with pytest.raises(FetchError):
        await safe_fetch_html(
            url,
            resolver=fixed_resolver({"x": [PUBLIC_IP], "example.com": [PUBLIC_IP]}),
            transport=fail_transport(),
        )


async def test_resolution_failure_is_fetch_error():
    async def resolve(host: str, port: int) -> list[str]:
        return []

    with pytest.raises(FetchError):
        await safe_fetch_html("http://example.com/", resolver=resolve, transport=fail_transport())


async def test_connects_to_validated_ip_with_host_header():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["host"] = request.url.host
        seen["host_header"] = request.headers["host"]
        seen["path"] = request.url.raw_path
        seen["sni"] = request.extensions.get("sni_hostname")
        return html_response()

    await safe_fetch_html(
        "https://example.com/recipe?id=1",
        resolver=fixed_resolver({"example.com": [PUBLIC_IP]}),
        transport=httpx.MockTransport(handler),
    )
    assert seen["host"] == PUBLIC_IP
    assert seen["host_header"] == "example.com"
    assert seen["path"] == b"/recipe?id=1"
    assert seen["sni"] == "example.com"


async def test_ipv6_literal_is_bracketed():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["host"] = request.url.host
        return html_response()

    await safe_fetch_html(
        "http://example.com/",
        resolver=fixed_resolver({"example.com": ["2606:2800:220:1:248:1893:25c8:1946"]}),
        transport=httpx.MockTransport(handler),
    )
    assert seen["host"] == "2606:2800:220:1:248:1893:25c8:1946"


async def test_redirect_to_internal_rejected():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["host"] == "example.com"
        return httpx.Response(302, headers={"location": "http://internal/"})

    with pytest.raises(FetchError):
        await safe_fetch_html(
            "http://example.com/",
            resolver=fixed_resolver({"example.com": [PUBLIC_IP], "internal": ["10.0.0.1"]}),
            transport=httpx.MockTransport(handler),
        )


async def test_relative_redirect_followed():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "/new"})
        return html_response("<p>moved</p>")

    final_url, text = await safe_fetch_html(
        "http://example.com/old",
        resolver=fixed_resolver({"example.com": [PUBLIC_IP]}),
        transport=httpx.MockTransport(handler),
    )
    assert final_url == "http://example.com/new"
    assert text == "<p>moved</p>"


async def test_too_many_redirects():
    def handler(request: httpx.Request) -> httpx.Response:
        n = int(request.url.path.strip("/") or 0)
        if n < 4:
            return httpx.Response(302, headers={"location": f"/{n + 1}"})
        return html_response()

    with pytest.raises(FetchError, match="Too many redirects"):
        await safe_fetch_html(
            "http://example.com/0",
            resolver=fixed_resolver({"example.com": [PUBLIC_IP]}),
            transport=httpx.MockTransport(handler),
        )


async def test_three_redirects_allowed():
    def handler(request: httpx.Request) -> httpx.Response:
        n = int(request.url.path.strip("/") or 0)
        if n < 3:
            return httpx.Response(302, headers={"location": f"/{n + 1}"})
        return html_response()

    final_url, _ = await safe_fetch_html(
        "http://example.com/0",
        resolver=fixed_resolver({"example.com": [PUBLIC_IP]}),
        transport=httpx.MockTransport(handler),
    )
    assert final_url == "http://example.com/3"


async def test_non_html_rejected():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF")

    with pytest.raises(FetchError):
        await safe_fetch_html(
            "http://example.com/",
            resolver=fixed_resolver({"example.com": [PUBLIC_IP]}),
            transport=httpx.MockTransport(handler),
        )


async def test_oversize_rejected():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"a" * 2_000_001)

    with pytest.raises(FetchError, match="too large"):
        await safe_fetch_html(
            "http://example.com/",
            resolver=fixed_resolver({"example.com": [PUBLIC_IP]}),
            transport=httpx.MockTransport(handler),
        )


async def test_error_status_rejected():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, headers={"content-type": "text/html"}, text="nope")

    with pytest.raises(FetchError):
        await safe_fetch_html(
            "http://example.com/",
            resolver=fixed_resolver({"example.com": [PUBLIC_IP]}),
            transport=httpx.MockTransport(handler),
        )


async def test_happy_path_returns_text():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=iso-8859-1"},
            content="<p>Crème brûlée</p>".encode("iso-8859-1"),
        )

    final_url, text = await safe_fetch_html(
        "https://example.com/recipe",
        resolver=fixed_resolver({"example.com": [PUBLIC_IP]}),
        transport=httpx.MockTransport(handler),
    )
    assert final_url == "https://example.com/recipe"
    assert text == "<p>Crème brûlée</p>"


async def test_invalid_utf8_replaced():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"<p>\xff ok</p>")

    _, text = await safe_fetch_html(
        "http://example.com/",
        resolver=fixed_resolver({"example.com": [PUBLIC_IP]}),
        transport=httpx.MockTransport(handler),
    )
    assert text == "<p>� ok</p>"
