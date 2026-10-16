import asyncio
from playwright.async_api import async_playwright
import os

async def capture_all():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(base_dir, "docs", "screenshots")
    os.makedirs(out_dir, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Using 1280x800 desktop viewport
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})

        # Base URL using 127.0.0.1 or localhost
        base_url = "http://127.0.0.1:5173"

        # 1. Login Page
        print("Capturing Login page...")
        await page.goto(f"{base_url}/login", wait_until="load", timeout=15000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a1_login.png"))

        # 2. Register Page
        print("Capturing Register page...")
        await page.goto(f"{base_url}/register", wait_until="load", timeout=15000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a2_register.png"))

        # 3. Vault Page (Simulated preview / direct route)
        print("Capturing Vault page...")
        await page.goto(f"{base_url}/vault", wait_until="load", timeout=15000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a3_vault.png"))

        # 4. Security Center Page
        print("Capturing Security Center...")
        await page.goto(f"{base_url}/security-center", wait_until="load", timeout=15000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a4_security_center.png"))

        # 5. Generator Page
        print("Capturing Password Generator...")
        await page.goto(f"{base_url}/generator", wait_until="load", timeout=15000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a5_generator.png"))

        # 6. Secure Send Page
        print("Capturing Secure Send...")
        await page.goto(f"{base_url}/send", wait_until="load", timeout=15000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a6_send.png"))

        # 7. Settings / MFA Page
        print("Capturing Settings...")
        await page.goto(f"{base_url}/settings", wait_until="load", timeout=15000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a7_settings.png"))

        # 8. Audit Log Page
        print("Capturing Audit Log...")
        await page.goto(f"{base_url}/audit", wait_until="load", timeout=15000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a8_audit.png"))

        await browser.close()
        print("All screens captured successfully!")

if __name__ == '__main__':
    asyncio.run(capture_all())
