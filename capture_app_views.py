import asyncio
from playwright.async_api import async_playwright
import urllib.request, json
import os

async def capture_app():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(base_dir, "docs", "screenshots")
    os.makedirs(out_dir, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        # Step 1: Register
        email = f"report_user_{os.getpid()}@vaultguard.local"
        password = "Correct-Horse-Battery-Staple-2026!"

        print("1. Opening Register page...")
        await page.goto("http://localhost:5173/register", wait_until="load")
        await page.fill('input[type="email"]', email)
        pws = await page.query_selector_all('input[type="password"]')
        await pws[0].fill(password)
        await pws[1].fill(password)
        await page.wait_for_timeout(1000)
        await page.click('button[type="submit"]')
        print("Registration submitted, waiting for recovery key screen...")

        # Wait for recovery key element
        await page.wait_for_selector('div.font-mono.select-all', timeout=15000)
        rec_el = await page.query_selector('div.font-mono.select-all')
        rec_key = (await rec_el.inner_text()).strip()
        print("Captured recovery key:", rec_key)
        
        # Screenshot of Recovery Key step
        await page.screenshot(path=os.path.join(out_dir, "fig_a2_recovery_key.png"))

        last_group = rec_key.split()[-1]
        print("Typing last group:", last_group)
        await page.fill('input#confirmKey', last_group)
        await page.wait_for_timeout(500)

        # Click Continue to Email Verification
        await page.click('button:has-text("Continue to Email Verification")')
        await page.wait_for_timeout(2000)

        # Step 2: Email verification
        print("On Verify Email page, retrieving dev code...")
        await page.screenshot(path=os.path.join(out_dir, "fig_a3_verify_email.png"))

        hook_url = f"http://127.0.0.1:5000/api/v1/auth/test-hook/code?email={email}&purpose=email_verify"
        with urllib.request.urlopen(hook_url) as resp:
            data = json.loads(resp.read().decode())
            code = data.get("code")
            print("Got verification code from test hook:", code)

        await page.fill('input', code)
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(2000)

        # Step 3: Login to unlock vault
        print("Logging in to unlock vault...")
        await page.goto("http://localhost:5173/login", wait_until="load")
        await page.fill('input[type="email"]', email)
        pws = await page.query_selector_all('input[type="password"]')
        await pws[0].fill(password)
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(3500)

        print("Current URL after login:", page.url)

        # Now capture all protected application screens!
        print("Capturing 1: Dashboard...")
        await page.goto("http://localhost:5173/app", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a1_dashboard.png"))

        print("Capturing 2: Vault...")
        await page.goto("http://localhost:5173/app/vault", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a2_vault.png"))

        print("Capturing 3: Security Center...")
        await page.goto("http://localhost:5173/app/security", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a3_security_center.png"))

        print("Capturing 4: Password Generator...")
        await page.goto("http://localhost:5173/app/generator", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a4_generator.png"))

        print("Capturing 5: Secure Send...")
        await page.goto("http://localhost:5173/app/send", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a5_send.png"))

        print("Capturing 6: Settings / MFA...")
        await page.goto("http://localhost:5173/app/settings", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a6_settings.png"))

        print("Capturing 7: Audit Log...")
        await page.goto("http://localhost:5173/app/audit", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "fig_a7_audit.png"))

        await browser.close()
        print("SUCCESS: All authenticated screenshots captured flawlessly!")

if __name__ == '__main__':
    asyncio.run(capture_app())
